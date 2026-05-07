-- Patch 075: Disable branch QR operationally + prepare real 09:30 attendance reminders
-- Safe/idempotent patch. It keeps old QR tables/columns for compatibility but turns QR off.

begin;

-- 1) Keep branch QR schema for historical data, but never require QR for punches.
do $$
begin
  if to_regclass('public.branch_qr_station_settings') is not null then
    update public.branch_qr_station_settings
       set require_qr_for_punch = false,
           station_label = coalesce(nullif(station_label, ''), 'QR متوقف'),
           updated_at = now()
     where coalesce(require_qr_for_punch, true) = true;
  end if;
end $$;

-- 2) Store runtime attendance policy in system_settings when available.
do $$
begin
  if to_regclass('public.system_settings') is not null then
    insert into public.system_settings(key, value, description)
    values
      ('attendance.qr_required', 'false'::jsonb, 'QR disabled by Patch 075; attendance uses passkey + GPS + selfie.'),
      ('attendance.reminder_push_time', '"09:30"'::jsonb, 'Daily missing-punch push reminder target time, Africa/Cairo.'),
      ('attendance.reminder_page_time', '"10:00"'::jsonb, 'In-page reminder target time, Africa/Cairo.'),
      ('attendance.gps_policy', '{"samples":12,"sampleWindowMs":22000,"targetAccuracyMeters":25,"maxAcceptableAccuracyMeters":180,"safetyBufferMeters":220,"uncertainReviewOnly":true}'::jsonb, 'GPS policy: avoid catastrophic outside judgement when GPS is uncertain.')
    on conflict (key) do update
      set value = excluded.value,
          description = excluded.description,
          updated_at = now();
  end if;
end $$;

-- 3) Idempotent queue function for SQL/manual runners. The Edge Function sends Web Push.
create or replace function public.queue_missing_punch_reminders(p_for_date date default (now() at time zone 'Africa/Cairo')::date)
returns table(created_count integer, target_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_created integer := 0;
  v_target integer := 0;
begin
  with active_employees as (
    select e.id, e.user_id
    from public.employees e
    where coalesce(e.is_active, true) = true
      and coalesce(e.status, 'ACTIVE') not in ('INACTIVE','SUSPENDED','ARCHIVED')
  ), attended as (
    select distinct ae.employee_id
    from public.attendance_events ae
    where ae.employee_id is not null
      and ((ae.event_at at time zone 'Africa/Cairo')::date = p_for_date
           or (ae.created_at at time zone 'Africa/Cairo')::date = p_for_date)
  ), existing as (
    select distinct n.employee_id
    from public.notifications n
    where n.employee_id is not null
      and n.type = 'MISSING_PUNCH'
      and (n.created_at at time zone 'Africa/Cairo')::date = p_for_date
  ), targets as (
    select a.*
    from active_employees a
    left join attended t on t.employee_id = a.id
    left join existing x on x.employee_id = a.id
    where t.employee_id is null and x.employee_id is null
  ), inserted as (
    insert into public.notifications(user_id, employee_id, title, body, type, status, is_read, route)
    select user_id, id,
           'تذكير بتسجيل البصمة',
           'لم يتم تسجيل بصمة حضور اليوم حتى الآن. افتح صفحة البصمة وسجل حضورك عند الوصول للمجمع.',
           'MISSING_PUNCH', 'UNREAD', false, 'punch'
    from targets
    returning id
  )
  select (select count(*) from inserted), (select count(*) from targets)
    into v_created, v_target;

  if to_regclass('public.smart_alert_events') is not null then
    insert into public.smart_alert_events(rule_code, title, body, severity, status, payload, sent_at)
    values ('MISSING_PUNCH_0930', 'تشغيل تذكير بصمة 9:30',
            'تم إنشاء ' || v_created || ' إشعار داخلي. إرسال Push يتم عبر Edge Function send-attendance-reminders.',
            'WARNING', 'SENT', jsonb_build_object('date', p_for_date, 'created', v_created, 'targets', v_target), now());
  end if;

  return query select v_created, v_target;
end;
$$;

comment on function public.queue_missing_punch_reminders(date) is
  'Queues missing-punch notifications for employees without attendance on a date. Use Edge Function send-attendance-reminders for real Web Push delivery.';

-- 4) Optional pg_cron SQL queue. Web Push still needs the Edge Function scheduled/called.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('ahla-shabab-missing-punch-queue-0930');
    perform cron.schedule('ahla-shabab-missing-punch-queue-0930', '30 9 * * 0-4,6', $q$select * from public.queue_missing_punch_reminders((now() at time zone 'Africa/Cairo')::date);$q$);
  end if;
exception when undefined_function or invalid_schema_name then
  null;
when others then
  -- Keep patch idempotent even if pg_cron is unavailable in this Supabase project.
  null;
end $$;

commit;
