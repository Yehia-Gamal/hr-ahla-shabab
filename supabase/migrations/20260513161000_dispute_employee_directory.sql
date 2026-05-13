-- Provide a safe employee directory for the complaint related-party selector.
-- Employees can create disputes, but RLS may prevent reading the full employees
-- table directly. This security-definer RPC exposes only non-sensitive fields
-- needed by the selector.

begin;

create or replace function public.dispute_employee_directory()
returns table (
  id uuid,
  full_name text,
  job_title text,
  status text,
  department_id uuid,
  department_name text,
  role_id uuid,
  role_name text,
  role_slug text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    e.id,
    e.full_name,
    coalesce(e.job_title, '') as job_title,
    coalesce(e.status, 'ACTIVE') as status,
    e.department_id,
    coalesce(d.name, '') as department_name,
    e.role_id,
    coalesce(r.name, '') as role_name,
    coalesce(r.slug, '') as role_slug
  from public.employees e
  left join public.departments d on d.id = e.department_id
  left join public.roles r on r.id = e.role_id
  where coalesce(e.is_deleted, false) = false
    and upper(coalesce(e.status, 'ACTIVE')) <> 'DELETED'
  order by e.full_name collate "C";
$$;

revoke all on function public.dispute_employee_directory() from public;
grant execute on function public.dispute_employee_directory() to authenticated;

notify pgrst, 'reload schema';

commit;
