# تقرير إصلاح وتطوير النسخة 086 — نظام أحلى شباب HR

تاريخ التجهيز: 2026-05-07
الإصدار: `v31-production-hardening-087`

## أهم الإصلاحات المنفذة

1. تنظيف وتجهيز نسخة نشر آمنة لا تحتوي على `.env` أو `.git` أو `node_modules`.
2. استبدال أكواد بوابة الإدارة والتنفيذي الافتراضية `00000000` بهاشات SHA-256 داخل `shared/js/supabase-config.js`.
3. إضافة قفل مؤقت للبوابة بعد المحاولات الخاطئة مع فصل محاولات الإدارة عن التنفيذي.
4. تقوية جلسة البوابة بإضافة token مرتبط بالوجهة داخل `sessionStorage` بدل الاكتفاء بالوقت والهدف فقط.
5. إصلاح سياسة CSP في `_headers` و `vercel.json` للسماح بتحميل Supabase runtime من `https://esm.sh`.
6. إزالة نهاية `_headers` غير الصحيحة التي كانت قد تسبب تفسيرًا خاطئًا في بعض بيئات النشر.
7. إصلاح ترميز الأرقام الفارسية/العربية في ملفات تسجيل الدخول والتطبيع:
   - `shared/js/api.js`
   - `shared/js/app-admin.js`
   - `shared/js/executive-app.js`
   - `shared/js/supabase-api.js`
8. إصلاح فحص `Notification.permission` في تطبيق الموظف لتجنب أخطاء المتصفحات التي لا تدعم Notifications.
9. منع تكرار polling/listeners الخاصة بطلب الموقع المباشر عند تسجيل الدخول/الخروج أو إعادة الرندر.
10. تحسين `health.html` لتجنب استخدام `innerHTML` في عرض نتائج الفحص.
11. إضافة سكربت فحص أمني جديد: `npm run check:release-security`.
12. تحديث رقم الكاش والنسخة في Service Workers والروابط إلى `v31-production-hardening-087`.
13. تحديث سكربت بناء حزمة الرفع العامة إلى اسم واضح: `HR_AHLA_SHABAB_PUBLIC_UPLOAD_086.zip`.

## الفحوصات التي نجحت بعد الإصلاح

```bash
npm run check
npm run check:release-security
npm run check:production
npm run check:final
npm run check:sanitization
npm run check:sql
npm run check:live-deploy-readiness
npm run check:theme
npm run check:attendance-identity
```

كذلك تم فحص:

- روابط HTML/CSS المحلية: لا توجد ملفات مفقودة.
- ملفات JSON: سليمة.
- عدم وجود Mojibake الخاص بأرقام الهاتف في ملفات JavaScript الأساسية.

## ملاحظات نشر مهمة

- أكواد البوابة المؤقتة موجودة خارج ZIP في ملف مستقل `HR_GATE_CODES_086.txt`.
- يجب تغيير/تدوير أي مفاتيح كانت موجودة في `.env` القديم لأن الملف كان داخل الحزمة السابقة.
- بوابة التشغيل طبقة حماية إضافية فقط، وليست بديلًا عن Supabase Auth و RLS.
- قبل النشر النهائي يجب تطبيق SQL النهائي ونشر Edge Functions من نسخة السورس النظيفة.
