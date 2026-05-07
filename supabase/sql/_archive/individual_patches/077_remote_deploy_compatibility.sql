-- Patch 077: Remote deploy compatibility helpers.
-- Purpose: make older SQL Editor patches compatible with the current permission helper names.

begin;

create or replace function public.has_app_permission(required_scope text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.current_has_any_scope(array[required_scope]);
$$;

comment on function public.has_app_permission(text) is
  'Compatibility wrapper for older SQL patches; delegates to current_has_any_scope(text[]).';

alter table if exists public.attendance_risk_events
  add column if not exists risk_flag text,
  add column if not exists risk_score integer not null default 0,
  add column if not exists details jsonb default '{}'::jsonb;

commit;
