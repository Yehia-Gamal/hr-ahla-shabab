# FIX REPORT 098 — Location Security / Edge Hardening

## Summary
This release hardens the same area that 097 targeted: live-location response handling. The critical correction is that `REJECTED_TEMPORARY` and `POSTPONED` now win over GPS coordinates in both Supabase and local fallback code paths.

## Fixed
- `shared/js/supabase-api.js`: `approved` is now false whenever the response is rejected or postponed, even if GPS coordinates are present.
- `shared/js/api.js`: local fallback now uses the same status precedence as Supabase.
- `supabase/functions/admin-create-user/index.ts`: added top-level JSON error wrapper.
- `supabase/functions/admin-update-user/index.ts`: added top-level JSON error wrapper.
- `shared/js/employee-app.js`: normalized untrusted location records and removed KPI slider `innerHTML` update.
- `operations-gate/index.html` and `admin-login.html`: added manifest/SW readiness.
- All main HTML entrypoints: added CSP meta fallback for deployments outside Netlify/Vercel headers.
- Frontend diagnostic logs are now gated behind `window.HR_DEBUG_LOGS` or `HR_SUPABASE_CONFIG.debug`.

## Manual production tests
1. Executive sends a live-location request.
2. Employee clicks temporary reject/postpone while GPS coordinates are available.
3. Verify request status is `REJECTED_TEMPORARY` or `POSTPONED`, not `APPROVED`.
4. Employee sends live location normally.
5. Verify request status is `APPROVED` and `employee_locations` receives coordinates.
6. Trigger admin-create-user/admin-update-user with malformed input and verify JSON error body is returned.

## Supabase
Apply:

```sql
supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql
```

Then verify:

```sql
supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql
```
