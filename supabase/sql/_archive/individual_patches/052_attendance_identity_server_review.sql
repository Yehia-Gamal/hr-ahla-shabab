-- Patch 052: Server-side attendance identity review controls
-- Purpose:
--   Add a secure review queue and review RPC for identity-guarded attendance punches.
--   Complements Patch 051 by making shared-device detection and HR decisions auditable.

begin;

-- A review-oriented view for HR/Admin/Executive dashboards.
create or replace view public.attendance_identity_review_queue as
select
  c.id as check_id,
  c.attendance_event_id,
  c.employee_id,
  e.full_name as employee_name,
  c.user_id,
  c.device_fingerprint_hash,
  c.passkey_credential_id,
  c.selfie_url,
  c.risk_score,
  c.risk_level,
  c.risk_flags,
  c.requires_review,
  c.review_decision,
  c.review_notes,
  c.reviewed_at,
  c.created_at,
  ae.type,
  ae.status,
  ae.event_at,
  ae.geofence_status,
  ae.distance_from_branch_meters,
  ae.accuracy_meters,
  ae.notes
from public.attendance_identity_checks c
left join public.attendance_events ae on ae.id = c.attendance_event_id
left join public.employees e on e.id = c.employee_id
where c.requires_review = true
   or c.risk_level in ('MEDIUM','HIGH')
order by c.created_at desc;

-- Security-definer review RPC; keeps review writes out of the public table API.
create or replace function public.review_attendance_identity_check(
  p_check_id uuid,
  p_decision text,
  p_notes text default ''
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_check public.attendance_identity_checks%rowtype;
  v_decision text := upper(trim(coalesce(p_decision, '')));
  v_can_review boolean;
begin
  v_can_review := public.has_app_permission('attendance:review')
    or public.has_app_permission('attendance:manage')
    or public.has_app_permission('hr:operations')
    or public.has_app_permission('executive:mobile');

  if not v_can_review then
    raise exception 'NOT_ALLOWED_TO_REVIEW_ATTENDANCE_IDENTITY';
  end if;

  if v_decision not in ('APPROVED','REJECTED','ESCALATED') then
    raise exception 'INVALID_REVIEW_DECISION';
  end if;

  select * into v_check
  from public.attendance_identity_checks
  where id = p_check_id
  for update;

  if not found then
    raise exception 'ATTENDANCE_IDENTITY_CHECK_NOT_FOUND';
  end if;

  update public.attendance_identity_checks
  set reviewed_at = now(),
      reviewed_by = auth.uid(),
      review_decision = v_decision,
      review_notes = coalesce(p_notes, ''),
      requires_review = (v_decision = 'ESCALATED')
  where id = p_check_id;

  update public.attendance_events
  set requires_review = (v_decision = 'ESCALATED'),
      review_decision = v_decision,
      review_note = coalesce(p_notes, ''),
      reviewed_by_user_id = auth.uid(),
      reviewed_at = now(),
      status = case
        when v_decision = 'APPROVED' and status in ('REJECTED','PENDING_REVIEW','MANUAL_CHECK_IN','MANUAL_CHECK_OUT') then 'APPROVED'
        when v_decision = 'REJECTED' then 'REJECTED'
        else status
      end
  where id = v_check.attendance_event_id;

  if to_regclass('public.audit_log') is not null then
    insert into public.audit_log(action, entity_type, entity_id, metadata, created_at)
    values (
      'ATTENDANCE_IDENTITY_REVIEWED',
      'attendance_identity_check',
      p_check_id,
      jsonb_build_object('decision', v_decision, 'notes', coalesce(p_notes, ''), 'attendance_event_id', v_check.attendance_event_id),
      now()
    );
  elsif to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs(action, entity_type, entity_id, actor_user_id, metadata, created_at)
    values (
      'ATTENDANCE_IDENTITY_REVIEWED',
      'attendance_identity_check',
      p_check_id,
      auth.uid(),
      jsonb_build_object('decision', v_decision, 'notes', coalesce(p_notes, ''), 'attendance_event_id', v_check.attendance_event_id),
      now()
    );
  end if;

  return jsonb_build_object('ok', true, 'decision', v_decision, 'check_id', p_check_id);
end;
$$;

comment on view public.attendance_identity_review_queue is
  'HR/Admin queue for reviewing identity-guarded attendance punches with medium/high risk.';
comment on function public.review_attendance_identity_check(uuid, text, text) is
  'Approves, rejects, or escalates an attendance identity check using role-based permissions.';

-- Storage policies for punch-selfies bucket, if Supabase Storage is enabled.
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists "punch_selfies_authenticated_upload" on storage.objects';
    execute 'drop policy if exists "punch_selfies_reviewer_read" on storage.objects';

    execute $pol$
      create policy "punch_selfies_authenticated_upload"
      on storage.objects for insert to authenticated
      with check (bucket_id = 'punch-selfies')
    $pol$;

    execute $pol$
      create policy "punch_selfies_reviewer_read"
      on storage.objects for select to authenticated
      using (
        bucket_id = 'punch-selfies'
        and (
          owner = auth.uid()
          or public.has_app_permission('attendance:review')
          or public.has_app_permission('attendance:manage')
          or public.has_app_permission('hr:operations')
          or public.has_app_permission('executive:mobile')
        )
      )
    $pol$;
  end if;
exception when others then
  raise warning 'Storage policies for punch-selfies were not applied: %', sqlerrm;
end;
$$;

commit;
