import { supabase } from '@/lib/supabase';

export type GatewayConnection = {
  id: string;
  endpoint_url: string;
  sender_name: string;
  api_key: string;
  created_at: string;
  updated_at: string;
};

export type GatewaySettings = {
  connections: GatewayConnection[];
  batch_size: number;
  max_retries: number;
  updated_at: string;
};

export type ConnectionInput = {
  endpoint_url: string;
  sender_name: string;
  api_key: string;
};

export type ConnectionTestResult = {
  reachable: boolean;
  status: number | null;
};

type PreferenceRow = {
  batch_size: number;
  max_retries: number;
  updated_at: string;
};

const CONNECTION_COLUMNS = 'id, endpoint_url, sender_name, api_key, created_at, updated_at';
const PREFERENCE_COLUMNS = 'batch_size, max_retries, updated_at';
const MAX_SENDER_LENGTH = 11;

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('أدخل عنوان خدمة صالحاً يبدأ بـ https://');
  }
  if (url.protocol !== 'https:') throw new Error('يجب أن يبدأ عنوان الخدمة بـ https://');
  return url.toString();
}

function normalizeSender(value: string): string {
  const sender = value.trim();
  if (sender.length === 0 || sender.length > MAX_SENDER_LENGTH) {
    throw new Error(`اسم المرسل يجب أن يكون بين 1 و ${MAX_SENDER_LENGTH} حرفاً`);
  }
  return sender;
}

async function requireUserId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error) throw error;
  if (!data.user) throw new Error('يجب تسجيل الدخول لإدارة بوابات الإرسال.');
  return data.user.id;
}

async function ensurePreferences(userId: string): Promise<PreferenceRow> {
  const { data, error } = await supabase
    .from('gateway_settings')
    .select(PREFERENCE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data as PreferenceRow;

  const { data: created, error: insertError } = await supabase
    .from('gateway_settings')
    .insert({ batch_size: 50, max_retries: 3 })
    .select(PREFERENCE_COLUMNS)
    .single();
  if (insertError) {
    if (insertError.code !== '23505') throw insertError;
    const { data: existing, error: readError } = await supabase
      .from('gateway_settings')
      .select(PREFERENCE_COLUMNS)
      .eq('user_id', userId)
      .single();
    if (readError) throw readError;
    return existing as PreferenceRow;
  }
  return created as PreferenceRow;
}

export async function fetchGatewaySettings(): Promise<GatewaySettings> {
  const userId = await requireUserId();
  const [preferences, connectionsResult] = await Promise.all([
    ensurePreferences(userId),
    supabase
      .from('gateway_connections')
      .select(CONNECTION_COLUMNS)
      .eq('user_id', userId)
      .order('created_at', { ascending: true }),
  ]);
  if (connectionsResult.error) throw connectionsResult.error;

  return {
    connections: connectionsResult.data ?? [],
    batch_size: preferences.batch_size,
    max_retries: preferences.max_retries,
    updated_at: preferences.updated_at,
  };
}

export async function getGatewayConnection(id: string): Promise<GatewayConnection> {
  const { data, error } = await supabase
    .from('gateway_connections')
    .select(CONNECTION_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('لم يتم العثور على بوابة الإرسال المحددة.');
  normalizeEndpoint(data.endpoint_url);
  return data;
}

export async function createGatewayConnection(input: ConnectionInput): Promise<GatewayConnection> {
  const endpoint_url = normalizeEndpoint(input.endpoint_url);
  const sender_name = normalizeSender(input.sender_name);
  const api_key = input.api_key.trim();
  if (!api_key) throw new Error('أدخل مفتاح الربط');
  const userId = await requireUserId();

  const { data, error } = await supabase
    .from('gateway_connections')
    .insert({ endpoint_url, sender_name, api_key, user_id: userId })
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw error;
  return data;
}

export async function updateGatewayConnection(
  id: string,
  input: Partial<ConnectionInput>,
): Promise<GatewayConnection> {
  const changes: Partial<ConnectionInput> & { updated_at: string } = {
    updated_at: new Date().toISOString(),
  };
  if (input.endpoint_url !== undefined) changes.endpoint_url = normalizeEndpoint(input.endpoint_url);
  if (input.sender_name !== undefined) changes.sender_name = normalizeSender(input.sender_name);
  if (input.api_key?.trim()) changes.api_key = input.api_key.trim();

  const { data, error } = await supabase
    .from('gateway_connections')
    .update(changes)
    .eq('id', id)
    .select(CONNECTION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('لم يتم العثور على بوابة الإرسال المحددة.');
  return data;
}

export async function deleteGatewayConnection(id: string): Promise<void> {
  const { data, error } = await supabase
    .from('gateway_connections')
    .delete()
    .eq('id', id)
    .select('id');
  if (error) throw error;
  if (!data?.length) throw new Error('لم يتم العثور على بوابة الإرسال المحددة.');
}

export async function testGatewayConnection(id: string): Promise<ConnectionTestResult> {
  const connection = await getGatewayConnection(id);
  try {
    const response = await fetchWithTimeout(connection.endpoint_url, {
      method: 'HEAD',
    }, 8000);
    await response.body?.cancel();
    return { reachable: response.status < 500, status: response.status };
  } catch {
    return { reachable: false, status: null };
  }
}

export async function saveSendingPreferences(input: {
  batch_size: number;
  max_retries: number;
}): Promise<GatewaySettings> {
  if (!Number.isInteger(input.batch_size) || input.batch_size < 10 || input.batch_size > 100) {
    throw new Error('حجم الدفعة يجب أن يكون بين 10 و 100');
  }
  if (!Number.isInteger(input.max_retries) || input.max_retries < 0 || input.max_retries > 5) {
    throw new Error('محاولات الإعادة يجب أن تكون بين 0 و 5');
  }

  const userId = await requireUserId();
  await ensurePreferences(userId);
  const { error } = await supabase
    .from('gateway_settings')
    .update({ ...input, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) throw error;
  return fetchGatewaySettings();
}
