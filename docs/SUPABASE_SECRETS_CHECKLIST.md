## Supabase Secrets Checklist — complete before deployment

This document lists the environment variables and secrets that **must** be configured in your hosting platform and Supabase project **before you deploy** the HR system.  Keep this file out of version control and do not commit any secrets to GitHub.

### Edge Function secrets (Supabase Dashboard → Edge Functions → Secrets)

- `SUPABASE_URL` – e.g. `https://your-project-ref.supabase.co`
- `SUPABASE_ANON_KEY` – the publishable (anon) key for your project
- `SUPABASE_SERVICE_ROLE_KEY` – the service role key (never expose to the client)
- `VAPID_PUBLIC_KEY` – your public push notification key
- `VAPID_PRIVATE_KEY` – your private push notification key
- `VAPID_SUBJECT` – email or URI associated with push notifications (e.g. `mailto:admin@ahla-shabab.org`)
- `LOGIN_RATE_LIMIT_SALT` – a random 32+ character salt string used by the login resolver
- `LOGIN_RESOLVE_MAX_ATTEMPTS` – maximum login attempts before temporary lockout (default `8`)
- `LOGIN_RESOLVE_BLOCK_MINUTES` – minutes to lock out after max attempts (default `15`)

### Supabase Vault / Project secrets (Supabase Dashboard → Project Settings → Vault/Secrets)

- `app.vault_key` – 32+ character encryption key required for patch 044

### Database extensions (Supabase Dashboard → Database → Extensions)

- Enable `pg_cron` (required for patch 045 and scheduled jobs)
- Ensure `pgcrypto` is enabled (usually enabled by default)

### Additional notes

- **Do not** commit any of the secrets above to version control. Use environment variables in your CI/CD or hosting provider.
- When rotating keys, update both the environment variables and the values in `shared/js/supabase-config.js` for local testing.
- For more information on required patches and their order, see the SQL patches directory and the deployment checklist.
