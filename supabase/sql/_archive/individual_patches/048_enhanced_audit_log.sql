-- Patch 048: Enhanced audit log for sensitive operations
begin;

alter table if exists public.audit_log
  add column if not exists ip_address text,
  add column if not exists user_agent text,
  add column if not exists session_id text,
  add column if not exists severity text default 'INFO'
    check (severity in ('INFO', 'WARNING', 'CRITICAL'));

-- Promote sensitive actions to CRITICAL severity
update public.audit_log
set severity = 'CRITICAL'
where action in (
  'USER_CREATED', 'USER_DELETED', 'ROLE_CHANGED',
  'PASSWORD_RESET', 'ADMIN_LOGIN', 'BULK_EXPORT'
);

create index if not exists idx_audit_log_severity
  on public.audit_log(severity, created_at desc)
  where severity in ('WARNING', 'CRITICAL');

commit;