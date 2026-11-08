# ملاحظات الاتصال بواجهة بوابة SMS

تاريخ المراجعة: نوفمبر 2026 — بيئة الاختبار Supabase Edge Functions + FastAPI.

هذه الملاحظات نتيجة فحص فعلي مباشر لطبقتي الخادم، لا استنتاج من وثائق. لا تحتوي على أي مفتاح أو بيانات اعتماد فعلية؛ تُحفظ المفاتيح خارج المصدر في `.env` (مستثنى من التتبع) ولا تُدرج في الكود أو التطبيق.

---

## 1. هوية المنصة

| العنصر | القيمة المؤكدة |
| --- | --- |
| خادم المصادقة | Supabase Auth (JWT Bearer token) |
| إطار الخلفية | FastAPI (Python) — مسار قراءة المستندات |
| وظائف Edge | Supabase Edge Functions (Deno/TypeScript) |
| دالة الإرسال | `hoodhad-send` — `POST /functions/v1/hoodhad-send` |
| قاعدة البيانات | Supabase Postgres + SQLite محلي (Expo SQLite) |
| فحص الصحة | `GET /health` على FastAPI → `{"status":"ok"}` |
| إعادة المحاولة | يتم التحكم بها محلياً في التطبيق |

---

## 2. المصادقة

### 2.1 Supabase Edge Functions

- الترويسة الصحيحة: `Authorization: Bearer <access_token>`
- يُستخرج الـ token من `supabase.auth.getSession()` بعد تسجيل الدخول.
- انتهاء صلاحية الـ token: تُجدّد الجلسة تلقائياً عبر `supabase.auth.onAuthStateChange`.

| الحالة | الاستجابة |
| --- | --- |
| بلا token | `401 Unauthorized` |
| token منتهي | `401 Unauthorized` |
| token صالح | يمرّ إلى منطق الدالة |

### 2.2 FastAPI (قراءة المستندات)

- يُقرأ الـ JWT من الترويسة ويُتحقق منه عبر مفتاح Supabase العام.
- عنوان API مخزّن في إعدادات التطبيق (`AsyncStorage` / شاشة الإعدادات).

