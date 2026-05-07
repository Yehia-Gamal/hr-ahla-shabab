# V25 Execution Runbook — Live Location + Push + CORS

## Files intentionally kept in this development package

This package intentionally keeps `.env`, `.git`, and `supabase/.temp` because they were requested for the development handoff. Do **not** publish these folders/files to a public GitHub Pages deployment.

## Required Supabase SQL order

Run in SQL Editor:

1. `supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_077_V24_LOCATION_PUSH_CORS.sql`
2. `supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_078_V25_EXECUTION_LIVE_LOCATION_PUSH.sql`

Patch 078 adds `safe_create_notification(...)` so location requests no longer depend on a direct browser insert into `notifications`, which was causing `400 Bad Request` in production.

## Required Functions deployment

```bash
supabase link --project-ref yemradvxmwadlldnxtpz

supabase secrets set \
  SITE_URL="https://yehia-gamal.github.io" \
  ALLOWED_ORIGINS="https://yehia-gamal.github.io,https://yehia-gamal.github.io/HR-Operations-Platform,http://localhost:5500,http://127.0.0.1:5500,http://localhost:4173,http://127.0.0.1:4173" \
  --project-ref yemradvxmwadlldnxtpz

supabase functions deploy send-push-notification --project-ref yemradvxmwadlldnxtpz
supabase functions deploy send-push-notifications --project-ref yemradvxmwadlldnxtpz
supabase functions deploy send-attendance-reminders --project-ref yemradvxmwadlldnxtpz
supabase functions deploy passkey-register --project-ref yemradvxmwadlldnxtpz
supabase functions deploy admin-create-user --project-ref yemradvxmwadlldnxtpz
supabase functions deploy admin-update-user --project-ref yemradvxmwadlldnxtpz
```

## Browser cache reset

Run once in Console after upload:

```js
HR_CLEAR_APP_CACHE()
```

## Expected Network result after fix

- `live_location_requests`: `201` or `200`
- `rpc/safe_create_notification`: `200`
- `send-push-notification`: `200` or a CORS-safe JSON error such as `MISSING_VAPID_SECRETS`

The live location request must remain created even if external push delivery is unavailable.
