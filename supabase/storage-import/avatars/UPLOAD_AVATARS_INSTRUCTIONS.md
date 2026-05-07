# Avatar Upload Instructions

Do not place employee personal photos in the public frontend. Upload the files in this folder to the Supabase Storage bucket `avatars`.

## Local Source

- Source folder: `supabase/storage-import/avatars/employee-avatars`
- Bucket: `avatars`
- Storage prefix: `employee-avatars/`
- Matched photos in this package: 20
- Authorized employees in the roster: 28

## Missing Photos

- AHS-012
- AHS-014
- AHS-019
- AHS-022
- AHS-023
- AHS-025
- AHS-027
- AHS-028

## Upload With Supabase CLI

Use rotated credentials only. Do not commit any tokens or service keys.

```powershell
$env:SUPABASE_ACCESS_TOKEN = "<ROTATED_SUPABASE_ACCESS_TOKEN>"
npx supabase storage create avatars --project-ref "<PROJECT_REF>" --public=false
npx supabase storage cp "supabase/storage-import/avatars/employee-avatars" "ss:///avatars/employee-avatars" --recursive --project-ref "<PROJECT_REF>"
```

If your installed CLI does not support `storage cp` for remote projects, upload the folder manually from Supabase Dashboard > Storage > `avatars`, preserving the `employee-avatars/<file>.png` paths.

## Post Upload

Run `supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql` and confirm the `storage_buckets` and roster checks return `OK`.
