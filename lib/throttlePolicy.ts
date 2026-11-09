/**
 * throttlePolicy.ts
 * سياسة التحكم في معدل الطلبات والتأخير وإعادة المحاولة.
 * - حساب التأخير مع Exponential Backoff
 * - احترام ترويسة Retry-After من الخوادم
 * - تصنيف أخطاء HTTP إلى عابرة (قابلة للإعادة) أو دائمة
 */

import type { AppSettings } from './settingsStore';

export const MAX_TIMER_DELAY_MS = 2_147_483_647;

export async function sleepForDelay(
  delayMs: number,
  schedule: (callback: () => void, timeoutMs: number) => void = (callback, timeoutMs) => {
    setTimeout(callback, timeoutMs);
  },
): Promise<void> {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new RangeError('يجب أن يكون التأخير رقماً محدوداً وغير سالب.');
  }

  let remaining = Math.ceil(delayMs);
  while (remaining > 0) {
    const chunk = Math.min(remaining, MAX_TIMER_DELAY_MS);
    await new Promise<void>((resolve) => schedule(resolve, chunk));
    remaining -= chunk;
  }
}

/**
 * تحليل ترويسة Retry-After (ثواني أو تاريخ)
 * @param header القيمة الواردة من ترويسة الاستجابة
 * @returns عدد المللي ثانية التي يجب الانتظار خلالها
 */
export function parseRetryAfterMs(header?: string | null): number | null {
  if (!header) return null;
  const value = header.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    const milliseconds = seconds * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : null;
  }

  if (
    !/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/i.test(value)
  ) {
    return null;
  }

  const date = Date.parse(value);
  if (!isNaN(date)) {
    const diff = date - Date.now();
    return diff > 0 ? diff : 0;
  }

  return null;
}

/**
 * حساب التأخير الفعلي المطلوب قبل المحاولة التالية
 * الأولوية:
 * 1. Retry-After من الخادم إن وُجد
 * 2. Exponential Backoff محسوب من delayBetweenMs وعدد المحاولات السابقة
 */
export function calculateEffectiveDelayMs(
  settings: AppSettings,
  retryCount: number,
  retryAfterHeader?: string | null
): number {
  const serverDelay = parseRetryAfterMs(retryAfterHeader);
  if (serverDelay !== null) {
    return Math.max(serverDelay, settings.delayBetweenMs);
  }

  if (retryCount <= 0) {
    return Math.max(0, settings.delayBetweenMs);
  }

  // Backoff أسي: delay * 2^(retryCount - 1) بحد أقصى 30 ثانية
  const backoff = settings.delayBetweenMs * Math.pow(2, retryCount - 1);
  return Math.min(Math.max(backoff, settings.delayBetweenMs), 30000);
}

/**
 * تصنيف حالة رمز HTTP لمعرفة ما إذا كانت المحاولة قابلة للإعادة
 * - 429: تجاوز حد المعدل (Rate Limit) -> قابل للإعادة
 * - 502, 503, 504: تعثر مؤقت بالبوابة أو الخادم -> قابل للإعادة
 * - 400, 401, 403, 404, 422: أخطاء بيانات أو صلاحيات -> غير قابلة للإعادة
 * - 500: خطأ داخلي عام -> لا يُعاد إلا إذا كان عابراً
 */
export function isRetryableHttpStatus(statusCode: number): boolean {
  if (statusCode === 429) return true;
  if (statusCode === 502 || statusCode === 503 || statusCode === 504) return true;
  return false;
}

/**
 * تصنيف نوع الخطأ البرمجي (Network Error / Timeout / HTTP Status)
 */
export function isRetryableError(error: unknown): boolean {
  if (!error) return false;

  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    // أخطاء انقطاع الاتصال أو انتهاء المهلة قابلة للإعادة
    if (
      msg.includes('network') ||
      msg.includes('timeout') ||
      msg.includes('abort') ||
      msg.includes('connection refused') ||
      msg.includes('failed to fetch') ||
      msg.includes('fetch failed')
    ) {
      return true;
    }
  }

  // في حال احتواء الكائن على status
  const maybeStatus = (error as { status?: number })?.status;
  if (typeof maybeStatus === 'number') {
    return isRetryableHttpStatus(maybeStatus);
  }

  return false;
}
