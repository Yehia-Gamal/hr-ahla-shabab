-- Patch 058: Branch QR station rotation settings and admin station view
-- Purpose: make the branch QR challenge operational for an on-site screen/tablet.
begin;

create table if not exists public.branch_qr_station_settings (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  rotate_seconds integer not null default 60 check (rotate_seconds between 30 and 300),
  require_qr_for_punch boolean not null default true,
  station_label text not null default 'شاشة QR الفرع',
  is_active boolean not null default true,
  last_challenge_id uuid,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

alter table public.branch_qr_station_settings enable row level security;

drop policy if exists branch_qr_station_settings_read on public.branch_qr_station_settings;
create policy branch_qr_station_settings_read on public.branch_qr_station_settings
  for select using (auth.uid() is not null);

drop policy if exists branch_qr_station_settings_admin_write on public.branch_qr_station_settings;
create policy branch_qr_station_settings_admin_write on public.branch_qr_station_settings
  for all using (
    public.has_app_permission('attendance:manage')
    or public.has_app_permission('settings:manage')
    or public.has_app_permission('users:manage')
  ) with check (
    public.has_app_permission('attendance:manage')
    or public.has_app_permission('settings:manage')
    or public.has_app_permission('users:manage')
  );

create or replace view public.branch_qr_station_board as
select
  b.id as branch_id,
  b.name as branch_name,
  coalesce(s.rotate_seconds, 60) as rotate_seconds,
  coalesce(s.require_qr_for_punch, true) as require_qr_for_punch,
  coalesce(s.station_label, 'شاشة QR الفرع') as station_label,
  coalesce(s.is_active, true) as is_active,
  c.id as challenge_id,
  c.challenge_code,
  c.valid_until,
  c.created_at as challenge_created_at
from public.branches b
left join public.branch_qr_station_settings s on s.branch_id = b.id
left join lateral (
  select * from public.branch_qr_challenges c
  where c.branch_id = b.id
    and c.valid_until > now()
  order by c.created_at desc
  limit 1
) c on true;

create or replace function public.ensure_branch_qr_station_challenge(p_branch_id uuid)
returns table (
  branch_id uuid,
  challenge_id uuid,
  challenge_code text,
  valid_until timestamptz,
  rotate_seconds integer,
  require_qr_for_punch boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_setting public.branch_qr_station_settings%rowtype;
  v_row record;
begin
  if not (public.has_app_permission('attendance:manage') or public.has_app_permission('settings:manage') or public.has_app_permission('executive:report')) then
    raise exception 'not authorized';
  end if;

  select * into v_setting from public.branch_qr_station_settings where branch_id = p_branch_id;
  if not found then
    insert into public.branch_qr_station_settings(branch_id, updated_by)
    values (p_branch_id, auth.uid())
    on conflict (branch_id) do nothing;
    select * into v_setting from public.branch_qr_station_settings where branch_id = p_branch_id;
  end if;

  select * into v_row
  from public.branch_qr_challenges
  where branch_id = p_branch_id and valid_until > now() + interval '10 seconds'
  order by created_at desc
  limit 1;

  if not found then
    select * into v_row
    from public.create_branch_qr_challenge(p_branch_id)
    limit 1;
    update public.branch_qr_station_settings
      set last_challenge_id = v_row.challenge_id,
          updated_at = now(),
          updated_by = auth.uid()
    where branch_id = p_branch_id;
  end if;

  return query select
    p_branch_id,
    v_row.challenge_id,
    v_row.challenge_code,
    v_row.valid_until,
    coalesce(v_setting.rotate_seconds, 60),
    coalesce(v_setting.require_qr_for_punch, true);
end;
$$;

comment on view public.branch_qr_station_board is
  'Operational screen data for rotating branch QR punch challenges.';

commit;
