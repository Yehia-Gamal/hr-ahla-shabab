# تقرير فحص وإصلاح نسخة HR — v31-production-hardening-087

تاريخ الفحص: 2026-05-07

## ما تم فحصه
- JavaScript syntax لكل ملفات الواجهة الأساسية.
- HTML inline scripts ومسارات الملفات المرتبطة.
- Web guards وبوابة العمليات وصفحات admin/executive/employee.
- KPI policy + KPI cycle.
- HR management suite والتقارير.
- SQL/runtime alignment.
- Attendance identity / passkey / GPS workflow.
- Theme V3 وlive deploy readiness.
- Service Workers الخاصة بالموظف والإدارة والمدير التنفيذي.

## أهم الإصلاحات
1. تصحيح النص العربي المشوّه داخل Service Workers في إشعارات المتصفح الافتراضية.
2. رفع رقم النسخة والكاش إلى `v31-production-hardening-087` لإجبار الموبايلات والمتصفحات على تحميل النسخة الجديدة بدل الكاش القديم.
3. تحديث `health.html` ليعرض Patch الصحيح بدل الاعتماد القديم على `064_attendance_fallback_workflow.sql`.
4. تحديث `deployment.expectedPatch` إلى `080_live_location_alert_reliability`.
5. إصلاح توافق جدول `database_migration_status` داخل SQL النهائي: استخدام `name/notes` بدل `patch_name/details` في مواضع كانت قد تفشل على قاعدة بيانات لا تحتوي عمود `patch_name`.
6. إضافة marker جديد باسم `085_full_system_audit_fix` داخل SQL النهائي.
7. تحديث `VERIFY_AFTER_SUPABASE_DEPLOY.sql` حتى لا يفشل بسبب عمود `patch_name` غير موجود.
8. السماح لـ CSP بالاتصال بـ `nominatim.openstreetmap.org` حتى لا يتم حجب reverse geocoding للعنوان المقروء.
9. تحسين `vercel.json` بإضافة Headers ناقصة: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`.
10. تحسين طلبات الموقع القديمة `location_requests` بحيث تنشئ إشعارًا داخليًا وتحاول إرسال Push فعلي عبر `send-push-notifications` مثل live location.
11. تحسين الوضع المحلي Local fallback بحيث إشعار طلب الموقع يحمل `route/data` ويظهر في صفحة الموقع والتنبيهات بشكل صحيح.
12. تحديث قائمة migrations المتوقعة في لوحة الإدارة حتى تشمل التسلسل الكامل حتى Patch 080.

## نتائج الفحص بعد الإصلاح
- `npm run check` ✅
- `npm run check:js` ✅
- `npm run check:html` ✅
- `npm run check:guards` ✅
- `npm run check:prepublish` ✅
- `npm run check:production` ✅
- `npm run check:final` ✅
- `npm run check:sanitization` ✅
- `npm run check:kpi-policy` ✅
- `npm run check:kpi-cycle` ✅
- `npm run check:management-suite` ✅
- `npm run check:sql` ✅
- `npm run check:attendance-identity` ✅
- `npm run check:theme` ✅
- `npm run check:live-deploy-readiness` ✅
- `npm run check:v13-production-polish` ✅
- `npm run check:v31` ✅

## ملاحظات مهمة للنشر
بعد رفع هذه النسخة، شغّل ملف:

`supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql`

ثم انشر Edge Functions، خصوصًا:

- `send-push-notifications`
- `send-attendance-reminders`
- `resolve-login-identifier`
- `admin-create-user`
- `admin-update-user`
- `passkey-register`

وتأكد من ضبط أسرار VAPID في Supabase Functions:

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
