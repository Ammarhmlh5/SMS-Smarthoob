/**
 * remoteDispatch.ts
 * طبقة الإرسال الفعلي بالدفعات (Batch Remote Dispatch Service).
 * - سحب الرسائل المعلقة من قائمة الانتظار المحلية (SQLite outgoing_messages)
 * - التحقق من صلاحية الإرسال عبر Send Gate
 * - تطبيق سياسة التأخير والتدفق (Throttle Policy)
 * - استدعاء دالة hoodhad-send السحابية مع ترويسة X-Correlation-Id
 * - تحديث حالات الرسائل (SENT, RETRY_WAITING, FAILED, BLOCKED)
 */

import { database } from './database';
import type { OutgoingMessage } from './database';
import { supabase } from './supabase';
import { evaluateSendGate } from './sendGuard';
import { loadSettings } from './settingsStore';
import type { AppSettings } from './settingsStore';
import { calculateEffectiveDelayMs, isRetryableError, parseRetryAfterMs } from './throttlePolicy';

export interface DispatchBatchResult {
  dispatched: number;
  sent: number;
  failed: number;
  retried: number;
  blocked: boolean;
  blockReason?: string;
}

/**
 * وظيفة مساعدة لتوليد معرف فريد (UUID / Correlation ID)
 */
function generateCorrelationId(): string {
  return 'corr-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 9);
}

/**
 * وظيفة مساعدة للانتظار
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * إرسال الدفعة التالية من قائمة الانتظار لحملة معينة
 */
export async function dispatchNextBatch(
  campaignId: string,
  gatewayId: string,
  customSettings?: AppSettings
): Promise<DispatchBatchResult> {
  const settings = customSettings ?? (await loadSettings());

  // 1. فحص بوابة الأمان Send Gate
  const gate = await evaluateSendGate({
    connectionId: gatewayId,
    customSettings: settings,
  });

  if (!gate.canProceed) {
    await database.markOutgoingBlocked(campaignId, gate.message);
    return {
      dispatched: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      blocked: true,
      blockReason: gate.message,
    };
  }

  // 2. تحميل الرسائل المعلقة
  const batchSize = Math.max(1, settings.batchSize || 50);
  const messages = await database.getPendingOutgoingMessages(batchSize, campaignId);

  if (messages.length === 0) {
    return {
      dispatched: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      blocked: false,
    };
  }

  // 3. تحديث حالة الرسائل إلى SENDING
  for (const msg of messages) {
    await database.updateOutgoingStatus(msg.id, 'SENDING');
  }

  // 4. تطبيق التأخير الأساسي
  const baseDelay = calculateEffectiveDelayMs(settings, 0);
  if (baseDelay > 0) {
    await sleep(baseDelay);
  }

  const correlationId = generateCorrelationId();
  let sentCount = 0;
  let failedCount = 0;
  let retriedCount = 0;

  try {
    // 5. استدعاء دالة hoodhad-send السحابية
    const { data, error } = await supabase.functions.invoke('hoodhad-send', {
      body: {
        action: 'send_campaign',
        campaign_id: campaignId,
        gateway_id: gatewayId,
        recipients: messages.map((m) => ({
          phone: m.phone,
          message: m.message,
        })),
      },
      headers: {
        'X-Correlation-Id': correlationId,
      },
    });

    if (error) {
      throw error;
    }

    // 6. معالجة نتائج الرد الناجح
    const results = (data?.results as Array<{ phone: string; status: string; error?: string }>) || [];
    const resultMap = new Map<string, { status: string; error?: string }>();
    for (const r of results) {
      resultMap.set(r.phone, r);
    }

    for (const msg of messages) {
      const itemRes = resultMap.get(msg.phone);
      if (itemRes && itemRes.status === 'sent') {
        sentCount++;
        await database.updateOutgoingStatus(msg.id, 'SENT', {
          correlationId,
        });
      } else {
        // فشل فردي للمستلم
        const errMsg = itemRes?.error || 'فشل إرسال الرسالة';
        if (msg.retry_count + 1 < msg.max_retry_attempts) {
          retriedCount++;
          await database.updateOutgoingStatus(msg.id, 'RETRY_WAITING', {
            error: errMsg,
            correlationId,
            incrementRetry: true,
          });
        } else {
          failedCount++;
          await database.updateOutgoingStatus(msg.id, 'FAILED', {
            error: errMsg,
            correlationId,
          });
        }
      }
    }
  } catch (err: unknown) {
    // 7. معالجة أخطاء الشبكة أو الخادم للدفعة بأكملها
    const errMsg = err instanceof Error ? err.message : 'خطأ أثناء الإرسال';
    const retryable = isRetryableError(err);

    for (const msg of messages) {
      if (retryable && msg.retry_count + 1 < msg.max_retry_attempts) {
        retriedCount++;
        await database.updateOutgoingStatus(msg.id, 'RETRY_WAITING', {
          error: errMsg,
          correlationId,
          incrementRetry: true,
        });
      } else {
        failedCount++;
        await database.updateOutgoingStatus(msg.id, 'FAILED', {
          error: errMsg,
          correlationId,
        });
      }
    }
  }

  return {
    dispatched: messages.length,
    sent: sentCount,
    failed: failedCount,
    retried: retriedCount,
    blocked: false,
  };
}

/**
 * معالجة إرسال الحملة بالكامل دفعات متتالية مع تقرير التقدم
 */
export async function processFullCampaignDispatch(
  campaignId: string,
  gatewayId: string,
  onProgress?: (stats: { sent: number; failed: number; pending: number; total: number }) => void
): Promise<{ sent: number; failed: number; total: number; blocked: boolean; blockReason?: string }> {
  const settings = await loadSettings();

  while (true) {
    const stats = await database.getCampaignQueueStats(campaignId);
    if (onProgress) {
      onProgress(stats);
    }

    if (stats.pending === 0) {
      return {
        sent: stats.sent,
        failed: stats.failed,
        total: stats.total,
        blocked: false,
      };
    }

    const batchRes = await dispatchNextBatch(campaignId, gatewayId, settings);

    if (batchRes.blocked) {
      return {
        sent: stats.sent,
        failed: stats.failed,
        total: stats.total,
        blocked: true,
        blockReason: batchRes.blockReason,
      };
    }

    // إذا لم يتم إرسال أي عنصر في الدفعة (مثلاً جميعها قيد الانتظار لموعد لاحق) نخرج لمنع حلقة لانهائية
    if (batchRes.dispatched === 0) {
      break;
    }
  }

  const finalStats = await database.getCampaignQueueStats(campaignId);
  return {
    sent: finalStats.sent,
    failed: finalStats.failed,
    total: finalStats.total,
    blocked: false,
  };
}
