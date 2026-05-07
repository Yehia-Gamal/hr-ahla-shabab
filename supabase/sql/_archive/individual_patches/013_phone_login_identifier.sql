-- =========================================================
-- 013 Phone Login Identifier Resolver
-- Allows the frontend to accept phone number OR email at login.
-- =========================================================

alter table if exists public.profiles add column if not exists phone text;

create or replace function public.normalize_egypt_phone(input_phone text)
returns text
language sql
immutable
as $$
  with cleaned as (
    select regexp_replace(coalesce(input_phone, ''), '[^0-9]', '', 'g') as digits
  )
  select case
    when digits = '' then ''
    when digits like '0020%' then '0' || substring(digits from 5)
    when digits like '20%' and length(digits) >= 12 then '0' || substring(digits from 3)
    when digits like '1%' and length(digits) = 10 then '0' || digits
    else digits
  end
  from cleaned;
$$;

create or replace function public.resolve_login_identifier(login_identifier text)
returns text
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_identifier text := trim(coalesce(login_identifier, ''));
  v_phone text := public.normalize_egypt_phone(login_identifier);
  v_email text;
begin
  if v_identifier = '' then
    return null;
  end if;

  if position('@' in v_identifier) > 0 then
    return lower(v_identifier);
  end if;

  select lower(coalesce(e.email, au.email))
    into v_email
  from public.employees e
  left join auth.users au on au.id = e.user_id
  where e.is_deleted is not true
    and coalesce(e.is_active, true) is true
    and coalesce(e.status, 'ACTIVE') in ('ACTIVE', 'INVITED')
    and public.normalize_egypt_phone(e.phone) = v_phone
    and coalesce(e.email, au.email) is not null
  order by e.updated_at desc nulls last, e.created_at desc nulls last
  limit 1;

  if v_email is null then
    select lower(au.email)
      into v_email
    from public.profiles p
    join auth.users au on au.id = p.id
    where coalesce(p.status, 'ACTIVE') in ('ACTIVE', 'INVITED')
      and public.normalize_egypt_phone(coalesce(p.phone, '')) = v_phone
    order by p.updated_at desc nulls last, p.created_at desc nulls last
    limit 1;
  end if;

  return v_email;
end;
$$;

revoke all on function public.resolve_login_identifier(text) from public;
grant execute on function public.resolve_login_identifier(text) to authenticated;
grant execute on function public.resolve_login_identifier(text) to service_role;

create index if not exists idx_employees_phone_normalized on public.employees (public.normalize_egypt_phone(phone));
create index if not exists idx_profiles_phone_normalized on public.profiles (public.normalize_egypt_phone(phone));
