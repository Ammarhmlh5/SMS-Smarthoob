import type { AppSettings } from './settingsStore';
import type { GatewayConnection } from './gatewaySettings';
import { calculateEffectiveDelayMs, isRetryableError, sleepForDelay } from './throttlePolicy.ts';
import { UNCERTAIN_DELIVERY_ERROR_PREFIX } from './campaignClaimLease.ts';

export type GatewayRecipient = {
  phone?: string;
  email?: string;
  name: string;
  message?: string;
  data?: Record<string, string>;
};

export class GatewayDeliveryError extends Error {
  readonly status?: number;
  readonly retryAfter?: string | null;

  constructor(
    message: string,
    status?: number,
    retryAfter?: string | null,
  ) {
    super(message);
    this.name = 'GatewayDeliveryError';
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

export class CampaignClaimLostError extends Error {
  constructor() {
    super('انتهت ملكية حجز الرسالة؛ أوقف الإرسال لمنع التكرار.');
    this.name = 'CampaignClaimLostError';
  }
}

export class CampaignClaimCheckError extends Error {
  constructor(cause: unknown) {
    super('تعذر التحقق من ملكية حجز الرسالة.', { cause });
    this.name = 'CampaignClaimCheckError';
  }
}

export class UncertainGatewayDeliveryError extends Error {
  constructor(cause: unknown) {
    const detail = cause instanceof Error ? ` ${cause.message}` : '';
    super(
      `${UNCERTAIN_DELIVERY_ERROR_PREFIX} لم يصل رد من البوابة بعد بدء الطلب.${detail} لم تتم إعادة المحاولة تلقائياً؛ راجع سجل البوابة قبل الإرسال مجدداً.`,
      { cause },
    );
    this.name = 'UncertainGatewayDeliveryError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function responseError(response: Response, apiKey: string): Promise<string> {
  let body: string;
  try {
    body = (await response.text()).slice(0, 500);
  } catch {
    return `فشل الإرسال (HTTP ${response.status}؛ تعذرت قراءة تفاصيل الاستجابة)`;
  }
  const safeBody = body.replaceAll(apiKey, '[redacted]');
  if (!safeBody) return `فشل الإرسال (HTTP ${response.status})`;
  try {
    const parsed: unknown = JSON.parse(safeBody);
    if (isRecord(parsed)) {
      for (const key of ['error', 'message', 'detail']) {
        if (typeof parsed[key] === 'string') return parsed[key];
      }
    }
  } catch {
    return `فشل الإرسال (HTTP ${response.status}): ${safeBody}`;
  }
  return `فشل الإرسال (HTTP ${response.status}): ${safeBody}`;
}

export async function fetchGatewaySubscribers(
  connection: GatewayConnection,
  fetchImpl: typeof fetch = fetch,
): Promise<GatewayRecipient[]> {
  const response = await fetchWithTimeout(fetchImpl, connection.endpoint_url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${connection.api_key}`,
      Accept: 'application/json',
    },
  }, 15000);
  if (!response.ok) {
    throw new GatewayDeliveryError(
      await responseError(response, connection.api_key),
      response.status,
      response.headers.get('Retry-After'),
    );
  }

  const payload: unknown = await response.json();
  const record = isRecord(payload) ? payload : null;
  const items = Array.isArray(payload)
    ? payload
    : record?.data ?? record?.subscribers;
  if (!Array.isArray(items)) {
    throw new Error('استجابة البوابة لا تحتوي على قائمة مستلمين صالحة.');
  }

  return items.flatMap((item): GatewayRecipient[] => {
    if (!isRecord(item)) return [];
    const phone = item.phone ?? item.mobile ?? item.number;
    const name = item.name ?? item.subscriber_name ?? item.full_name;
    if (typeof phone !== 'string' || phone.trim().length === 0) return [];
    return [{
      phone,
      name: typeof name === 'string' ? name : '',
      message: typeof item.message === 'string' ? item.message : undefined,
    }];
  });
}

async function sendGatewayMessage(
  connection: GatewayConnection,
  phone: string,
  message: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchWithTimeout(fetchImpl, connection.endpoint_url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${connection.api_key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      sender: connection.sender_name,
      to: phone,
      message,
    }),
    }, 10000);
  } catch (error) {
    throw new UncertainGatewayDeliveryError(error);
  }
  if (!response.ok) {
    throw new GatewayDeliveryError(
      await responseError(response, connection.api_key),
      response.status,
      response.headers.get('Retry-After'),
    );
  }
}

function retryAfterFrom(error: unknown): string | null {
  return error instanceof GatewayDeliveryError ? error.retryAfter ?? null : null;
}

export async function sendGatewayMessageWithRetry(
  connection: GatewayConnection,
  phone: string,
  message: string,
  maxRetries: number,
  settings: AppSettings,
  onRetry?: (error: unknown) => void | Promise<void>,
  fetchImpl: typeof fetch = fetch,
  beforeAttempt?: () => Promise<boolean>,
): Promise<void> {
  if (!Number.isInteger(maxRetries) || maxRetries < 0) {
    throw new RangeError('يجب أن يكون عدد محاولات الإعادة صفراً أو أكثر.');
  }

  for (let attempt = 0; ; attempt++) {
    if (beforeAttempt) {
      let ownsClaim: boolean;
      try {
        ownsClaim = await beforeAttempt();
      } catch (error) {
        throw new CampaignClaimCheckError(error);
      }
      if (!ownsClaim) throw new CampaignClaimLostError();
    }

    try {
      await sendGatewayMessage(connection, phone, message, fetchImpl);
      return;
    } catch (error) {
      if (error instanceof UncertainGatewayDeliveryError) throw error;
      if (
        error instanceof GatewayDeliveryError &&
        (error.status === 408 || (error.status !== undefined && error.status >= 500))
      ) {
        throw new UncertainGatewayDeliveryError(error);
      }
      if (!isRetryableError(error) || attempt >= maxRetries) throw error;
      await onRetry?.(error);
      await sleepForDelay(
        calculateEffectiveDelayMs(settings, attempt + 1, retryAfterFrom(error)),
      );
    }
  }
}
