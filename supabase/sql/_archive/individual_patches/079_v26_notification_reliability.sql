-- =========================================================
-- 079 V26 Notification reliability: bulk safe notifications RPC
-- Safe/idempotent. Run after patches 077 and 078.
-- =========================================================

begin;

alter table if exists public.notifications
  add column if not exists route text default '',
  add column if not exists data jsonb not null default '{}'::jsonb,
  add column if not exists push_sent_at timestamptz,
  add column if not exists push_status text default '',
  add column if not exists push_error text default '';

create or replace function public.safe_create_notifications_bulk(
  p_rows jsonb default '[]'::jsonb
)
returns table(id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_user_id uuid;
  v_employee_id uuid;
  v_allowed boolean;
  v_admin_allowed boolean;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHENTICATED';
  end if;

  v_admin_allowed := coalesce(public.current_is_full_access(), false)
    or coalesce(public.has_any_permission(array[
      'notifications:manage',
      'alerts:manage',
      'live-location:request',
      'decisions:manage',
      'announcements:send',
      'team:dashboard',
      'executive:report'
    ]), false);

  for v_item in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_user_id := null;
    v_employee_id := null;

    begin
      if coalesce(v_item ->> 'user_id', '') <> '' then
        v_user_id := (v_item ->> 'user_id')::uuid;
      end if;
    exception when others then
      v_user_id := null;
    end;

    begin
      if coalesce(v_item ->> 'employee_id', '') <> '' then
        v_employee_id := (v_item ->> 'employee_id')::uuid;
      end if;
    exception when others then
      v_employee_id := null;
    end;

    v_allowed := v_admin_allowed
      or (v_user_id is not null and v_user_id = auth.uid())
      or (v_employee_id is not null and v_employee_id = public.current_employee_id());

    if not v_allowed then
      raise exception 'FORBIDDEN_NOTIFICATION_CREATE';
    end if;

    insert into public.notifications(
      user_id,
      employee_id,
      title,
      body,
      type,
      status,
      is_read,
      route,
      data,
      created_at
    ) values (
      v_user_id,
      v_employee_id,
      nullif(coalesce(v_item ->> 'title', 'تنبيه'), ''),
      coalesce(v_item ->> 'body', ''),
      coalesce(nullif(v_item ->> 'type', ''), 'INFO'),
      coalesce(nullif(v_item ->> 'status', ''), 'UNREAD'),
      coalesce((v_item ->> 'is_read')::boolean, false),
      coalesce(v_item ->> 'route', ''),
      coalesce(v_item -> 'data', '{}'::jsonb),
      coalesce(nullif(v_item ->> 'created_at', '')::timestamptz, now())
    ) returning notifications.id into v_id;

    id := v_id;
    return next;
  end loop;

  return;
end;
$$;

grant execute on function public.safe_create_notifications_bulk(jsonb) to authenticated;

insert into public.database_migration_status (name, status, notes)
values ('079_v26_notification_reliability', 'APPLIED', 'Bulk safe notification RPC and client fallback alignment for v26')
on conflict (name) do update set status = excluded.status, notes = excluded.notes, applied_at = now();

commit;
