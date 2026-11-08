# دليل تنفيذ طبقة الإرسال المحمية

## 1. الهدف

هذا المستند يشرح كيف يتم تنفيذ طبقة الإرسال المحمية في تطبيق **هدهد الفواتير** (React Native / Expo) بشكل عملي، مع الحفاظ على جميع القيود التشغيلية.

الهدف النهائي:

- السماح فقط بالإرسال عندما يكون هناك بوابة نشطة وجلسة صالحة
- التحقق من وجود `gateway_id` مخزّن وصالح قبل أي إرسال
- عدم تشغيل الإرسال قبل التحقق من الاتصال بـ Supabase
- تطبيق تقليص معدل الطلبات (throttling) وإعادة المحاولة (retry) بشكل آمن
- استئناف الرسائل في قائمة الانتظار دون ازدواجية
- تسجيل كل محاولة عبر SQLite المحلي

---

## 2. مكونات التنفيذ

### 2.1 settingsStore (AsyncStorage)

المسؤولية:
- قراءة عنوان FastAPI المُعدّ من `AsyncStorage`
- حفظ إعدادات الدُفعة: `delayBetweenMs`, `batchSize`, `maxRetryAttempts`
- إدارة حالة الموافقة قبل الإرسال
- التحقق من صحة القيم قبل الحفظ

```typescript
// lib/settingsStore.ts
export interface AppSettings {
  apiBaseUrl: string;
  delayBetweenMs: number;      // التأخير بين الرسائل (ms)
  batchSize: number;            // عدد الرسائل في الدفعة
  maxRetryAttempts: number;     // الحد الأقصى لإعادة المحاولة
  connectTimeoutMs: number;     // مهلة الاتصال
  enableRemoteSend: boolean;    // feature flag: معطّل افتراضياً
}
```

### 2.2 gatewayKeyStore (expo-secure-store)

المسؤولية:
- تخزين بيانات البوابة بشكل مشفّر باستخدام `expo-secure-store`
- قراءتها عند الحاجة فقط
- عرضها بشكل مقنّع في الواجهة
- عدم تسجيل بيانات الاعتماد في السجلات

```typescript
import * as SecureStore from 'expo-secure-store';

export async function getGatewayCredential(gatewayId: string): Promise<string | null> {
  return SecureStore.getItemAsync(`gateway_key_${gatewayId}`);
}
```

### 2.3 SupabaseClient

المسؤولية:
- استدعاء دالة `hoodhad-send` Edge Function
- إرفاق JWT تلقائياً من الجلسة الحالية
- قراءة `Retry-After` من الاستجابة
- إرجاع نتيجة الإرسال مع حالة كل مستلم

### 2.4 throttlePolicy (lib/throttlePolicy.ts)

المسؤولية:
- حساب التأخير بين الطلبات
- حساب backoff عند الفشل
- تحليل `Retry-After` بصيغة الثواني
- تصنيف رموز HTTP إلى قابلة للإعادة أو دائمة

قواعد التشغيل المهمة:

| رمز HTTP | التصرف |
| --- | --- |
| 429 | قابل للإعادة — ينتظر `Retry-After` |
| 502 / 503 / 504 | قابل للإعادة |
| 400 / 422 | دائم — خطأ في البيانات |
| 401 / 403 | دائم — يُجدد الجلسة |
| 500 | لا يُعاد إلا إذا موثّق كمؤقت |

---

## 3. طبقة الحماية (Send Gate)

### 3.1 الفكرة

كل إرسال يجب أن يمر عبر طبقة واحدة: `PlatformSendGuard`.

### 3.2 منطق القرار

يُفحص ما يلي قبل كل إرسال فعلي:

1. هل يوجد مستخدم مسجّل دخوله (Supabase session صالحة)؟
2. هل يوجد `gateway_id` محدد في الحملة؟
3. هل البوابة نشطة ومفعّلة في قاعدة البيانات؟
4. هل عنوان Supabase Edge Function صحيح؟
5. هل feature flag `enableRemoteSend` مفعّل؟
6. هل تمّ فحص الاتصال (probe) مؤخراً بنجاح؟

إذا كان أي شرط مفقوداً، تُعد المحاولة `blocked`.

### 3.3 حالات الإرجاع

```typescript
type SendGateStatus =
  | 'APPROVED'
  | 'BLOCKED_NO_SESSION'
  | 'BLOCKED_MISSING_GATEWAY'
  | 'BLOCKED_GATEWAY_DISABLED'
  | 'BLOCKED_FEATURE_DISABLED'
  | 'BLOCKED_INVALID_STATE';
```

### 3.4 التنفيذ

