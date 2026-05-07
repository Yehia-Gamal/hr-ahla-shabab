# HR Ahla Shabab 089 Manual Deploy

This package is prepared for local verification first, then manual deployment.

## Security First

Rotate any Supabase and GitHub tokens that were shared outside a secret manager before production deployment.
Do not commit `.env`, `.env.local`, service-role keys, database passwords, VAPID private keys, or GitHub tokens.

## Local Checks

Run:

```sh
npm run check
npm run check:v31
npm run check:release-security
npm run check:release-artifact
npm run check:runtime-diagnostics
npm run check:sql
npm run check:production
npm run check:sanitization
npm run build:public
```

The public upload ZIP should be `HR_AHLA_SHABAB_PUBLIC_UPLOAD_089.zip`.

## Supabase SQL

1. Open Supabase Dashboard > SQL Editor.
2. Run `supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql`.
3. Run `supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql`.
4. Confirm `089_codex_full_deploy_alignment` is present.

## Supabase Edge Functions

Set environment variables locally before using the Supabase CLI:

```sh
export SUPABASE_PROJECT_REF="your_project_ref"
export SUPABASE_ACCESS_TOKEN="your_rotated_supabase_access_token"
```

PowerShell:

```powershell
$env:SUPABASE_PROJECT_REF = "your_project_ref"
$env:SUPABASE_ACCESS_TOKEN = "your_rotated_supabase_access_token"
```

Then run the platform deploy script:

```sh
./DEPLOY_SUPABASE_PRODUCTION.sh
```

Or on Windows:

```powershell
.\DEPLOY_SUPABASE_PRODUCTION.ps1
```

Set private function secrets with `supabase secrets set` from local environment variables only.

## GitHub Pages

Use `.github/workflows/pages.yml` from a real Git repository, or upload the contents generated under `dist_public_pages`.
This working folder is not currently a Git repository, so commit and push must be done from the real repo checkout.
