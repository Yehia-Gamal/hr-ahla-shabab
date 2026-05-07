-- Activate browser passkey attendance fields and refresh PostgREST schema cache.

alter table public.attendance_events
  add column if not exists passkey_credential_id text;

alter table public.attendance_events
  add column if not exists passkey_verified_at timestamptz;

create index if not exists idx_attendance_events_passkey_credential
  on public.attendance_events(passkey_credential_id)
  where passkey_credential_id is not null;

select pg_notify('pgrst', 'reload schema');
