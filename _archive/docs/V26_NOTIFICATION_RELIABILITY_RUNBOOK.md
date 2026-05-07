# V27 Clean Supabase Production Runbook

## SQL patches
Run in Supabase SQL Editor in order if not already applied:

1. `supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_077_V24_LOCATION_PUSH_CORS.sql`
2. `supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_078_V25_EXECUTION_LIVE_LOCATION_PUSH.sql`
3. `supabase/sql/PRODUCTION_SQL_EDITOR_PATCHES_079_V26_NOTIFICATION_RELIABILITY.sql`

## Functions
Run `DEPLOY_V26_SUPABASE_NOW.sh` on macOS/Linux or `DEPLOY_V26_SUPABASE_NOW.ps1` on Windows PowerShell.

## Public upload
This full project package intentionally keeps `.env`, `.git`, and `supabase/.temp` per request. Do not publish the full folder. Generate/upload only the public package:

```bash
node tools/build-public-pages-package.mjs
```

Then upload `hr_ahla_shabab_v27_public_pages_upload.zip` contents to GitHub Pages.

## Browser cache
After upload, run in Console:

```js
HR_CLEAR_APP_CACHE()
```
