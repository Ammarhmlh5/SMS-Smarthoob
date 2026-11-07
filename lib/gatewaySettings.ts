import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

export type GatewayConnection = {
  id: string;
  endpoint_url: string;
  sender_name: string;
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

const FUNCTION_NAME = 'gateway-settings';
const GENERIC_ERROR = 'تعذر الاتصال بالخادم. حاول مرة أخرى.';

function isGatewayConnection(value: unknown): value is GatewayConnection {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof v.endpoint_url === 'string' &&
    typeof v.sender_name === 'string' &&
    typeof v.created_at === 'string' &&
    typeof v.updated_at === 'string'
  );
}

function isGatewaySettings(value: unknown): value is GatewaySettings {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.connections) &&
    v.connections.every(isGatewayConnection) &&
    typeof v.batch_size === 'number' &&
    typeof v.max_retries === 'number' &&
    typeof v.updated_at === 'string'
  );
}

function isConnectionTestResult(value: unknown): value is ConnectionTestResult {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.reachable === 'boolean' && (v.status === null || typeof v.status === 'number');
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

async function callGateway(body?: Record<string, unknown>) {
  const { data, error } = body
    ? await supabase.functions.invoke(FUNCTION_NAME, { method: 'POST', body })
    : await supabase.functions.invoke(FUNCTION_NAME, { method: 'GET' });
  if (error) throw new Error(await errorMessageFrom(error));
  return data;
}

export async function fetchGatewaySettings(): Promise<GatewaySettings> {
  const data = await callGateway();
  if (!isGatewaySettings(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function createGatewayConnection(input: ConnectionInput): Promise<GatewayConnection> {
  const data = await callGateway({ action: 'create', ...input });
  if (!isGatewayConnection(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function updateGatewayConnection(
  id: string,
  input: Partial<ConnectionInput>,
): Promise<GatewayConnection> {
  const data = await callGateway({ action: 'update', id, ...input });
  if (!isGatewayConnection(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function deleteGatewayConnection(id: string): Promise<void> {
  await callGateway({ action: 'delete', id });
}

export async function testGatewayConnection(id: string): Promise<ConnectionTestResult> {
  const data = await callGateway({ action: 'test', id });
  if (!isConnectionTestResult(data)) throw new Error(GENERIC_ERROR);
  return data;
}

export async function saveSendingPreferences(input: {
  batch_size: number;
  max_retries: number;
}): Promise<GatewaySettings> {
  const data = await callGateway({ action: 'save_preferences', ...input });
  if (!isGatewaySettings(data)) throw new Error(GENERIC_ERROR);
  return data;
}
