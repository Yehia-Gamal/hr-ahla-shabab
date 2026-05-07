#!/usr/bin/env bash
set -euo pipefail
PROJECT_REF="${SUPABASE_PROJECT_REF:-yemradvxmwadlldnxtpz}"

echo "Linking Supabase project: $PROJECT_REF"
supabase link --project-ref "$PROJECT_REF"

echo "Set allowed origins"
supabase secrets set \
  SITE_URL="https://yehia-gamal.github.io" \
  ALLOWED_ORIGINS="https://yehia-gamal.github.io,https://yehia-gamal.github.io/HR-Operations-Platform,http://localhost:5500,http://127.0.0.1:5500,http://localhost:4173,http://127.0.0.1:4173" \
  --project-ref "$PROJECT_REF"

echo "Run these SQL patches in Supabase SQL Editor before/after this deploy if not already applied:"
echo "  supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_077_V24_LOCATION_PUSH_CORS.sql"
echo "  supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_078_V25_EXECUTION_LIVE_LOCATION_PUSH.sql"
echo "  supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_079_V26_NOTIFICATION_RELIABILITY.sql"

echo "Deploying functions..."
supabase functions deploy send-push-notification --project-ref "$PROJECT_REF"
supabase functions deploy send-push-notifications --project-ref "$PROJECT_REF"
supabase functions deploy send-attendance-reminders --project-ref "$PROJECT_REF"
supabase functions deploy passkey-register --project-ref "$PROJECT_REF"
supabase functions deploy admin-create-user --project-ref "$PROJECT_REF"
supabase functions deploy admin-update-user --project-ref "$PROJECT_REF"
supabase functions deploy resolve-login-identifier --project-ref "$PROJECT_REF"

echo "V26 Supabase deploy commands finished."
