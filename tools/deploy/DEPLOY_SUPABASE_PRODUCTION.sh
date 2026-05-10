#!/usr/bin/env bash
set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-yemradvxmwadlldnxtpz}"

printf '\n== v31-production-hardening-098 Supabase Production Deploy ==\n'
printf 'Project ref: %s\n\n' "$PROJECT_REF"
printf '1) Before running this script, apply:\n'
printf '   supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql\n\n'

supabase link --project-ref "$PROJECT_REF"

supabase secrets set \
  SITE_URL="https://yehia-gamal.github.io" \
  ALLOWED_ORIGINS="https://yehia-gamal.github.io,https://yehia-gamal.github.io/HR-Operations-Platform,http://localhost:5500,http://127.0.0.1:5500,http://localhost:4173,http://127.0.0.1:4173" \
  WEBAUTHN_ENABLED="false" \
  --project-ref "$PROJECT_REF"

functions=(
  "admin-create-user"
  "admin-update-user"
  "resolve-login-identifier"
  "passkey-register"
  "send-attendance-reminders"
  "send-push-notifications"
)

for fn in "${functions[@]}"; do
  printf '\nنشر الدالة: %s\n' "$fn"
  if supabase functions deploy "$fn" --project-ref "$PROJECT_REF"; then
    printf 'تم نشر الدالة %s\n' "$fn"
  else
    code=$?
    printf 'فشل نشر الدالة %s\n' "$fn" >&2
    exit "$code"
  fi
done

printf '\nتم نشر دوال Supabase لإصدار v31.\n'
printf 'بعدها شغّل ملف التحقق: supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql\n'
