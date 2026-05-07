# Supabase Cleanup V28

الهدف: تشغيل Supabase بشكل سلس بدون ملفات كثيرة ولا أوامر متكررة.

## النتيجة النهائية

- ملف SQL واحد للتشغيل: `supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql`
- ملف تحقق واحد: `supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql`
- سكربت نشر واحد: `DEPLOY_SUPABASE_PRODUCTION.ps1` أو `.sh`
- وظيفة Push واحدة نشطة: `send-push-notifications`

## تنظيف Edge Functions المنشورة قديمًا

الواجهة لم تعد تستدعي `send-push-notification` المفردة. لو كانت منشورة قديمًا داخل Supabase، اتركها مؤقتًا لو تريد رجوع سريع، أو احذفها من لوحة Supabase بعد التأكد أن v28 تعمل.

## الملفات المؤرشفة

ملفات SQL والـ Functions القديمة تم نقلها إلى `_archive` للرجوع فقط.
