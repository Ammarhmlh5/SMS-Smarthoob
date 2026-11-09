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
  sleepForDelay,
} from '../lib/throttlePolicy.ts';
import {
  CampaignClaimLostError,
  fetchGatewaySubscribers,
  sendGatewayMessageWithRetry,
  UncertainGatewayDeliveryError,
} from '../lib/gatewayDelivery.ts';
import type { GatewayConnection } from '../lib/gatewaySettings.ts';
import { createUuid, isUuid } from '../lib/ids.ts';
import { buildDocumentRecipients } from '../lib/documentRecipients.ts';
import { parseCSV } from '../lib/csv.ts';
import { normalizeSmsPhone } from '../lib/phoneNumber.ts';
import { validateCampaignDispatch } from '../lib/campaignDispatchValidation.ts';
import { isCampaignRecord } from '../lib/campaignRecord.ts';
import {
  canResumeCampaignQueue,
  resolveCampaignQueueStatus,
} from '../lib/campaignQueueStatus.ts';
import {
  CAMPAIGN_CLAIM_LEASE_MS,
  EXPIRED_CLAIM_ERROR,
  getExpiredClaimRecoveryStatus,
  isUncertainDeliveryError,
  isCampaignClaimExpired,
} from '../lib/campaignClaimLease.ts';

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

