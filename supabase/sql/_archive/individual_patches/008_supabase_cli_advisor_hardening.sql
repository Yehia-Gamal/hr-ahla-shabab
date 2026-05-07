-- Advisor hardening applied after Supabase CLI checks.
-- Keeps application-facing RPCs available for signed-in users, but removes public anon execution.

alter function public.set_updated_at() set search_path = public, pg_temp;
alter function public.server_now() set search_path = public, pg_temp;
alter function public.audit_row_change() set search_path = public, pg_temp;
alter function public.calculate_late_minutes(uuid, timestamptz) set search_path = public, pg_temp;
alter function public.can_access_employee(uuid) set search_path = public, pg_temp;
alter function public.current_employee_id() set search_path = public, pg_temp;
alter function public.current_is_full_access() set search_path = public, pg_temp;
alter function public.current_profile() set search_path = public, pg_temp;
alter function public.current_role_permissions() set search_path = public, pg_temp;
alter function public.handle_new_auth_user() set search_path = public, pg_temp;
alter function public.has_permission(text) set search_path = public, pg_temp;
alter function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) set search_path = public, pg_temp;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'rls_auto_enable') then
    execute 'alter function public.rls_auto_enable() set search_path = public, pg_temp';
    execute 'revoke execute on function public.rls_auto_enable() from anon';
    execute 'revoke execute on function public.rls_auto_enable() from public';
    execute 'revoke execute on function public.rls_auto_enable() from authenticated';
  end if;
end $$;

revoke execute on function public.audit_row_change() from anon;
revoke execute on function public.calculate_late_minutes(uuid, timestamptz) from anon;
revoke execute on function public.can_access_employee(uuid) from anon;
revoke execute on function public.current_employee_id() from anon;
revoke execute on function public.current_is_full_access() from anon;
revoke execute on function public.current_profile() from anon;
revoke execute on function public.current_role_permissions() from anon;
revoke execute on function public.handle_new_auth_user() from anon;
revoke execute on function public.has_permission(text) from anon;
revoke execute on function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) from anon;

revoke execute on function public.audit_row_change() from public;
revoke execute on function public.calculate_late_minutes(uuid, timestamptz) from public;
revoke execute on function public.can_access_employee(uuid) from public;
revoke execute on function public.current_employee_id() from public;
revoke execute on function public.current_is_full_access() from public;
revoke execute on function public.current_profile() from public;
revoke execute on function public.current_role_permissions() from public;
revoke execute on function public.handle_new_auth_user() from public;
revoke execute on function public.has_permission(text) from public;
revoke execute on function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) from public;

grant execute on function public.calculate_late_minutes(uuid, timestamptz) to authenticated;
grant execute on function public.can_access_employee(uuid) to authenticated;
grant execute on function public.current_employee_id() to authenticated;
grant execute on function public.current_is_full_access() to authenticated;
grant execute on function public.current_profile() to authenticated;
grant execute on function public.current_role_permissions() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.upsert_attendance_daily_from_event(uuid, text, timestamptz, text, integer, boolean) to authenticated;

revoke execute on function public.audit_row_change() from authenticated;
revoke execute on function public.handle_new_auth_user() from authenticated;

drop policy if exists "avatars_public_read" on storage.objects;

drop index if exists public.idx_employees_email;
drop index if exists public.idx_employees_phone;
