import { supabase } from '@/lib/supabase';
import { database } from '@/lib/database';
import { fetchGatewaySubscribers } from '@/lib/gatewayDelivery';
import { fetchGatewaySettings, getGatewayConnection } from '@/lib/gatewaySettings';
import { evaluateSendGate } from '@/lib/sendGuard';
import { loadSettings } from '@/lib/settingsStore';
import { processFullCampaignDispatch } from '@/lib/remoteDispatch';
import { createUuid } from '@/lib/ids';
import { normalizeSmsPhone } from '@/lib/phoneNumber';
import { resolveCampaignQueueStatus } from '@/lib/campaignQueueStatus';
import { isCampaignRecord } from '@/lib/campaignRecord';

export type Campaign = {
  id: string;
  name: string;
  template_id: string | null;
  connection_id: string | null;
  status: 'draft' | 'sending' | 'completed' | 'failed';
  total_recipients: number;
  sent_count: number;
  failed_count: number;
  created_at: string;
  updated_at: string;
  sync_status?: 'synced' | 'pending' | 'conflict';
};

export type Subscriber = {
  email?: string;
  phone?: string;
  name: string;
  message?: string;
  data?: Record<string, string>;
};

export type SendResult = {
  campaign_id: string;
  total: number;
  sent: number;
  failed: number;
  status: 'completed' | 'failed';
};

function syncCampaignInBackground(): void {
  void database.syncWithSupabase().then((result) => {
    if (!result.success) console.warn('Campaign background sync failed:', result.message);
  }).catch((error) => {
    console.warn('Campaign background sync error:', error);
  });
}

function isCampaign(value: unknown): value is Campaign {
  return isCampaignRecord(value);
}

export async function fetchSubscribers(connectionId: string): Promise<Subscriber[]> {
  const connection = await getGatewayConnection(connectionId);
  return fetchGatewaySubscribers(connection);
}

export async function sendCampaign(params: {
  connection_id: string;
  template_id: string | null;
  campaign_name: string;
  batch_size: number;
  max_retries: number;
  recipients: Subscriber[];
}, onProgress?: (progress: { sent: number; failed: number; processed: number; total: number }) => void): Promise<SendResult> {
  if (!Number.isInteger(params.batch_size) || params.batch_size < 10 || params.batch_size > 100) {
    throw new Error('حجم الدفعة يجب أن يكون بين 10 و 100.');
  }
  if (!Number.isInteger(params.max_retries) || params.max_retries < 0 || params.max_retries > 5) {
    throw new Error('محاولات الإعادة يجب أن تكون بين 0 و 5.');
  }

  const gate = await evaluateSendGate({
    connectionId: params.connection_id,
    recipientsCount: params.recipients.length,
  });
  if (!gate.canProceed) throw new Error(gate.message);
  const recipients = params.recipients.map((recipient, index) => {
    const phone = recipient.phone ? normalizeSmsPhone(recipient.phone) : null;
    if (!phone) {
      throw new Error(`رقم الهاتف للمستلم ${index + 1} غير صالح لإرسال SMS.`);
    }
    if (!recipient.message?.trim()) {
      throw new Error(`نص الرسالة للمستلم ${index + 1} فارغ.`);
    }
    return { ...recipient, phone, message: recipient.message.trim() };
  });
  if (recipients.length === 0) {
    throw new Error('أضف مستلماً واحداً على الأقل قبل الإرسال.');
  }

  const [{ data: { user }, error: userError }, localSettings] = await Promise.all([
    supabase.auth.getUser(),
    loadSettings(),
  ]);
  if (userError) throw userError;
  if (!user) throw new Error('يجب تسجيل الدخول قبل إرسال الحملات.');
  const userId = user.id;
  const now = new Date().toISOString();
  const campaignId = createUuid();
  const settings = {
    ...localSettings,
    batchSize: params.batch_size,
    maxRetryAttempts: params.max_retries,
  };

  const campaign = {
    id: campaignId,
    name: params.campaign_name,
    template_id: params.template_id,
    connection_id: params.connection_id,
    status: 'sending' as const,
    total_recipients: recipients.length,
    sent_count: 0,
    failed_count: 0,
    user_id: userId,
    created_at: now,
    updated_at: now,
  };
  await database.createCampaignDispatch(
    campaign,
    recipients.map((recipient, index) => ({
        id: `recip_${campaignId}_${index}`,
        campaign_id: campaignId,
        subscriber_phone: recipient.phone,
        subscriber_name: recipient.name,
        message_body: recipient.message,
        status: 'pending',
        sent_at: null,
        error_message: null,
      })),
    params.connection_id,
    recipients.map((recipient, index) => ({
        phone: recipient.phone,
        message: recipient.message,
        payload: { recipientId: `recip_${campaignId}_${index}`, data: recipient.data },
      })),
    params.max_retries,
  );

  try {
    const result = await processFullCampaignDispatch(campaignId, params.connection_id, (progress) => {
      onProgress?.({
        sent: progress.sent,
        failed: progress.failed,
        processed: progress.sent + progress.failed,
        total: progress.total,
      });
    }, settings);
    const finalStats = await database.getCampaignQueueStats(campaignId);
    const status = resolveCampaignQueueStatus(finalStats, result.blocked);
    const failedCount = finalStats.failed + finalStats.blocked;
    await database.updateCampaignStatus(campaignId, status, finalStats.sent, failedCount);
    syncCampaignInBackground();
    if (status === 'sending') {
      throw new Error('توجد عملية إرسال أخرى تعمل على هذه الحملة.');
    }
    return {
      campaign_id: campaignId,
      total: finalStats.total,
      sent: finalStats.sent,
      failed: failedCount,
      status,
    };
  } catch (error) {
    try {
      const progress = await database.getCampaignQueueStats(campaignId);
      const status = resolveCampaignQueueStatus(progress);
      await database.updateCampaignStatus(
        campaignId,
        status,
        progress.sent,
        progress.failed + progress.blocked,
      );
      syncCampaignInBackground();
    } catch (statusError) {
      const detail = statusError instanceof Error ? statusError.message : 'خطأ غير معروف';
      throw new Error(`تعذر إكمال الحملة وتعذر حفظ حالتها المحلية: ${detail}`);
    }
    throw error;
  }
}

