/**
 * throttlePolicy.ts
 * سياسة التحكم في معدل الطلبات والتأخير وإعادة المحاولة.
 * - حساب التأخير مع Exponential Backoff
 * - احترام ترويسة Retry-After من الخوادم
 * - تصنيف أخطاء HTTP إلى عابرة (قابلة للإعادة) أو دائمة
 */

import type { AppSettings } from './settingsStore';

/**
 * تحليل ترويسة Retry-After (ثواني أو تاريخ)
 * @param header القيمة الواردة من ترويسة الاستجابة
 * @returns عدد المللي ثانية التي يجب الانتظار خلالها
 */
export function parseRetryAfterMs(header?: string | null): number | null {
  if (!header) return null;

  // فحص ما إذا كانت القيمة رقماً مباشراً (ثواني)
  const seconds = parseInt(header, 10);
  if (!isNaN(seconds) && seconds >= 0) {
    return seconds * 1000;
  }

  // فحص ما إذا كانت تاريخاً بصيغة RFC 1123
  const date = Date.parse(header);
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
      msg.includes('connection refused') ||
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
