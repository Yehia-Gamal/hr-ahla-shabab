-- Ensure the selected related employee receives an in-app notification even
-- when profiles.employee_id is missing but employees.user_id is linked.

begin;

create or replace function public.notify_dispute_case_created(p_case_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_case public.dispute_cases%rowtype;
  v_count integer := 0;
  v_related_count integer := 0;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  select * into v_case
  from public.dispute_cases
  where id = p_case_id
  limit 1;

  if v_case.id is null then
    return 0;
  end if;

  if not (
    public.current_is_full_access()
    or v_case.created_by = auth.uid()
    or v_case.employee_id = public.current_employee_id()
  ) then
    raise exception 'FORBIDDEN_DISPUTE_NOTIFICATION';
  end if;

  insert into public.notifications (
    user_id, employee_id, title, body, type, status, is_read, route, data, created_at
  )
  select
    p.id,
    p.employee_id,
    'مشكلة جديدة للجنة حل المشاكل',
    coalesce(nullif(v_case.title, ''), 'شكوى / خلاف'),
    'ACTION_REQUIRED',
    'UNREAD',
    false,
    'committee-hub',
    jsonb_build_object('route', 'committee-hub', 'type', 'DISPUTE_CASE_CREATED', 'disputeCaseId', v_case.id, 'privacyLevel', 'committee_only'),
    now()
  from public.profiles p
  where p.email = any (array[
    'direct.manager.03@organization.local',
    'direct.manager.02@organization.local',
    'direct.manager.01@organization.local',
    'executive.secretary@organization.local',
    'executive.director@organization.local'
  ]);

  get diagnostics v_count = row_count;

  if v_case.related_employee_id is not null then
    insert into public.notifications (
      user_id, employee_id, title, body, type, status, is_read, route, data, created_at
    )
    select
      coalesce(p_by_employee.id, p_by_user.id, e.user_id),
      e.id,
      'تم ذكرك كطرف في خلاف',
      'تم ذكرك كطرف في خلاف مع زميل آخر. سيتم التواصل معك من اللجنة عند الحاجة دون إظهار اسم مقدم الشكوى.',
      'ACTION_REQUIRED',
      'UNREAD',
      false,
      'action-center',
      jsonb_build_object('route', 'action-center', 'type', 'DISPUTE_RELATED_PARTY', 'disputeCaseId', v_case.id, 'privacyLevel', 'anonymous_counterparty'),
      now()
    from public.employees e
    left join public.profiles p_by_employee on p_by_employee.employee_id = e.id
    left join public.profiles p_by_user on p_by_user.id = e.user_id
    where e.id = v_case.related_employee_id
    limit 1;

    get diagnostics v_related_count = row_count;
    v_count := v_count + v_related_count;
  end if;

  return v_count;
end;
$$;

revoke all on function public.notify_dispute_case_created(uuid) from public;
grant execute on function public.notify_dispute_case_created(uuid) to authenticated;

notify pgrst, 'reload schema';

commit;