```typescript
// lib/sendGuard.ts
export async function evaluateSendGate(
  campaignId: string,
  settings: AppSettings
): Promise<{ status: SendGateStatus; detail?: string }> {
  // 1. التحقق من الجلسة
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) {
    return { status: 'BLOCKED_NO_SESSION', detail: 'لم يتم تسجيل الدخول' };
  }

  // 2. التحقق من feature flag
  if (!settings.enableRemoteSend) {
    return { status: 'BLOCKED_FEATURE_DISABLED', detail: 'الإرسال الفعلي معطّل' };
  }

  // 3. التحقق من البوابة
  const campaign = await getCampaignById(campaignId);
  if (!campaign?.gatewayId) {
    return { status: 'BLOCKED_MISSING_GATEWAY', detail: 'لا توجد بوابة محددة للحملة' };
  }

  const gateway = await getGatewayById(campaign.gatewayId);
  if (!gateway?.isActive) {
    return { status: 'BLOCKED_GATEWAY_DISABLED', detail: 'البوابة غير نشطة' };
  }

  return { status: 'APPROVED' };
}
```

---

## 4. قائمة الانتظار المحلية (SQLite)

### 4.1 لماذا تحتاج قائمة انتظار؟

لأن الحملة محلية، لكن الإرسال إلى Supabase قد يفشل. لذلك لا بد من فصل:

- الحملة المحلية وبياناتها
- الرسائل المستعدة للإرسال
- الرسائل المُرسلة مع تأكيد
- حالات الفشل وإعادة المحاولة

### 4.2 مخطط جدول قائمة الانتظار

```sql
CREATE TABLE IF NOT EXISTS outgoing_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  gateway_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retry_attempts INTEGER NOT NULL DEFAULT 3,
  payload_json TEXT,
  last_error TEXT,
  correlation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_attempt_at TEXT
);
```

### 4.3 حالات الرسالة

```typescript
type OutgoingMessageStatus =
  | 'PENDING'        // في الانتظار
  | 'QUEUED'         // جاهزة للإرسال
  | 'SENDING'        // جارٍ الإرسال
  | 'SENT'           // تم الإرسال بنجاح
  | 'FAILED'         // فشل نهائي
  | 'RETRY_WAITING'  // في انتظار إعادة المحاولة
  | 'BLOCKED';       // محجوبة بسبب Send Gate
```

> [!IMPORTANT]
> استخدم أسماء الثوابت الكبيرة (`PENDING`, `SENT` ...) في قاعدة البيانات والواجهة لتجنب التعارضات.

### 4.4 آلية منع الازدواجية (Deduplication)

عند إعادة تشغيل التطبيق أو إعادة المحاولة:

- `phone` + `campaign_id` فريدان معاً داخل الحملة الواحدة
- `correlation_id` فريد لكل محاولة
- لا تُسمح حالة `SENDING` بالإعادة إذا لم يتم تأكيد النتيجة
- عند بدء التطبيق: تتحول رسائل `SENDING` إلى `RETRY_WAITING`

---

## 5. طبقة Remote Dispatch

### 5.1 مسؤولية الطبقة

هذه الطبقة مسؤولة عن:

- سحب الرسائل من قائمة الانتظار المحلية
- تجهيز payload لكل دفعة
- استدعاء Supabase Edge Function
- تطبيق التأخير وإعادة المحاولة
- تحديث حالة الرسالة في SQLite

### 5.2 مراحل التنفيذ

```
1. قراءة قائمة PENDING أو RETRY_WAITING من SQLite
2. التحقق من Send Gate
3. تقسيم الرسائل إلى دفعات (batchSize)
4. لكل دفعة:
   a. حساب التأخير (delayBetweenMs)
   b. بناء payload مع correlation_id جديد
   c. استدعاء hoodhad-send
   d. إذا نجحت → تحديث إلى SENT
   e. إذا فشلت وقابلة للإعادة → RETRY_WAITING + زيادة retry_count
   f. إذا فشلت نهائياً → FAILED
```

### 5.3 مثال TypeScript

```typescript
// lib/remoteDispatch.ts
export async function dispatchNextBatch(
  campaignId: string,
  settings: AppSettings,
  maxItems: number = 50
): Promise<void> {
  // 1. فحص Send Gate
  const gate = await evaluateSendGate(campaignId, settings);
  if (gate.status !== 'APPROVED') {
    await markQueueBlocked(campaignId, gate.detail ?? 'محجوب');
    return;
  }

  // 2. تحميل الدفعة
  const batch = await loadPendingBatch(campaignId, maxItems);
  if (batch.length === 0) return;

  // 3. تطبيق التأخير
  if (settings.delayBetweenMs > 0) {
    await sleep(settings.delayBetweenMs);
  }

  // 4. بناء payload وإرسال
  const correlationId = generateUUID();
  const { data, error } = await supabase.functions.invoke('hoodhad-send', {
    body: {
      action: 'send_campaign',
      campaign_id: campaignId,
      recipients: batch.map(m => ({
        phone: m.phone,
        message: m.message,
      })),
    },
    headers: { 'X-Correlation-Id': correlationId },
  });

  // 5. تحديث الحالة
  if (error) {
    await markBatchRetry(batch, error.message, correlationId);
  } else {
    await markBatchSent(batch, data.results);
  }
}
```

---

## 6. سياسة Throttling وRetry

### 6.1 القراءة من الإعدادات

يُستخرج من `AsyncStorage`:

| الإعداد | القيمة الافتراضية | الوصف |
| --- | --- | --- |
| `delayBetweenMs` | 500ms | التأخير بين كل رسالة |
| `batchSize` | 50 | عدد الرسائل في الدفعة الواحدة |
| `maxRetryAttempts` | 3 | الحد الأقصى لإعادة المحاولة |
| `connectTimeoutMs` | 30000ms | مهلة الاتصال |

### 6.2 الأولوية في حساب التأخير

```
1. Retry-After من خادم Supabase (إن وُجد)
2. إعدادات التطبيق (delayBetweenMs)
3. Exponential backoff عند تكرار الفشل
```

### 6.3 مثال حساب التأخير

```typescript
function calculateEffectiveDelay(
  configuredDelayMs: number,
  retryAfterHeader?: string
): number {
  const serverDelay = retryAfterHeader
    ? parseInt(retryAfterHeader) * 1000
    : 0;
  return Math.max(configuredDelayMs, serverDelay);
}
```

---

## 7. التتبع والتسجيل

يجب أن يحتوي كل سجل محاولة على:

| الحقل | الوصف |
| --- | --- |
| `campaignId` | معرف الحملة |
| `phone` | رقم المستلم |
| `status` | حالة الرسالة |
| `httpCode` | رمز HTTP من Supabase |
| `correlationId` | معرف فريد للمحاولة |
| `retryCount` | عدد مرات إعادة المحاولة |
| `lastError` | آخر رسالة خطأ |
| `timestamp` | توقيت المحاولة |

### 7.1 مثال سجل محاولة

```json
{
  "campaignId": "uuid-21",
  "phone": "+966501234567",
  "status": "FAILED",
  "httpCode": 429,
  "retryCount": 2,
  "correlationId": "a1b2c3d4",
  "lastError": "Too Many Requests",
  "timestamp": "2026-11-01T10:00:00Z"
}
```

---

## 8. التشغيل الآمن

### 8.1 Feature Flag

الإرسال الحقيقي معطّل افتراضياً:

```typescript
// في AppSettings
const DEFAULT_SETTINGS: AppSettings = {
  enableRemoteSend: false,  // يجب تفعيله يدوياً من الإعدادات
  batchSize: 50,
  delayBetweenMs: 500,
  maxRetryAttempts: 3,
};
```

### 8.2 Kill Switch

في شاشة الإعدادات — زر "إيقاف الإرسال" يوقف الإرسال فوراً:

```typescript
await AsyncStorage.setItem('enable_remote_send', 'false');
// تُعيد رسائل SENDING إلى RETRY_WAITING تلقائياً
```

### 8.3 Rollout التدريجي

التطبيق لا ينتقل إلى وضع الإرسال الكامل إلا بعد:

1. ✅ التحقق من صحة الجلسة
2. ✅ فحص الاتصال بـ Supabase (probe)
3. ✅ اختبار البوابة ببضعة أرقام تجريبية
4. ✅ مراجعة نتائج الاستجابة (`sent`/`failed`)
5. ✅ تفعيل `enableRemoteSend = true`

---

## 9. خطة التنفيذ المرحلية

### Sprint 1 — البنية الأساسية
- إنشاء `lib/sendGuard.ts`
- إنشاء جدول `outgoing_messages` في SQLite
- إضافة حالات الرسالة في `lib/database.ts`

### Sprint 2 — ربط الإعدادات
- ربط `AppSettings` بـ `AsyncStorage`
- تطبيق `lib/throttlePolicy.ts`
- إضافة flow إعادة المحاولة

### Sprint 3 — طبقة الإرسال
- تنفيذ `lib/remoteDispatch.ts`
- اختبار batch send مع Supabase
- تسجيل + correlation ID

### Sprint 4 — الإطلاق الآمن
- تفعيل feature flag من الإعدادات
- اختبار dry-run على عينة صغيرة
- مراقبة وتوسيع تدريجي

---

## 10. معيار النجاح

تُعتبر المرحلة مكتملة عندما:

- [ ] لا يوجد إرسال فعلي بدون مرور `Send Gate`
- [ ] كل رسالة تذهب أولاً إلى `outgoing_messages` في SQLite
- [ ] لا توجد رسائل مكررة (deduplication يعمل)
- [ ] لا توجد retries غير آمنة (401/403/400 لا تُعاد)
- [ ] كل محاولة مسجّلة مع `correlation_id`
- [ ] يمكن استئناف إرسال الحملة بعد إعادة تشغيل التطبيق

---

## 11. الخلاصة

هذه الطبقة تمنح التطبيق شبكة إرسال آمنة ومتحكمة، مع فصل واضح بين:

- **حفظ الحملة محلياً** (SQLite)
- **إعدادات البوابة والاتصال** (AsyncStorage + SecureStore)
- **throttling وretry** (`lib/throttlePolicy.ts`)
- **الإرسال الحقيقي** (Supabase Edge Function `hoodhad-send`)

وهي تضمن أن التطبيق لن يبدأ الإرسال الفعلي قبل الحصول على تأكيد الاتصال والبوابة الصالحة.
