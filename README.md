# SMS-Smarthoob — تطبيق هدهد الفواتير والرسائل الجماعية

> تطبيق جوال وويب متقدم مبني بـ **React Native** و **Expo** معمارية **Offline-First** مدعوماً بمحرك ذكاء اصطناعي وتحليل محلي، لتجهيز وإرسال رسائل الفواتير والإشعارات عبر منصة بوابات هدهد (HodHod WhatsApp & SMS Gateway).

---

## 📑 فهرس وثائق وخطط المشروع (Documentation Library)

تم إعداد وتحديث وثائق شاملة ومطابقة للكود الفعلي للمشروع في مجلد [`docs/`](./docs/):

| الوثيقة | الوصف والمحتوى |
|---|---|
| 📋 **[ملخص المشروع (docs/PROJECT-SUMMARY.md)](./docs/PROJECT-SUMMARY.md)** | ملخص شامل للهيكل الفعلي للمشروع، حزم التقنية، والميزات المنجزة. |
| 🗺️ **[خطة المشروع (docs/PROJECT-PLAN.md)](./docs/PROJECT-PLAN.md)** | الأهداف، المسارات الرئيسية (المدخلان)، ومراحل التنفيذ من التأسيس حتى الإطلاق. |
| ⚙️ **[المتطلبات الفنية (docs/TECHNICAL-REQUIREMENTS.md)](./docs/TECHNICAL-REQUIREMENTS.md)** | المتطلبات الوظيفية (FR-01 إلى FR-14)، متطلبات الـ AI، وقواعد العمل الصارمة. |
| 🏗️ **[المواصفات التقنية والمعمارية (docs/TECHNOLOGY-SPECIFICATION.md)](./docs/TECHNOLOGY-SPECIFICATION.md)** | جدول التقنيات، مخطط المعمارية، مخطط جداول SQLite المحلية، ومحرك القوالب. |
| 🚀 **[خطة تجهيز الحملات (docs/CAMPAIGN-PREPARATION-PLAN.md)](./docs/CAMPAIGN-PREPARATION-PLAN.md)** | تدفق استيراد المستندات (Excel/CSV/PDF)، مطابقة المتغيرات، والمعاينة قبل الإرسال. |
| 🎛️ **[خطة إدارة الإعدادات والمزامنة (docs/SETTINGS-MANAGEMENT-PLAN.md)](./docs/SETTINGS-MANAGEMENT-PLAN.md)** | إدارة بوابات الإرسال، حجم الدفعات، مراقبة التزامن المحلي، وإعدادات خادم الـ AI. |
| 📦 **[معمارية الإرسال والتدفق (docs/DELIVERY-ARCHITECTURE.md)](./docs/DELIVERY-ARCHITECTURE.md)** | الطبقات الأربع للإرسال المحمي، طوابير الرسائل، وسياسات Throttling و Retry. |
| 🔍 **[تقرير تحليل الثغرات (docs/IMPLEMENTATION-GAPS.md)](./docs/IMPLEMENTATION-GAPS.md)** | مصفوفة مطابقة المتطلبات، الثغرات التي تم سدها، والميزات المستقبلية المقترحة. |

---

## 🚀 التقنيات المستخدمة (Tech Stack)

- **واجهة المستخدم:** React 19, React Native 0.86, Expo SDK 57, Expo Router (Tab Navigation).
- **الخطوط والسمات:** `@expo-google-fonts/cairo` بدعم كامل للغة العربية والاتجاه من اليمين لليسار (RTL).
- **التخزين المحلي (Offline-First):** `expo-sqlite` (يدعم الهواتف والويب عبر WASM).
- **الخدمات السحابية:** Supabase (Auth, PostgreSQL DB, Edge Functions `hoodhad-send`, `gateway-settings`).
- **معالجة المستندات والـ AI:**
  - محرك محلي سريع لملفات CSV في TypeScript (`lib/documentParser.ts`).
  - خادم ذكاء اصطناعي محلي بـ Python FastAPI لملفات PDF و Excel المعقدة (`E:\SmartHoop\backend`).
- **الأمان والخصوصية:** عزل تام لمفاتيح API السحابية وعدم تخزينها مكشوفة على العميل.

---

## 🛠️ أوامر التشغيل والبناء (Commands)

```bash
# تثبيت الحزم
npm install

# فحص الأنظمة البرمجية (TypeScript Check)
npm run typecheck

# تشغيل خادم التطوير (Expo Dev Server)
npm run dev

# بناء وتصدير نسخة الويب (Web Export)
npm run build:web
```

---

## 📱 تدفق الاستخدام الرئيسي (Core Flow)

1. **إدارة القوالب:** إنشاء قوالب فواتير ورسائل ترحيب مع متغيرات باللغة العربية مثل `{{الاسم}}` و `{{المبلغ}}` و `{{رقم_الفاتورة}}`.
2. **تجهيز الحملة:**
   - إدخال اسم الحملة وتحديد البوابة والقالب.
   - استيراد ملف فواتير العملاء (Excel أو CSV أو PDF).
   - مطابقة المتغيرات آلياً واكتشاف عمود الهاتف والاسم.
   - معاينة عينات من الرسائل الجاهزة بعد تعويض البيانات.
3. **الإرسال والتتبع:**
   - إرسال الرسائل على دفعات آمنة عبر بوابة هدهد.
   - حفظ حالة كل رسالة ومستلم في قاعدة البيانات المحلية ومزامنتها مع السحابة.