export async function resumeCampaign(
  campaignId: string,
  onProgress?: (progress: { sent: number; failed: number; processed: number; total: number }) => void,
): Promise<SendResult> {
  const campaign = await database.getCampaign(campaignId);
  if (!campaign?.connection_id) throw new Error('تعذر العثور على بوابة الحملة لاستكمال الإرسال.');

  const stats = await database.getCampaignQueueStats(campaignId);
  if (stats.sending > 0) {
    throw new Error('توجد رسائل قيد الإرسال حالياً. انتظر حتى تنتهي المحاولة الحالية.');
  }
  if (stats.pending === 0) throw new Error('لا توجد رسائل معلقة لاستكمالها.');

  const [localSettings, gatewaySettings] = await Promise.all([
    loadSettings(),
    fetchGatewaySettings(),
  ]);
  const settings = {
    ...localSettings,
    batchSize: gatewaySettings.batch_size,
    maxRetryAttempts: gatewaySettings.max_retries,
  };
  const gate = await evaluateSendGate({
    connectionId: campaign.connection_id,
    recipientsCount: stats.pending,
    customSettings: settings,
  });
  if (!gate.canProceed) throw new Error(gate.message);

  await database.updateCampaignStatus(campaignId, 'sending', stats.sent, stats.failed);

  try {
    const result = await processFullCampaignDispatch(
      campaignId,
      campaign.connection_id,
      (progress) => {
        onProgress?.({
          sent: progress.sent,
          failed: progress.failed,
          processed: progress.sent + progress.failed,
          total: progress.total,
        });
      },
      settings,
    );
    const finalStats = await database.getCampaignQueueStats(campaignId);
    const status = resolveCampaignQueueStatus(finalStats, result.blocked);
    const failedCount = finalStats.failed + finalStats.blocked;
    await database.updateCampaignStatus(campaignId, status, finalStats.sent, failedCount);
    syncCampaignInBackground();
    if (status === 'sending') {
      throw new Error('توجد عملية إرسال أخرى تعمل على هذه الحملة.');
    }
    return {
      campaign_id: campaignId,
      total: finalStats.total,
      sent: finalStats.sent,
      failed: failedCount,
      status,
    };
  } catch (error) {
    const currentStats = await database.getCampaignQueueStats(campaignId);
    const currentStatus = resolveCampaignQueueStatus(currentStats);
    await database.updateCampaignStatus(
      campaignId,
      currentStatus,
      currentStats.sent,
      currentStats.failed + currentStats.blocked,
    );
    syncCampaignInBackground();
    throw error;
  }
}

export async function fetchCampaigns(userId?: string): Promise<Campaign[]> {
  let localCampaigns: Campaign[] | null = null;
  const localErrors: string[] = [];
  let sessionUser: { id: string } | null = null;

  try {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    sessionUser = data.session?.user ?? null;
  } catch (error) {
    localErrors.push(
      error instanceof Error ? error.message : 'تعذر استعادة جلسة المستخدم المحفوظة.',
    );
  }

  try {
    const effectiveUserId = userId || sessionUser?.id || 'default';
    const localCampaignRows = await database.getCampaigns(effectiveUserId);
    const loadedCampaigns: Campaign[] = localCampaignRows.map((row) => ({
      ...row,
      status: row.status === 'preparing' ? 'sending' : row.status,
    }));
    localCampaigns = loadedCampaigns;

    if (sessionUser) {
      void database.syncWithSupabase().then((result) => {
        if (!result.success) console.warn('Campaign background sync failed:', result.message);
      }).catch((error) => {
        console.warn('Campaign background sync error:', error);
      });
    }

    if (loadedCampaigns.length > 0) {
      return loadedCampaigns;
    }
  } catch (err) {
    localErrors.push(
      err instanceof Error ? err.message : 'تعذر تحميل الحملات من قاعدة البيانات المحلية.',
    );
  }

  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, template_id, connection_id, status, total_recipients, sent_count, failed_count, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (error) throw error;
    if (!data) throw new Error('لم تُرجع خدمة الحملات بيانات صالحة.');
    const campaigns = data.filter(isCampaign);
    if (campaigns.length !== data.length) {
      throw new Error(`أعادت خدمة الحملات ${data.length - campaigns.length} سجلاً غير صالح.`);
    }
    return campaigns;
  } catch (remoteError) {
    if (localCampaigns !== null) return localCampaigns;
    const remoteMessage =
      remoteError instanceof Error ? remoteError.message : 'تعذر تحميل الحملات من الخدمة السحابية.';
    throw new Error(
      `تعذر تحميل الحملات محلياً أو سحابياً. المحلي: ${localErrors.join('؛ ') || 'تعذر استعادة بيانات المستخدم المحلية.'} السحابي: ${remoteMessage}`,
      {
      cause: remoteError,
      },
    );
  }
}