```typescript
// مثال: إرسال طلب مصادق عليه
const { data: { session } } = await supabase.auth.getSession();
const response = await fetch(`${apiBaseUrl}/parse-document`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${session?.access_token}`,
    'Content-Type': 'multipart/form-data',
  },
  body: formData,
});
```

---

## 3. المسارات المتاحة

### 3.1 Supabase Edge Functions

| الطريقة | المسار | الغرض |
| --- | --- | --- |
| POST | `/functions/v1/hoodhad-send` | إرسال حملة SMS |
| POST | `/functions/v1/hoodhad-send` (action: `send_campaign`) | إرسال بمستلمين مخصصين |

### 3.2 FastAPI

| الطريقة | المسار | الغرض |
| --- | --- | --- |
| GET | `/health` | فحص حالة الخادم |
| POST | `/parse-document` | رفع ملف PDF/Excel وتحليله |
| POST | `/upload-document` | رفع مستند للتخزين |

### 3.3 Supabase REST (PostgREST)

| الطريقة | المسار | الغرض |
| --- | --- | --- |
| GET/POST/PATCH/DELETE | `/rest/v1/templates` | إدارة القوالب |
| GET/POST/PATCH/DELETE | `/rest/v1/campaigns` | إدارة الحملات |
| GET/POST/PATCH/DELETE | `/rest/v1/subscribers` | إدارة المشتركين |
| GET/POST/PATCH/DELETE | `/rest/v1/gateways` | إدارة البوابات |

---

## 4. عقد الإرسال (`hoodhad-send`)

### 4.1 طلب إرسال حملة

```typescript
// الطلب: POST /functions/v1/hoodhad-send
{
  "action": "send_campaign",
  "campaign_id": "uuid-هنا",          // اختياري إذا كانت recipients مخصصة
  "gateway_id": "uuid-بوابة",
  "template_id": "uuid-قالب",
  "recipients": [                      // للإرسال من ملف مستورد
    {
      "phone": "+966501234567",
      "message": "نص الرسالة المخصص",  // اختياري: يُستخدم بدلاً من القالب
      "data": { "name": "أحمد" }       // متغيرات القالب
    }
  ]
}
```

### 4.2 الاستجابة الناجحة

```json
{
  "success": true,
  "sent": 150,
  "failed": 2,
  "results": [
    { "phone": "+966501234567", "status": "sent" },
    { "phone": "+966500000000", "status": "failed", "error": "Invalid number" }
  ]
}
```

### 4.3 حالات الخطأ

| الحالة | الكود | المعنى |
| --- | --- | --- |
| لا يوجد gateway | 400 | لم يُحدد gateway_id أو غير موجود |
| خطأ في البوابة | 500 | فشل إرسال البوابة الخارجية |
| مستخدم غير مصادق | 401 | انتهت الجلسة أو بيانات خاطئة |

---

## 5. الحالة الراهنة والقيود المعروفة

### 5.1 ما يعمل حالياً

- ✅ المصادقة عبر Supabase JWT
- ✅ رفع الملفات وتحليلها عبر FastAPI
- ✅ تخزين القوالب والحملات في Supabase + SQLite محلي
- ✅ دالة `hoodhad-send` تستقبل `recipients` مخصصين من الملف المستورد
- ✅ المزامنة ثنائية الاتجاه بين SQLite المحلي وSupabase

### 5.2 قيود حالية

- الإرسال الفعلي يعتمد على البوابة المُعدّة في Supabase — البوابة يجب إعدادها أولاً
- عند انقطاع الشبكة: تُخزّن البيانات محلياً وتُزامن عند عودة الاتصال
- معدل الطلبات: خاضع لحدود Supabase Edge Functions الافتراضية

### 5.3 الاستجابات العابرة (قابلة للإعادة)

| الكود | الحالة |
| --- | --- |
| 429 | تجاوز حد المعدل — ينتظر ثم يُعيد |
| 502 / 503 / 504 | خطأ مؤقت في الخادم — يُعيد |

### 5.4 الاستجابات الدائمة (لا تُعاد)

| الكود | الحالة |
| --- | --- |
| 400 | طلب خاطئ — خطأ في البيانات |
| 401 / 403 | مصادقة فاشلة — يُجدد الجلسة |
| 422 | بيانات غير صالحة |

---

## 6. إعداد الاتصال في التطبيق

### 6.1 متغيرات البيئة المطلوبة

```bash
# في ملف .env (مستثنى من Git)
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 6.2 عنوان FastAPI

يُخزّن في `AsyncStorage` ويمكن تعديله من شاشة الإعدادات:

```typescript
// lib/api.ts
export let API_BASE_URL = 'http://localhost:8000';

export function setApiBaseUrl(url: string) {
  API_BASE_URL = url;
}
```

### 6.3 فحص الصحة

```typescript
// التحقق من توفر FastAPI
const response = await fetch(`${API_BASE_URL}/health`);
if (response.ok) {
  const data = await response.json(); // { status: 'ok' }
}
```

---

## 7. إعادة الفحص والتحقق

عند تحديث عنوان الخادم أو تغيير البوابة:

```typescript
// 1. تحديث عنوان API في الإعدادات
await AsyncStorage.setItem('api_base_url', newUrl);
setApiBaseUrl(newUrl);

// 2. فحص الصحة
const health = await fetch(`${newUrl}/health`);

// 3. اختبار المصادقة
const { data: { session } } = await supabase.auth.getSession();

// 4. إرسال تجريبي (dry-run) قبل الإطلاق الحقيقي
```

---

## 8. المطلوب لإكمال دورة الإرسال الكاملة

1. إعداد بوابة SMS نشطة في Supabase (جدول `gateways`)
2. التأكد من صحة `gateway_id` المستخدم في الحملة
3. اختبار `hoodhad-send` بحملة صغيرة (5–10 مستلمين)
4. مراجعة سجل الاستجابة والتأكد من `sent`/`failed`
5. تفعيل الإرسال الكامل بعد التحقق