async function runTests() {
  console.log('\n=== 1. اختبار سياسة التدفق والتأخير (Throttle Policy) ===');

  // 1.1 فحص تحليل Retry-After
  assert(parseRetryAfterMs('5') === 5000, 'تحليل Retry-After كرقم ثواني (5 -> 5000ms)');
  assert(parseRetryAfterMs('120') === 120000, 'تحليل Retry-After لـ 120 ثانية (120000ms)');
  assert(parseRetryAfterMs('0') === 0, 'تحليل Retry-After لصفر ثانية');
  assert(parseRetryAfterMs('') === null, 'تجاهل Retry-After الفارغة');
  assert(parseRetryAfterMs(null) === null, 'تجاهل Retry-After الخالية (null)');
  assert(parseRetryAfterMs('invalid') === null, 'تجاهل قيم غير رقمية أو غير صالحة');
  assert(parseRetryAfterMs('5seconds') === null, 'رفض Retry-After الرقمية ذات لاحقة غير صالحة');
  assert(parseRetryAfterMs('1.5') === null, 'رفض Retry-After الكسرية غير المطابقة لصيغة الثواني');
  assert(
    parseRetryAfterMs('Sun, 06 Nov 2099 08:49:37 GMT') !== null,
    'تحليل Retry-After بصيغة HTTP-date القياسية',
  );
  assert(
    parseRetryAfterMs('999999999999999999999999999999') === null,
    'رفض Retry-After التي تتجاوز مجال المللي ثانية الآمن',
  );
  const timerChunks: number[] = [];
  await sleepForDelay(2_147_483_648, (callback, timeoutMs) => {
    timerChunks.push(timeoutMs);
    callback();
  });
  assert(
    timerChunks.length === 2 &&
      timerChunks[0] === 2_147_483_647 &&
      timerChunks[1] === 1,
    'تقسيم Retry-After الطويلة إلى مؤقتات ضمن حد JavaScript',
  );

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
  assert(isRetryableError(new Error('Failed to fetch')) === true, 'خطأ المتصفح failed to fetch قابل للإعادة');
  const aborted = new Error('The operation was aborted');
  aborted.name = 'AbortError';
  assert(isRetryableError(aborted) === true, 'انتهاء مهلة الاتصال قابل للإعادة');
  assert(isRetryableError(new Error('SyntaxError: unexpected token')) === false, 'خطأ برمجي/بنائي غير قابل للإعادة');

  console.log('\n=== 4. اختبار الاتصال المباشر ببوابة الإرسال ===');
  assert(isUuid(createUuid()), 'معرّفات الحملات والقوالب متوافقة مع UUID في Supabase');
  const readyDocumentRecipients = buildDocumentRecipients({
    columns: ['phone', 'message'],
    records: [
      { phone: '+966500000001', message: 'رسالة جاهزة 1' },
      { phone: '+966500000002', message: 'رسالة جاهزة 2' },
    ],
    rowCount: 2,
    mapping: {},
  });
  assert(
    readyDocumentRecipients[0].message === 'رسالة جاهزة 1' &&
      readyDocumentRecipients.length === 2,
    'المستندات ذات الرسائل الجاهزة تُجهز محلياً دون قالب أو استدعاء خادم',
  );
  const renderedDocumentRecipients = buildDocumentRecipients({
    columns: ['phone', 'name'],
    records: [{ phone: '+966500000003', name: 'سارة' }],
    rowCount: 1,
    mapping: { الاسم: 'name' },
    templateBody: 'مرحباً {{الاسم}}',
    renderMessage: (body, data) => body.replace('{{الاسم}}', data.الاسم),
  });
  assert(
    renderedDocumentRecipients[0].message === 'مرحباً سارة',
    'إنشاء نص الرسالة من القالب وبيانات الصف يتم محلياً',
  );
  const parsedCsv = parseCSV(
    '\uFEFFphone,message\r\n+966500000005,"رسالة، ""جاهزة""\nللسطر التالي"\r\n',
  );
  assert(
    parsedCsv.headers[0] === 'phone' &&
      parsedCsv.rows[0][1] === 'رسالة، "جاهزة"\nللسطر التالي',
    'تحليل CSV على الجهاز يحافظ على العربية والاقتباسات والأسطر داخل الرسالة',
  );
  const semicolonCsv = parseCSV('الهاتف;الرسالة\n+966500000006;رسالة جاهزة');
  assert(
    semicolonCsv.headers.length === 2 &&
      semicolonCsv.rows[0][1] === 'رسالة جاهزة',
    'اكتشاف فاصل CSV المنقوط الشائع في إعدادات اللغة العربية',
  );
  let rejectedPartialDocument = false;
  try {
    buildDocumentRecipients({
      columns: ['phone'],
      records: [{ phone: '+966500000004' }],
      rowCount: 2,
      mapping: {},
      templateBody: 'رسالة',
      renderMessage: (body) => body,
    });
  } catch {
    rejectedPartialDocument = true;
  }
  assert(rejectedPartialDocument, 'رفض إنشاء حملة من عينة مستند جزئية دون اختلاق مستلمين');
  assert(
    normalizeSmsPhone('٠٠٩٦٦ (٥٠) ٠٠٠-٠٠٠٠') === '+966500000000' &&
      normalizeSmsPhone('customer@example.test') === null,
    'تطبيع أرقام الهاتف العربية والتحقق من رفض البريد والقيم غير الصالحة',
  );
  const validCampaignRecord = {
    id: 'campaign-1',
    name: 'حملة اختبار',
    template_id: null,
    connection_id: 'gateway-1',
    status: 'sending',
    total_recipients: 1,
    sent_count: 0,
    failed_count: 0,
    created_at: '2026-11-09T10:00:00.000Z',
    updated_at: '2026-11-09T10:00:00.000Z',
  };
  assert(isCampaignRecord(validCampaignRecord), 'قبول سجل حملة مكتمل بحالة معروفة');
  assert(
    !isCampaignRecord({ ...validCampaignRecord, status: 'unknown' }),
    'رفض حالة حملة غير مدعومة بدلاً من تعطل شارة الحالة',
  );
  assert(
    !isCampaignRecord({ ...validCampaignRecord, total_recipients: Number.NaN }),
    'رفض أعداد حملة غير صالحة',
  );
  assert(
    !isCampaignRecord({ ...validCampaignRecord, created_at: 'invalid-date' }),
    'رفض تاريخ إنشاء حملة غير صالح',
  );
  const dispatchRecipient = {
    id: 'recipient-1',
    campaign_id: 'campaign-1',
    subscriber_phone: '+966500000000',
    message_body: 'رسالة اختبار',
  };
  const dispatchMessage = {
    phone: '+966500000000',
    message: 'رسالة اختبار',
    payload: { recipientId: 'recipient-1' },
  };
  let validDispatchAccepted = true;
  try {
    validateCampaignDispatch('campaign-1', 1, [dispatchRecipient], [dispatchMessage]);
  } catch {
    validDispatchAccepted = false;
  }
  assert(validDispatchAccepted, 'قبول ربط رسالة صحيحة بمستلمها عند إنشاء الحملة');
  let mismatchedDispatchRejected = false;
  try {
    validateCampaignDispatch('campaign-1', 1, [dispatchRecipient], [{
      ...dispatchMessage,
      phone: '+966500000001',
      payload: { recipientId: 'recipient-2' },
    }]);
  } catch {
    mismatchedDispatchRejected = true;
  }
  assert(mismatchedDispatchRejected, 'رفض رقم هاتف أو معرّف مستلم لا يطابق رسالة الحملة');

  const connection: GatewayConnection = {
    id: 'gateway-1',
    endpoint_url: 'https://gateway.example.test/send',
    sender_name: 'Smarthoob',
    api_key: 'test-secret',
    created_at: '',
    updated_at: '',
  };
  const requests: RequestInit[] = [];
  const responses = [
    new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } }),
    new Response(null, { status: 200 }),
  ];
  await sendGatewayMessageWithRetry(
    connection,
    '+966500000000',
    'رسالة اختبار',
    1,
    {
      apiBaseUrl: 'https://unused.example.test',
      delayBetweenMs: 0,
      batchSize: 10,
      maxRetryAttempts: 1,
      enableRemoteSend: true,
    },
    undefined,
    async (_input, init) => {
      if (init) requests.push(init);
      return responses.shift()!;
    },
  );
  const sentRequest = JSON.parse(String(requests[0].body)) as Record<string, string>;
  assert(requests.length === 2, 'إعادة المحاولة بعد استجابة HTTP 429');
  assert(requests[0].method === 'POST', 'الإرسال المباشر يستخدم POST');
  assert(
    (requests[0].headers as Record<string, string>).Authorization === 'Bearer test-secret',
    'مفتاح البوابة يُرسل مباشرة إلى نقطة النهاية المحددة',
  );
  assert(
    sentRequest.sender === 'Smarthoob' &&
      sentRequest.to === '+966500000000' &&
      sentRequest.message === 'رسالة اختبار',
    'حمولة الإرسال تتضمن اسم المرسل والمستلم والرسالة',
  );
  let staleClaimRequests = 0;
  let staleClaimRejected = false;
  try {
    await sendGatewayMessageWithRetry(
      connection,
      '+966500000000',
      'رسالة اختبار',
      0,
      {
        apiBaseUrl: 'https://unused.example.test',
        delayBetweenMs: 0,
        batchSize: 10,
        maxRetryAttempts: 0,
        enableRemoteSend: true,
      },
      undefined,
      async () => {
        staleClaimRequests += 1;
        return new Response(null, { status: 200 });
      },
      async () => false,
    );
  } catch (error) {
    staleClaimRejected = error instanceof CampaignClaimLostError;
  }
  assert(
    staleClaimRejected && staleClaimRequests === 0,
    'إيقاف الإرسال قبل طلب البوابة عند انتهاء ملكية الحجز',
  );
  let uncertainNetworkRequests = 0;
  let uncertainNetworkError = false;
  try {
    await sendGatewayMessageWithRetry(
      connection,
      '+966500000000',
      'رسالة اختبار',
      3,
      {
        apiBaseUrl: 'https://unused.example.test',
        delayBetweenMs: 0,
        batchSize: 10,
        maxRetryAttempts: 3,
        enableRemoteSend: true,
      },
      undefined,
      async () => {
        uncertainNetworkRequests += 1;
        throw new Error('Network request failed');
      },
    );
  } catch (error) {
    uncertainNetworkError = error instanceof UncertainGatewayDeliveryError;
  }
  assert(
    uncertainNetworkError && uncertainNetworkRequests === 1,
    'عدم إعادة طلب الشبكة ذي النتيجة غير المؤكدة تلقائياً',
  );
  assert(
    isUncertainDeliveryError(
      uncertainNetworkError ? 'نتيجة الإرسال غير مؤكدة؛ لم يصل رد.' : 'فشل الإرسال',
    ),
    'تصنيف خطأ الشبكة غير المؤكد ضمن حالات المراجعة اليدوية',
  );
  let uncertainServerRequests = 0;
  let uncertainServerError = false;
  try {
    await sendGatewayMessageWithRetry(
      connection,
      '+966500000000',
      'رسالة اختبار',
      3,
      {
        apiBaseUrl: 'https://unused.example.test',
        delayBetweenMs: 0,
        batchSize: 10,
        maxRetryAttempts: 3,
        enableRemoteSend: true,
      },
      undefined,
      async () => {
        uncertainServerRequests += 1;
        return new Response('upstream timed out', { status: 503 });
      },
    );
  } catch (error) {
    uncertainServerError = error instanceof UncertainGatewayDeliveryError;
  }
  assert(
    uncertainServerError && uncertainServerRequests === 1,
    'عدم إعادة استجابة HTTP 5xx تلقائياً لاحتمال قبول البوابة للرسالة',
  );
  let unreadableErrorResponseRequests = 0;
  let unreadableErrorResponseIsUncertain = false;
  try {
    await sendGatewayMessageWithRetry(
      connection,
      '+966500000000',
      'رسالة اختبار',
      3,
      {
        apiBaseUrl: 'https://unused.example.test',
        delayBetweenMs: 0,
        batchSize: 10,
        maxRetryAttempts: 3,
        enableRemoteSend: true,
      },
      undefined,
      async () => {
        unreadableErrorResponseRequests += 1;
        const response = new Response(null, { status: 503 });
        response.text = async () => {
          throw new Error('Network failed while reading response body');
        };
        return response;
      },
    );
  } catch (error) {
    unreadableErrorResponseIsUncertain = error instanceof UncertainGatewayDeliveryError;
  }
  assert(
    unreadableErrorResponseIsUncertain && unreadableErrorResponseRequests === 1,
    'الحفاظ على غموض نتيجة 5xx إذا تعذرت قراءة جسم الرد دون إعادة POST',
  );
  const subscribers = await fetchGatewaySubscribers(connection, async (_input, init) => {
    assert(init?.method === 'GET', 'جلب المستلمين يتم مباشرة عبر GET');
    return new Response(JSON.stringify([
      { phone: '+966500000000', name: 'عميل' },
      { email: 'customer@example.test', full_name: 'مستلم' },
    ]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
  assert(
    subscribers.length === 1 && subscribers[0].phone === '+966500000000',
    'تحويل أرقام الهاتف فقط واستبعاد مستلمي البريد من حملة SMS',
  );

  console.log('\n=== 5. اختبار حالة الحملة بحسب الطابور المحلي ===');
  assert(
    resolveCampaignQueueStatus({ pending: 0, sending: 1, sent: 2, blocked: 0 }) === 'sending',
    'إبقاء الحملة نشطة ما دامت عملية إرسال تملك رسائل',
  );
  assert(
    resolveCampaignQueueStatus({ pending: 2, sending: 0, sent: 1, blocked: 0 }) === 'failed',
    'إبقاء الرسائل المعلقة قابلة للاستكمال بعد تعثر الإرسال',
  );
  assert(
    resolveCampaignQueueStatus({ pending: 0, sending: 0, sent: 1, blocked: 0 }) === 'completed',
    'اكتمال الحملة بعد انتهاء الطابور مع وجود رسائل مرسلة',
  );
  assert(
    resolveCampaignQueueStatus({ pending: 0, sending: 0, sent: 0, blocked: 1 }) === 'failed',
    'تسجيل الحملة فاشلة عندما تمنعها سياسة الإرسال',
  );
  assert(
    canResumeCampaignQueue({ pending: 1, sending: 0 }),
    'إتاحة الاستكمال عند وجود رسائل معلقة حتى لو كانت حالة الحملة المحفوظة مختلفة',
  );
  assert(
    !canResumeCampaignQueue({ pending: 1, sending: 1 }) &&
      !canResumeCampaignQueue({ pending: 0, sending: 0 }),
    'منع الاستكمال عند غياب المعلق أو وجود عملية إرسال جارية',
  );
  const claimUpdatedAt = new Date(1_000_000).toISOString();
  assert(
    !isCampaignClaimExpired(claimUpdatedAt, 1_000_000 + CAMPAIGN_CLAIM_LEASE_MS - 1) &&
      isCampaignClaimExpired(claimUpdatedAt, 1_000_000 + CAMPAIGN_CLAIM_LEASE_MS),
    'استعادة الحجوزات المنتهية فقط بعد انتهاء مهلة الحجز',
  );
  assert(
    !isCampaignClaimExpired('invalid timestamp', 1_000_000 + CAMPAIGN_CLAIM_LEASE_MS),
    'عدم اعتبار الطابع الزمني غير الصالح حجزاً منتهياً تلقائياً',
  );
  assert(
    EXPIRED_CLAIM_ERROR.includes('لم تُعد تلقائياً لتجنب تكرار الإرسال'),
    'توضيح أن نتيجة الرسالة المنقطعة غير مؤكدة ولن تعاد تلقائياً',
  );
  assert(
    isUncertainDeliveryError(EXPIRED_CLAIM_ERROR) &&
      !isUncertainDeliveryError('فشل دائم من بوابة الإرسال'),
    'تمييز فشل النتيجة غير المؤكدة عن بقية حالات الفشل',
  );
  assert(
    getExpiredClaimRecoveryStatus('CLAIMED') === 'RETRY_WAITING' &&
      getExpiredClaimRecoveryStatus('SENDING') === 'FAILED',
    'إعادة الرسائل المحجوزة غير المرسلة فقط، وعزل نتيجة الرسالة التي بدأ طلبها',
  );

  console.log('\n======================================================');
  console.log(`ملخص نتائج الاختبار: ${passed} اجتاز بنجاح | ${failed} فاشل`);
  if (failed > 0) {
    process.exit(1);
  } else {
    console.log('🎉 جميع اختبارات الأمان والتدفق اجتازت الفحص بنجاح 100%!');
  }
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
