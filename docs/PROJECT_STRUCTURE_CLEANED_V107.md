# هيكلة المشروع بعد تنظيف v107

## ملفات التشغيل في الجذر
- `index.html`, `admin-login.html`, `health.html`
- `sw.js`, `sw-admin.js`, `sw-employee.js`, `sw-executive.js`
- `_headers`, `vercel.json`
- `package.json`, `package-lock.json`

## مجلدات التطبيق
- `employee/` تطبيق الموظف
- `admin/` لوحة HR والإدارة
- `executive/` بوابة المدير التنفيذي
- `operations-gate/` بوابة الدخول التشغيلية
- `shared/` CSS/JS/PWA/images المشتركة

## Supabase
- `supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql` الملف الرئيسي للتشغيل في SQL Editor
- `supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql` ملف التحقق بعد التشغيل
- `supabase/migrations/` محفوظة كمرجع/تتبع تاريخي

## أدوات وفحوصات
- `tools/` فحوصات المشروع وسكربتات البناء
- `tools/deploy/` سكربتات النشر
- `tools/local-checks/` سكربتات الفحص المحلي

## الأرشيف والتقارير
- `docs/audit-reports/` تقارير الفحص القديمة والجديدة
- `docs/release-manifests/` ملفات release-manifest القديمة
- `_archive/packages/` حزم ZIP قديمة أو ناتجة من مراحل سابقة

> لا ترفع `_archive/` ولا `docs/audit-reports/` على الاستضافة العامة. حزمة Public Upload لا تحتوي عليها.
