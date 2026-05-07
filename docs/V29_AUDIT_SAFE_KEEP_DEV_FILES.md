# V29 Audit Safe Keep Dev Files

تم تطبيق إصلاحات تقرير فحص v28 مع الحفاظ على ملفات التطوير داخل نسخة التطوير الكاملة:

- أبقينا `.env` و `.git` و `supabase/.temp` داخل نسخة التطوير فقط.
- نسخة GitHub Pages النظيفة لا تحتوي هذه الملفات.
- تم ضبط `WEBAUTHN_ENABLED=false` كإجراء أمان فوري حتى تطبيق تحقق WebAuthn كامل.
- تم منع كلمة المرور التي تساوي رقم الهاتف في `admin-update-user`.
- تم إصلاح `v10-private-deploy-fixes.js` وربط HRToast/HRV9/شرح الإشعارات والموقع بتطبيق الموظف.
- تم حذف fallback الخاص بـ `/admin/` من `sw-employee.js`.
- تم إضافة sessionStorage cache لـ `core()` لتقليل استعلامات التحميل.
- تم توحيد cache busting على `full-workflow-live-20260504-v30-final-verified-no-local-errors`.

مهم: بعد نشر هذه النسخة أعد تدوير الأسرار التي ظهرت في تقارير سابقة من لوحات Supabase/GitHub، ولا تنشر نسخة التطوير كاملة على GitHub Pages.
