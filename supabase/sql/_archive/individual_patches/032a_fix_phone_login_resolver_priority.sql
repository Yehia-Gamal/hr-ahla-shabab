-- 032 - Make phone login resolver prefer active Supabase profiles and tolerate phone formatting differences.
-- Run after patch 031.

create or replace function public.resolve_login_identifier(login_identifier text)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resolved_email text;
  digits text;
begin
  digits := regexp_replace(coalesce(login_identifier, ''), '[^0-9]', '', 'g');

  if position('@' in coalesce(login_identifier, '')) > 0 then
    select p.email into resolved_email
    from public.profiles p
    join auth.users u on u.id = p.id
    where lower(p.email) = lower(trim(login_identifier))
    order by case when p.status = 'ACTIVE' then 0 else 1 end,
             p.updated_at desc nulls last
    limit 1;

    return lower(trim(coalesce(resolved_email, '')));
  end if;

  select p.email into resolved_email
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.credential_vault v on v.user_id = p.id
  where coalesce(p.email, '') <> ''
    and coalesce(p.phone, '') <> ''
    and (
      regexp_replace(p.phone, '[^0-9]', '', 'g') = digits
      or right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 10) = right(digits, 10)
      or ('0' || regexp_replace(p.phone, '[^0-9]', '', 'g')) = digits
      or regexp_replace(p.phone, '[^0-9]', '', 'g') = ('0' || digits)
    )
  order by
    case when p.status = 'ACTIVE' then 0 else 1 end,
    case when v.status = 'PHONE_LOGIN_READY' then 0 else 1 end,
    p.updated_at desc nulls last,
    p.email asc
  limit 1;

  if resolved_email is not null and resolved_email <> '' then
    return lower(trim(resolved_email));
  end if;

  select e.email into resolved_email
  from public.employees e
  where coalesce(e.email, '') <> ''
    and coalesce(e.is_deleted, false) = false
    and coalesce(e.phone, '') <> ''
    and (
      regexp_replace(e.phone, '[^0-9]', '', 'g') = digits
      or right(regexp_replace(e.phone, '[^0-9]', '', 'g'), 10) = right(digits, 10)
      or ('0' || regexp_replace(e.phone, '[^0-9]', '', 'g')) = digits
      or regexp_replace(e.phone, '[^0-9]', '', 'g') = ('0' || digits)
    )
  order by e.updated_at desc nulls last,
           e.email asc
  limit 1;

  return lower(trim(coalesce(resolved_email, '')));
end;
$$;

revoke all on function public.resolve_login_identifier(text) from public;
revoke execute on function public.resolve_login_identifier(text) from anon;
grant execute on function public.resolve_login_identifier(text) to authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'database_migration_status'
      and column_name = 'name'
  ) then
    insert into public.database_migration_status (id, name, status, applied_at, notes)
    values ('mig-032-fix-phone-login-resolver-priority', '032_fix_phone_login_resolver_priority.sql', 'APPLIED', now(), 'Phone login resolver now prefers active profiles/auth users and supports phone format differences.')
    on conflict (id) do update
    set status = excluded.status,
        applied_at = excluded.applied_at,
        notes = excluded.notes;
  end if;
end $$;
