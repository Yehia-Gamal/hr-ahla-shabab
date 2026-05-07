# Production Deployment Guide - V31 Clean

## 1) SQL Editor

شغّل ملف واحد فقط:

```text
supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql
```

بعد نشر الدوال شغّل:

```text
supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql
```

## 2) Edge Functions

من PowerShell:

```powershell
.\DEPLOY_SUPABASE_PRODUCTION.ps1
```

أو من Bash:

```bash
./DEPLOY_SUPABASE_PRODUCTION.sh
```

الدوال النشطة فقط:

```text
admin-create-user
admin-update-user
resolve-login-identifier
passkey-register
send-attendance-reminders
send-push-notifications
```

## 3) GitHub Pages

ارفع محتويات حزمة:

```text
hr_ahla_shabab_v31_public_pages_upload.zip
```

## 4) تنظيف الكاش بعد الرفع

```js
HR_CLEAR_APP_CACHE()
```

## 5) الأرشيف

أي ملفات قديمة موجودة فقط للرجوع داخل `_archive`، ولا يتم تشغيلها في النشر الطبيعي.
