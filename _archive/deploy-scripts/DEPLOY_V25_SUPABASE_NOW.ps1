$ErrorActionPreference = "Stop"
$ProjectRef = if ($env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF } else { "yemradvxmwadlldnxtpz" }
$SiteUrl = if ($env:SITE_URL) { $env:SITE_URL } else { "https://yehia-gamal.github.io" }
$AllowedOrigins = if ($env:ALLOWED_ORIGINS) { $env:ALLOWED_ORIGINS } else { "https://yehia-gamal.github.io,https://yehia-gamal.github.io/HR-Operations-Platform,http://localhost:5500,http://127.0.0.1:5500,http://localhost:4173,http://127.0.0.1:4173" }

Write-Host "Linking Supabase project: $ProjectRef"
supabase link --project-ref $ProjectRef

Write-Host "Setting CORS secrets"
supabase secrets set SITE_URL=$SiteUrl ALLOWED_ORIGINS=$AllowedOrigins --project-ref $ProjectRef

Write-Host "Deploying Edge Functions"
$functions = @("send-push-notification", "send-push-notifications", "send-attendance-reminders", "passkey-register", "admin-create-user", "admin-update-user", "resolve-login-identifier")
foreach ($fn in $functions) {
  supabase functions deploy $fn --project-ref $ProjectRef
}

Write-Host "Done. Now run SQL patches 077 and 078 in Supabase SQL Editor if not applied yet."
