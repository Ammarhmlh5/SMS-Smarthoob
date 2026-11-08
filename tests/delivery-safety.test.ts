/**
 * delivery-safety.test.ts
 * فحص واختبار سلامة طبقة الإرسال وقواعد التحكم في التدفق والتأخير.
 * تشغيل مباشر:
 * node --experimental-strip-types tests/delivery-safety.test.ts
 */

import {
  calculateEffectiveDelayMs,
  isRetryableError,
  isRetryableHttpStatus,
  parseRetryAfterMs,
} from '../lib/throttlePolicy.ts';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✅ ${testName}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${testName}`);
    failed++;
  }
}

function runTests() {
  console.log('\n=== 1. اختبار سياسة التدفق والتأخير (Throttle Policy) ===');

  // 1.1 فحص تحليل Retry-After
  assert(parseRetryAfterMs('5') === 5000, 'تحليل Retry-After كرقم ثواني (5 -> 5000ms)');
  assert(parseRetryAfterMs('120') === 120000, 'تحليل Retry-After لـ 120 ثانية (120000ms)');
  assert(parseRetryAfterMs('0') === 0, 'تحليل Retry-After لصفر ثانية');
  assert(parseRetryAfterMs('') === null, 'تجاهل Retry-After الفارغة');
  assert(parseRetryAfterMs(null) === null, 'تجاهل Retry-After الخالية (null)');
  assert(parseRetryAfterMs('invalid') === null, 'تجاهل قيم غير رقمية أو غير صالحة');

  // 1.2 فحص حساب التأخير مع Exponential Backoff
  const mockSettings = {
    apiBaseUrl: 'http://localhost:8000',
    delayBetweenMs: 500,
    batchSize: 50,
    maxRetryAttempts: 3,
    enableRemoteSend: false,
  };

  const delay0 = calculateEffectiveDelayMs(mockSettings, 0);
  assert(delay0 === 500, 'التأخير للمحاولة الأولى يطابق delayBetweenMs (500ms)');

  const delay1 = calculateEffectiveDelayMs(mockSettings, 1);
  assert(delay1 === 500, 'التأخير للمحاولة الثانية (500ms)');

  const delay2 = calculateEffectiveDelayMs(mockSettings, 2);
  assert(delay2 === 1000, 'التأخير للمحاولة الثالثة يتضاعف أسياً (1000ms)');

  const delay3 = calculateEffectiveDelayMs(mockSettings, 3);
  assert(delay3 === 2000, 'التأخير للمحاولة الرابعة يتضاعف أسياً (2000ms)');

  const delayMax = calculateEffectiveDelayMs({ ...mockSettings, delayBetweenMs: 20000 }, 4);
  assert(delayMax <= 30000, 'سقف أقصى للتأخير الأسي لا يتجاوز 30 ثانية');

  const serverHeaderDelay = calculateEffectiveDelayMs(mockSettings, 0, '10');
  assert(serverHeaderDelay === 10000, 'أولوية تأخير الخادم Retry-After (10 ثواني) على إعدادات التطبيق');

  console.log('\n=== 2. اختبار تصنيف حالات ورموز HTTP (HTTP Status Classifications) ===');

  // 2.1 الرموز القابلة للإعادة (Transient Errors)
  assert(isRetryableHttpStatus(429) === true, 'رمز 429 (تجاوز المعدل) قابل للإعادة');
  assert(isRetryableHttpStatus(502) === true, 'رمز 502 (Bad Gateway) قابل للإعادة');
  assert(isRetryableHttpStatus(503) === true, 'رمز 503 (Service Unavailable) قابل للإعادة');
  assert(isRetryableHttpStatus(504) === true, 'رمز 504 (Gateway Timeout) قابل للإعادة');

  // 2.2 الرموز الدائمة (Permanent Errors — عدم تكرار غير آمن)
  assert(isRetryableHttpStatus(400) === false, 'رمز 400 (Bad Request) غير قابل للإعادة');
  assert(isRetryableHttpStatus(401) === false, 'رمز 401 (Unauthorized) غير قابل للإعادة');
  assert(isRetryableHttpStatus(403) === false, 'رمز 403 (Forbidden) غير قابل للإعادة');
  assert(isRetryableHttpStatus(404) === false, 'رمز 404 (Not Found) غير قابل للإعادة');
  assert(isRetryableHttpStatus(422) === false, 'رمز 422 (Unprocessable) غير قابل للإعادة');
  assert(isRetryableHttpStatus(500) === false, 'رمز 500 (Server Error) غير قابل للإعادة الافتراضية لحماية المنصة');

  console.log('\n=== 3. اختبار استثناءات الشبكة (Network Exceptions) ===');

  assert(isRetryableError(new Error('Network request failed')) === true, 'خطأ انقطاع الشبكة قابل للإعادة');
  assert(isRetryableError(new Error('Connection timeout')) === true, 'خطأ انتهاء المهلة قابل للإعادة');
  assert(isRetryableError(new Error('Fetch failed')) === true, 'خطأ fetch failed قابل للإعادة');
  assert(isRetryableError(new Error('SyntaxError: unexpected token')) === false, 'خطأ برمجي/بنائي غير قابل للإعادة');

  console.log('\n======================================================');
  console.log(`ملخص نتائج الاختبار: ${passed} اجتاز بنجاح | ${failed} فاشل`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 جميع اختبارات الأمان والتدفق اجتازت الفحص بنجاح 100%!');
  }
}

runTests();
