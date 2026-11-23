import { isLocalApiConfigured, supabase } from '@/lib/supabase';
import { getConnectionTestError } from './connectionTestError';

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
  default_connection_id: string | null;
  default_connection_ready: boolean;
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
  error?: string;
};

type PreferenceRow = {
  default_connection_id: string | null;
  default_connection_ready: boolean;
  batch_size: number;
  max_retries: number;
  updated_at: string;
};

const CONNECTION_COLUMNS = 'id, endpoint_url, sender_name, api_key, created_at, updated_at';
const PREFERENCE_COLUMNS = 'default_connection_id, batch_size, max_retries, updated_at';
const LEGACY_PREFERENCE_COLUMNS = 'batch_size, max_retries, updated_at';
const MAX_SENDER_LENGTH = 11;

function isMissingDefaultConnectionColumn(error: { code?: string; message?: string }): boolean {
  return (
    (error.code === '42703' || error.code === 'PGRST204') &&
    error.message?.includes('default_connection_id') === true
  );
}

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

async function ensureLegacyPreferences(userId: string): Promise<PreferenceRow> {
  const { data, error } = await supabase
    .from('gateway_settings')
    .select(LEGACY_PREFERENCE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return { ...data, default_connection_id: null, default_connection_ready: false };

  const { data: created, error: insertError } = await supabase
    .from('gateway_settings')
    .insert({ batch_size: 50, max_retries: 3 })
    .select(LEGACY_PREFERENCE_COLUMNS)
    .single();
  if (insertError) {
    if (insertError.code !== '23505') throw insertError;
    const { data: existing, error: readError } = await supabase
      .from('gateway_settings')
      .select(LEGACY_PREFERENCE_COLUMNS)
      .eq('user_id', userId)
      .single();
    if (readError) throw readError;
    return { ...existing, default_connection_id: null, default_connection_ready: false };
  }
  return { ...created, default_connection_id: null, default_connection_ready: false };
}

async function ensurePreferences(userId: string): Promise<PreferenceRow> {
  const { data, error } = await supabase
    .from('gateway_settings')
    .select(PREFERENCE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) {
    if (isMissingDefaultConnectionColumn(error)) return ensureLegacyPreferences(userId);
    throw error;
  }
  if (data) return { ...data, default_connection_ready: true } as PreferenceRow;

  const { data: created, error: insertError } = await supabase
    .from('gateway_settings')
    .insert({ batch_size: 50, max_retries: 3 })
    .select(PREFERENCE_COLUMNS)
    .single();
  if (insertError) {
    if (isMissingDefaultConnectionColumn(insertError)) return ensureLegacyPreferences(userId);
    if (insertError.code !== '23505') throw insertError;
    const { data: existing, error: readError } = await supabase
      .from('gateway_settings')
      .select(PREFERENCE_COLUMNS)
      .eq('user_id', userId)
      .single();
    if (readError) {
      if (isMissingDefaultConnectionColumn(readError)) return ensureLegacyPreferences(userId);
      throw readError;
    }
    return { ...existing, default_connection_ready: true } as PreferenceRow;
  }
  return { ...created, default_connection_ready: true } as PreferenceRow;
}

export async function fetchGatewaySettings(): Promise<GatewaySettings> {
  try {
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

    const connections = connectionsResult.data ?? [];
    const defaultConnectionId = preferences.default_connection_ready
      ? connections.some((connection) => connection.id === preferences.default_connection_id)
        ? preferences.default_connection_id
        : connections[0]?.id ?? null
      : connections[0]?.id ?? null;
    if (
      preferences.default_connection_ready &&
      defaultConnectionId !== preferences.default_connection_id
    ) {
      const { error } = await supabase
        .from('gateway_settings')
        .update({ default_connection_id: defaultConnectionId })
        .eq('user_id', userId);
      if (error) throw error;
    }

    return {
      connections,
      default_connection_id: defaultConnectionId,
      default_connection_ready: preferences.default_connection_ready,
      batch_size: preferences.batch_size,
      max_retries: preferences.max_retries,
      updated_at: preferences.updated_at,
    };
  } catch (error) {
    if (isLocalApiConfigured) {
      return {
        connections: [],
        default_connection_id: null,
        default_connection_ready: false,
        batch_size: 50,
        max_retries: 3,
        updated_at: new Date(0).toISOString(),
      };
    }
    throw error;
  }
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
  const settings = await fetchGatewaySettings();

  const { data, error } = await supabase
    .from('gateway_connections')
    .insert({ endpoint_url, sender_name, api_key, user_id: userId })
    .select(CONNECTION_COLUMNS)
    .single();
  if (error) throw error;

  if (!settings.default_connection_id && settings.default_connection_ready) {
    const { error: defaultError } = await supabase
      .from('gateway_settings')
      .update({ default_connection_id: data.id })
      .eq('user_id', userId)
      .is('default_connection_id', null);
    if (defaultError) throw defaultError;
  }
  return data;
}

export async function saveDefaultGatewayConnection(id: string): Promise<GatewaySettings> {
  const userId = await requireUserId();
  const { data: connection, error: connectionError } = await supabase
    .from('gateway_connections')
    .select('id')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle();
  if (connectionError) throw connectionError;
  if (!connection) throw new Error('لم يتم العثور على خدمة الإرسال المحددة.');

  const { data, error } = await supabase
    .from('gateway_settings')
    .update({ default_connection_id: id, updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .select('user_id')
    .maybeSingle();
  if (error) {
    if (isMissingDefaultConnectionColumn(error)) {
      throw new Error('حدّث قاعدة البيانات بتطبيق ترحيل default_gateway_connection أولاً.');
    }
    throw error;
  }
  if (!data) throw new Error('تعذر حفظ خدمة الإرسال الافتراضية.');

  return fetchGatewaySettings();
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
    return { reachable: true, status: response.status };
  } catch (error) {
    return {
      reachable: false,
      status: null,
      error: getConnectionTestError(error),
    };
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
