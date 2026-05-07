-- =========================================================
-- 015 Critical Security Hardening
-- - Restrict phone login resolver RPC from anon browser access.
-- - Keep audit logs tamper-resistant.
-- - Normalize passkey credential column type.
-- =========================================================

revoke all on function public.resolve_login_identifier(text) from public;
revoke execute on function public.resolve_login_identifier(text) from anon;
grant execute on function public.resolve_login_identifier(text) to authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;

drop policy if exists "audit_insert_auth" on public.audit_logs;
revoke insert on public.audit_logs from authenticated;

alter table if exists public.attendance_events
  alter column passkey_credential_id type text using passkey_credential_id::text;


-- Phone login resolver rate-limit storage. Edge Function writes with service_role only.
create table if not exists public.login_identifier_attempts (
  id uuid primary key default gen_random_uuid(),
  ip_hash text not null,
  identifier_hash text not null,
  attempts integer not null default 1,
  blocked_until timestamptz,
  last_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(ip_hash, identifier_hash)
);

alter table public.login_identifier_attempts enable row level security;
drop policy if exists "login_identifier_attempts_service_only" on public.login_identifier_attempts;
create policy "login_identifier_attempts_service_only" on public.login_identifier_attempts for all to service_role using (true) with check (true);
create index if not exists idx_login_identifier_attempts_last on public.login_identifier_attempts(last_attempt_at desc);

alter table if exists public.profiles add column if not exists phone text;
alter table if exists public.attachments
  add column if not exists bucket_id text default '',
  add column if not exists storage_path text default '',
  alter column url set default '';
