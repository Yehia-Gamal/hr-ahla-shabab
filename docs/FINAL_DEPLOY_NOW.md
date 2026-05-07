# خطوات النشر النهائية — نسخة الويب

الإصدار: `1.3.1-runtime-alignment`

## 1) قبل رفع الملفات

1. غيّر كود بوابة التشغيل داخل: `operations-gate/index.html`.
2. راجع `shared/js/supabase-config.js` وتأكد من:
   - `enabled: true`
   - `strict: true`
   - `allowLocalFallback: false`
3. لا تضع `service_role` داخل أي ملف Frontend.
4. استخدم `shared/js/supabase-config.production.example.js` كمرجع للإنتاج، و`shared/js/supabase-config.development.example.js` للتطوير فقط.
5. لو كانت مفاتيح Supabase ظهرت في محادثات أو ملفات عامة، قم بتدويرها من Supabase Dashboard قبل النشر.

## 2) قاعدة البيانات

شغّل كل ملفات SQL بالترتيب حتى:

`supabase/sql/patches/040_runtime_alignment_fix.sql`

الأمر المقترح عند استخدام Supabase CLI:

```bash
supabase db push
```

أو شغّل الملفات يدويًا من SQL Editor بنفس الترتيب.

## 3) نشر Edge Functions

```bash
supabase functions deploy admin-create-user --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-update-user --project-ref YOUR_PROJECT_REF
supabase functions deploy resolve-login-identifier --project-ref YOUR_PROJECT_REF
supabase functions deploy passkey-register --project-ref YOUR_PROJECT_REF
supabase functions deploy send-push-notifications --project-ref YOUR_PROJECT_REF
```

## 4) Secrets المطلوبة

```bash
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
```

لإشعارات Web Push الحقيقية أضف أيضًا عند تجهيز Function الإرسال:

```bash
VAPID_PUBLIC_KEY
VAPID_PRIVATE_KEY
VAPID_SUBJECT
```

ثم ضع المفتاح العام فقط داخل:

```text
shared/js/supabase-config.js → push.vapidPublicKey
```

## 5) بعد الرفع

افتح الصفحات بالترتيب:

- `/employee/`
- `/operations-gate/`
- `/executive/`
- `/admin/`

وتأكد أن التنفيذي لا يستطيع دخول الأدمن، وأن الأدمن فقط يرى الصفحات التقنية.


## إضافة v1.2.0 — الأدوار وتقييم KPI

بعد تشغيل كل الملفات السابقة، شغّل أيضًا:

`supabase/sql/patches/040_runtime_alignment_fix.sql`

ثم اختبر: تسجيل موظف جديد من تطبيق الموظفين، رفع KPI ذاتي، اعتماد المدير المباشر، مراجعة HR، مراجعة السكرتير التنفيذي، واعتماد المدير التنفيذي.

## إضافة v1.2.2

بعد تشغيل Patch 037، شغّل:

```sql
-- supabase/sql/patches/040_runtime_alignment_fix.sql
```

ثم اختبر صفحة KPI من حساب السكرتير التنفيذي/التقني وحساب المدير التنفيذي للتأكد من إغلاق الدورة واعتمادها.

## إضافة v1.3.0

بعد تشغيل Patch 038 الخاص بدورة KPI، شغّل:

```text
040_runtime_alignment_fix.sql
```

ثم اختبر الصفحات الجديدة داخل لوحة الإدارة:

- هيكل الإدارة والفرق.
- فريق المدير.
- عمليات HR.
- مسار الشكاوى والتصعيد.
- مركز التقارير والتصدير.


## تحديث نهائي v1.3.1

آخر Patch مطلوب بعد فحص التشغيل: `040_runtime_alignment_fix.sql`.


## Patch 041 — Audit V7 hardening
شغّل أيضًا `supabase/sql/patches/041_audit_v7_security_mobile_alignment.sql` بعد Patch 040 لتطبيق حماية خزنة كلمات المرور، Service Worker المنفصل، وتحسينات الموبايل.


## V24 live location / push hotfix

1. Apply `supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql` in Supabase SQL Editor.
2. Deploy these functions again with the project ref:

```bash
supabase functions deploy send-push-notifications --project-ref yemradvxmwadlldnxtpz
supabase functions deploy send-push-notifications --project-ref yemradvxmwadlldnxtpz
supabase functions deploy passkey-register --project-ref yemradvxmwadlldnxtpz
```

3. Clear browser/app cache once from Console: `HR_CLEAR_APP_CACHE()`


## V27 Clean Supabase Update

استخدم الآن ملف SQL واحد فقط: `supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql`، ثم شغّل `DEPLOY_SUPABASE_PRODUCTION.ps1` أو `DEPLOY_SUPABASE_PRODUCTION.sh`. الملفات القديمة موجودة في `_archive` للرجوع فقط.
