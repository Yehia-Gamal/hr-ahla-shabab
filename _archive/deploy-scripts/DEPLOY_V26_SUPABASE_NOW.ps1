$ErrorActionPreference = "Stop"
$ProjectRef = if ($env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF } else { "yemradvxmwadlldnxtpz" }

Write-Host "Linking Supabase project: $ProjectRef"
supabase link --project-ref $ProjectRef

Write-Host "Set allowed origins"
supabase secrets set `
  SITE_URL="https://yehia-gamal.github.io" `
  ALLOWED_ORIGINS="https://yehia-gamal.github.io,https://yehia-gamal.github.io/HR-Operations-Platform,http://localhost:5500,http://127.0.0.1:5500,http://localhost:4173,http://127.0.0.1:4173" `
  --project-ref $ProjectRef

Write-Host "Run these SQL patches in Supabase SQL Editor if not already applied:"
Write-Host "  supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_077_V24_LOCATION_PUSH_CORS.sql"
Write-Host "  supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_078_V25_EXECUTION_LIVE_LOCATION_PUSH.sql"
Write-Host "  supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_079_V26_NOTIFICATION_RELIABILITY.sql"

supabase functions deploy send-push-notification --project-ref $ProjectRef
supabase functions deploy send-push-notifications --project-ref $ProjectRef
supabase functions deploy send-attendance-reminders --project-ref $ProjectRef
supabase functions deploy passkey-register --project-ref $ProjectRef
supabase functions deploy admin-create-user --project-ref $ProjectRef
supabase functions deploy admin-update-user --project-ref $ProjectRef
supabase functions deploy resolve-login-identifier --project-ref $ProjectRef

Write-Host "V26 Supabase deploy commands finished."
