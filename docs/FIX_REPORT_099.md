# FIX REPORT 099 — PWA Manifests / Service Worker Scope / Cache Hardening

## Summary
فحص عميق كشف عن 9 أخطاء: خطأ حرج في scope السيرفس ووركر لبوابة التشغيل، أخطاء في ملفات PWA manifest كانت تسبب تعارضاً في التثبيت، وملفات مفقودة من قوائم الكاش تُفشل التطبيق أوفلاين.

## Fixed — Critical
- `shared/js/register-sw.js`: بوابة التشغيل كانت تسجّل SW بـ `scope: "../"` من `/operations-gate/` مما يُحوَّل لـ `/` (الجذر) ويختطف كل طلبات الموقع. تم تصحيحه إلى `scope: "./"`.

## Fixed — PWA Manifests
- `shared/pwa/manifest-admin.json`: تم تحويل `scope` و `start_url` لمسارات مطلقة (`/admin/`) وإضافة حقل `id` لمنع تعارض تثبيت PWA.
- `shared/pwa/manifest.json`: نفس الإصلاح — مسارات مطلقة + `id`.
- `shared/pwa/manifest-employee.json`: نفس الإصلاح — مسارات مطلقة + `id`.
- `shared/pwa/manifest-executive.json`: تعريب اسم التطبيق (كان بالإنجليزية) + مسارات مطلقة + `id`.

## Fixed — Service Worker Cache
- `sw.js`: `./admin/index.html` كان مذكوراً في `fallbackFor()` كـ fallback أوفلاين لكنه غير موجود في قائمة ASSETS. تم إضافته.
- `sw.js` + `sw-employee.js`: `attendance-v3-security.js` و `attendance-v4-ops.js` مستخدمان بواسطة `employee-app.js` لكن غائبان من الكاش — يفشل الحضور أوفلاين. تم إضافتهما.
- `sw-executive.js` + `sw-admin.js`: `database.js` مستخدم عبر سلسلة `api.js` لكن غائب من كاش هذين الـ SW. تم إضافته.

## Fixed — Improvements
- `shared/js/supabase-api.js`: تثبيت نسخة CDN على `@2.105.1` بدلاً من `@2` لمنع تحديث تلقائي غير متوقع.
- `index.html`: إزالة تحميل CSS وJS الخاصة بالإدارة من صفحة التحويل البسيطة.

## Version Bump
جميع قيم `?v=` و `CACHE_NAME` و `cacheVersion` تم رفعها إلى `v31-production-hardening-099-fixes` لإجبار المتصفحات على تحديث الكاش.

## No Supabase Changes
لا يوجد SQL جديد. لا تغييرات على Edge Functions. يمكن نشر هذا الإصدار مباشرة بدون تعديلات على Supabase.

## Additional Fixes (Deep Audit Pass)

### vercel.json — Missing Routes
- `/health` و `/admin-login` لم تكن لهما rewrites في `vercel.json` — كان الوصول إليهما يعتمد على الملف المباشر فقط. تم إضافتهما.

### CSP Inconsistency (_headers vs vercel.json)
- `_headers` و `vercel.json` كانا يفتقران إلى `object-src 'none'` و `media-src 'self' data: blob:` الموجودتَين في `<meta>` CSP داخل HTML. تم توحيد الـ CSP في ملفي الهيدر لتشمل جميع الـ directives.

### Edge Functions — Missing Top-Level Error Wrapper
- `resolve-login-identifier/index.ts` و `passkey-register/index.ts` و `send-attendance-reminders/index.ts` و `send-push-notifications/index.ts` كانت تفتقر إلى الـ try/catch على مستوى Deno.serve (مثلما أُضيف في 098 لـ admin-create/update-user). أي exception غير متوقع كان يُرجع استجابة فارغة بدلاً من JSON بـ 500. تم التوحيد.

### supabase-config.js — expectedPatch
- `expectedPatch` لا يزال يشير إلى `098_location_security_edge_hardening`. تم تحديثه إلى `099_pwa_manifest_sw_scope_cache_fixes`.
