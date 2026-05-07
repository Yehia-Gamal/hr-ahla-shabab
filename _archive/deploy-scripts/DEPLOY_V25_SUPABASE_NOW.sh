#!/usr/bin/env bash
set -euo pipefail
PROJECT_REF="${SUPABASE_PROJECT_REF:-yemradvxmwadlldnxtpz}"
SITE_URL="${SITE_URL:-https://yehia-gamal.github.io}"
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://yehia-gamal.github.io,https://yehia-gamal.github.io/HR-Operations-Platform,http://localhost:5500,http://127.0.0.1:5500,http://localhost:4173,http://127.0.0.1:4173}"

echo "Linking Supabase project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

echo "Setting CORS secrets"
supabase secrets set SITE_URL="$SITE_URL" ALLOWED_ORIGINS="$ALLOWED_ORIGINS" --project-ref "$PROJECT_REF"

echo "Deploying Edge Functions"
for fn in send-push-notification send-push-notifications send-attendance-reminders passkey-register admin-create-user admin-update-user resolve-login-identifier; do
  supabase functions deploy "$fn" --project-ref "$PROJECT_REF"
done

echo "Done. Now run SQL patches 077 and 078 in Supabase SQL Editor if not applied yet."
