# Production Checklist — Ahla Shabab HR Web

## 1) قبل رفع الملفات

- غيّر كود بوابة التشغيل من `operations-gate/index.html`.
- تأكد أن `shared/js/supabase-config.js` يحتوي على:
  - `enabled: true`
  - `strict: true`
  - `allowLocalFallback: false`
- لا تضع `service_role` داخل أي ملف Frontend.
- استخدم ملف المثال الإنتاجي فقط كمرجع:
  - `shared/js/supabase-config.production.example.js`
- نفّذ:

```bash
npm test
```

## 2) Supabase SQL

شغّل ملفات SQL بالترتيب حتى:

```text
040_runtime_alignment_fix.sql
```

## 3) Edge Functions

انشر Functions المطلوبة:

```bash
supabase functions deploy admin-create-user --project-ref YOUR_PROJECT_REF
supabase functions deploy admin-update-user --project-ref YOUR_PROJECT_REF
supabase functions deploy resolve-login-identifier --project-ref YOUR_PROJECT_REF
supabase functions deploy passkey-register --project-ref YOUR_PROJECT_REF
supabase functions deploy send-push-notifications --project-ref YOUR_PROJECT_REF
```

## 4) Storage Buckets

تأكد من وجود buckets:

- `avatars`
- `punch-selfies`
- `employee-attachments`

ارفع صور الموظفين إلى `avatars` ولا تضعها داخل مجلدات الواجهة.

## 5) Web Push الحقيقي

- أضف VAPID keys كـ Secrets للخادم/Function الإرسال.
- ضع `VAPID_PUBLIC_KEY` فقط داخل `push.vapidPublicKey` في `shared/js/supabase-config.js`.
- تأكد من وجود جدول `push_subscriptions` بعد Patch 036.
- جرّب تفعيل الإشعارات من صفحة الإشعارات داخل تطبيق الموظف أو الأدمن.

## 6) اختبار الأدوار

### أدمن

- دخول لوحة الأدمن.
- إضافة/تعديل مستخدم.
- تعديل موظف.
- طلب موقع.
- رؤية إعدادات النظام.

### HR

- رؤية الموظفين والحضور والطلبات.
- عدم رؤية أدوات تقنية غير مصرح بها.

### المدير التنفيذي

- فتح المتابعة التنفيذية فقط.
- عدم فتح لوحة الأدمن.
- طلب موقع مباشر.
- مراجعة الاعتمادات الحساسة.

### السكرتير التنفيذي

- فتح المتابعة التنفيذية.
- تجهيز التقارير والمتابعة.
- عدم فتح لوحة الأدمن أو إدارة المستخدمين.

### موظف

- حضور وانصراف.
- طلب إجازة.
- إرسال الموقع عند الطلب.
- رؤية الإشعارات والملف الشخصي.

## 7) اختبار الموبايل

- Android Chrome.
- iPhone Safari إن أمكن.
- Dark Mode.
- اتصال ضعيف.
- تثبيت PWA من المتصفح.
- مسح الكاش بعد الرفع لأول مرة.

## Final Sanitized

- [ ] تشغيل SQL patches حتى `040_runtime_alignment_fix.sql`.
- [ ] تغيير كود بوابة التشغيل قبل النشر.
- [ ] تدوير مفاتيح Supabase إذا سبق مشاركتها.
- [ ] نشر Edge Functions الستة.
- [ ] ضبط VAPID keys عند تفعيل Web Push.
- [ ] اختبار كل دور من `docs/FINAL_ACCEPTANCE_TEST.md`.


## اختبار v1.2.0 Role/KPI

- [ ] تسجيل موظف جديد من /employee/ والتأكد أن الدور Employee فقط.
- [ ] تحديد المدير المباشر من ملف الموظف.
- [ ] المدير يرى فريقه فقط من لوحة المدير.
- [ ] الموظف يرفع KPI ذاتي.
- [ ] المدير المباشر يعتمد KPI للفريق.
- [ ] HR يراجع الحضور والانصراف داخل KPI.
- [ ] السكرتير التنفيذي/التقني يرى النظام كاملًا.
- [ ] المدير التنفيذي يعتمد النتيجة النهائية.


## Patch 041 — Audit V7 hardening
شغّل أيضًا `supabase/sql/patches/041_audit_v7_security_mobile_alignment.sql` بعد Patch 040 لتطبيق حماية خزنة كلمات المرور، Service Worker المنفصل، وتحسينات الموبايل.


## V27 Clean Supabase Update

استخدم الآن ملف SQL واحد فقط: `supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql`، ثم شغّل `DEPLOY_SUPABASE_PRODUCTION.ps1` أو `DEPLOY_SUPABASE_PRODUCTION.sh`. الملفات القديمة موجودة في `_archive` للرجوع فقط.
