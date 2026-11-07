import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

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
};

export type Subscriber = {
  email: string;
  name: string;
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
  return typeof v.email === 'string' && typeof v.name === 'string';
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
}): Promise<SendResult> {
  const data = await callFunction({ action: 'send_campaign', ...params });
  if (!isSendResult(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function fetchCampaigns(): Promise<Campaign[]> {
  const { data, error } = await supabase
    .from('campaigns')
    .select('id, name, template_id, connection_id, status, total_recipients, sent_count, failed_count, created_at, updated_at')
    .order('created_at', { ascending: false });
  if (error) throw new Error(GENERIC_ERROR);
  return (data ?? []).filter(isCampaign);
}
