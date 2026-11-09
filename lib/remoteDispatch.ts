/**
 * remoteDispatch.ts
 * طبقة الإرسال الفعلي بالدفعات (Batch Remote Dispatch Service).
 * - سحب الرسائل المعلقة من قائمة الانتظار المحلية (SQLite outgoing_messages)
 * - التحقق من صلاحية الإرسال عبر Send Gate
 * - تطبيق سياسة التأخير والتدفق (Throttle Policy)
 * - إرسال الرسائل مباشرة إلى بوابة المستخدم مع ترويسة Authorization
 * - تحديث حالات الرسائل (SENT, RETRY_WAITING, FAILED, BLOCKED)
 */

import { database } from './database';
import type { OutgoingMessage } from './database';
import {
  CampaignClaimCheckError,
  CampaignClaimLostError,
  sendGatewayMessageWithRetry,
} from './gatewayDelivery';
import { getGatewayConnection } from './gatewaySettings';
import { evaluateSendGate } from './sendGuard';
import { loadSettings } from './settingsStore';
import type { AppSettings } from './settingsStore';
import { calculateEffectiveDelayMs } from './throttlePolicy';
import { CAMPAIGN_CLAIM_HEARTBEAT_MS } from './campaignClaimLease';
import { createUuid } from './ids';

export interface DispatchBatchResult {
  dispatched: number;
  sent: number;
  failed: number;
  retried: number;
  blocked: boolean;
  blockReason?: string;
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
  customSettings?: AppSettings,
  onProgress?: (stats: { sent: number; failed: number; pending: number; total: number }) => void,
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

  const connection = await getGatewayConnection(gatewayId);

  // 2. حجز الرسائل المعلقة حصرياً قبل إرسالها لمنع تشغيلها مرتين بالتوازي
  const batchSize = Math.max(1, settings.batchSize || 50);
  const correlationId = createUuid();
  const messages = await database.claimPendingOutgoingMessages(
    batchSize,
    campaignId,
    correlationId,
  );

  if (messages.length === 0) {
    return {
      dispatched: 0,
      sent: 0,
      failed: 0,
      retried: 0,
      blocked: false,
    };
  }
  let sentCount = 0;
  let failedCount = 0;
  let retriedCount = 0;
  const baseDelay = calculateEffectiveDelayMs(settings, 0);
  const heartbeat = setInterval(() => {
    void database.refreshClaimedOutgoingMessages(correlationId).catch((error) => {
      console.warn('تعذر تجديد حجز رسائل الحملة:', error);
    });
  }, CAMPAIGN_CLAIM_HEARTBEAT_MS);

  try {
    for (let index = 0; index < messages.length; index += 1) {
      const msg = messages[index];
      const recipientId = getRecipientId(msg);
      if (index > 0 && baseDelay > 0) await sleep(baseDelay);

      let deliveryError: unknown;
      let deliveryFailed = false;
      try {
        await sendGatewayMessageWithRetry(
          connection,
          msg.phone,
          msg.message,
          Math.max(0, msg.max_retry_attempts - msg.retry_count),
          settings,
          async (error) => {
            retriedCount += 1;
            const updated = await database.updateOutgoingStatus(msg.id, 'SENDING', {
              error: error instanceof Error ? error.message : 'تعذر إرسال الرسالة.',
              correlationId,
              incrementRetry: true,
            });
            if (!updated) throw new CampaignClaimLostError();
          },
          fetch,
          () => database.startClaimedOutgoingMessageAttempt(msg.id, correlationId),
        );
      } catch (error) {
        if (error instanceof CampaignClaimLostError || error instanceof CampaignClaimCheckError) {
          throw error;
        }
        deliveryFailed = true;
        deliveryError = error;
      }

      if (deliveryFailed) {
        const errorMessage =
          deliveryError instanceof Error ? deliveryError.message : 'تعذر إرسال الرسالة.';
        const updated = await database.completeOutgoingMessage(
          msg.id,
          'FAILED',
          correlationId,
          recipientId,
          errorMessage,
        );
        if (!updated) throw new CampaignClaimLostError();
        failedCount += 1;
      } else {
        const updated = await database.completeOutgoingMessage(
          msg.id,
          'SENT',
          correlationId,
          recipientId,
        );
        if (!updated) throw new CampaignClaimLostError();
        sentCount += 1;
      }

      const stats = await database.getCampaignQueueStats(campaignId);
      onProgress?.({ sent: stats.sent, failed: stats.failed, pending: stats.pending, total: stats.total });
    }

    return {
      dispatched: messages.length,
      sent: sentCount,
      failed: failedCount,
      retried: retriedCount,
      blocked: false,
    };
  } finally {
    clearInterval(heartbeat);
    await database.releaseClaimedOutgoingMessages(correlationId);
  }
}

function getRecipientId(message: OutgoingMessage): string | null {
  if (!message.payload_json) return null;
  const payload: unknown = JSON.parse(message.payload_json);
  if (typeof payload !== 'object' || payload === null) return null;
  const recipientId = (payload as Record<string, unknown>).recipientId;
  return typeof recipientId === 'string' ? recipientId : null;
}

/**
 * معالجة إرسال الحملة بالكامل دفعات متتالية مع تقرير التقدم
 */
export async function processFullCampaignDispatch(
  campaignId: string,
  gatewayId: string,
  onProgress?: (stats: { sent: number; failed: number; pending: number; total: number }) => void,
  customSettings?: AppSettings,
): Promise<{ sent: number; failed: number; total: number; blocked: boolean; blockReason?: string }> {
  const settings = customSettings ?? (await loadSettings());

  while (true) {
    const stats = await database.getCampaignQueueStats(campaignId);
    if (onProgress) {
      onProgress(stats);
    }

    if (stats.pending === 0) {
      if (stats.sending > 0) {
        throw new Error('الحملة قيد المعالجة من عملية إرسال أخرى.');
      }
      return {
        sent: stats.sent,
        failed: stats.failed,
        total: stats.total,
        blocked: false,
      };
    }

    const batchRes = await dispatchNextBatch(campaignId, gatewayId, settings, onProgress);

    if (batchRes.blocked) {
      const finalStats = await database.getCampaignQueueStats(campaignId);
      return {
        sent: finalStats.sent,
        failed: finalStats.failed + finalStats.blocked,
        total: finalStats.total,
        blocked: true,
        blockReason: batchRes.blockReason,
      };
    }

    // إذا لم يتم إرسال أي عنصر في الدفعة (مثلاً جميعها قيد الانتظار لموعد لاحق) نخرج لمنع حلقة لانهائية
    if (batchRes.dispatched === 0) {
      const currentStats = await database.getCampaignQueueStats(campaignId);
      if (currentStats.sending > 0) {
        throw new Error('الحملة قيد المعالجة من عملية إرسال أخرى.');
      }
      break;
    }

    const remaining = await database.getCampaignQueueStats(campaignId);
    if (remaining.pending > 0) {
      const batchDelay = calculateEffectiveDelayMs(settings, 0);
      if (batchDelay > 0) await sleep(batchDelay);
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
