import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { database } from '@/lib/database';

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

const FUNCTION_NAME = 'hoodhad-send';
const GENERIC_ERROR = 'تعذر الاتصال بالخادم. حاول مرة أخرى.';

function isCampaign(value: unknown): value is Campaign {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    typeof v.status === 'string' &&
    typeof v.total_recipients === 'number' &&
    typeof v.sent_count === 'number' &&
    typeof v.failed_count === 'number' &&
    typeof v.created_at === 'string' &&
    typeof v.updated_at === 'string'
  );
}

function isSubscriber(value: unknown): value is Subscriber {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.name === 'string' && (typeof v.email === 'string' || typeof v.phone === 'string');
}

function isSendResult(value: unknown): value is SendResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.campaign_id === 'string' &&
    typeof v.total === 'number' &&
    typeof v.sent === 'number' &&
    typeof v.failed === 'number' &&
    typeof v.status === 'string'
  );
}

async function errorMessageFrom(error: unknown): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    try {
      const body = (await error.context.json()) as { error?: unknown };
      if (typeof body.error === 'string') return body.error;
    } catch {
      return GENERIC_ERROR;
    }
  }
  return GENERIC_ERROR;
}

async function callFunction(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke(FUNCTION_NAME, {
    method: 'POST',
    body,
  });
  if (error) throw new Error(await errorMessageFrom(error));
  return data;
}

export async function fetchSubscribers(connectionId: string): Promise<Subscriber[]> {
  const data = await callFunction({ action: 'fetch_subscribers', connection_id: connectionId });
  const subscribers = (data as { subscribers?: unknown }).subscribers;
  if (!Array.isArray(subscribers) || !subscribers.every(isSubscriber)) {
    throw new Error(GENERIC_ERROR);
  }
  return subscribers;
}

export async function sendCampaign(params: {
  connection_id: string;
  template_id: string;
  campaign_name: string;
  batch_size: number;
  max_retries: number;
  recipients?: Subscriber[];
}): Promise<SendResult> {
  const { data: { user } } = await supabase.auth.getUser();
  const userId = user?.id || 'default';
  const now = new Date().toISOString();
  const campaignId = `camp_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

  // 1. If we have custom imported recipients, save them to local SQLite first
  if (params.recipients && params.recipients.length > 0) {
    try {
      await database.createCampaign({
        id: campaignId,
        name: params.campaign_name,
        template_id: params.template_id,
        connection_id: params.connection_id,
        status: 'sending',
        total_recipients: params.recipients.length,
        sent_count: 0,
        failed_count: 0,
        user_id: userId,
        created_at: now,
        updated_at: now,
      });

      await database.addRecipients(
        params.recipients.map((r, idx) => ({
          id: `recip_${campaignId}_${idx}`,
          campaign_id: campaignId,
          subscriber_phone: r.phone || r.email || '',
          subscriber_name: r.name,
          message_body: r.message || '',
          status: 'pending',
          sent_at: null,
          error_message: null,
        }))
      );

      // Queue in outgoing_messages table for controlled throttle/retry processing
      await database.queueCampaignMessages(
        campaignId,
        params.connection_id,
        params.recipients.map((r) => ({
          phone: r.phone || r.email || '',
          message: r.message || '',
          payload: r.data,
        })),
        params.max_retries
      );
    } catch (dbErr) {
      console.warn('Failed to save campaign locally before sending:', dbErr);
    }
  }

  // 2. Invoke cloud sending function
  try {
    const data = await callFunction({ action: 'send_campaign', ...params });
    if (isSendResult(data)) {
      // Update local campaign status
      database.updateCampaignStatus(
        campaignId,
        data.status === 'completed' ? 'completed' : 'failed',
        data.sent,
        data.failed
      ).catch(() => {});
      return data;
    }
  } catch (err) {
    console.warn('Cloud sendCampaign failed:', err);
    // If cloud call fails, update local campaign status to failed
    if (params.recipients) {
      await database.updateCampaignStatus(campaignId, 'failed', 0, params.recipients.length);
    }
    throw err;
  }

  throw new Error(GENERIC_ERROR);
}

export async function fetchCampaigns(userId?: string): Promise<Campaign[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    const effectiveUserId = userId || user?.id || 'default';

    // 1. Fetch from local SQLite DB first
    const localCampaigns = await database.getCampaigns(effectiveUserId);

    // Trigger non-blocking cloud sync if authenticated
    if (user) {
      database.syncWithSupabase().catch(() => {});
    }

    if (localCampaigns.length > 0) {
      return localCampaigns as any;
    }
  } catch (err) {
    console.warn('SQLite fetchCampaigns error, falling back to Supabase:', err);
  }

  // 2. Direct Supabase fallback
  try {
    const { data, error } = await supabase
      .from('campaigns')
      .select('id, name, template_id, connection_id, status, total_recipients, sent_count, failed_count, created_at, updated_at')
      .order('created_at', { ascending: false });
    if (!error && data) {
      return (data ?? []).filter(isCampaign);
    }
  } catch {
    // Offline or network error
  }

  return [];
}
