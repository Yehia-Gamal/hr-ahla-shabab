-- =========================================================
-- 014 - Fix employee location payload compatibility + contact fields + precise coordinates
-- Date: 28 Apr 2026
-- =========================================================

-- Keep high precision for the exact Google Maps coordinates supplied by operations.
alter table if exists public.branches
  alter column latitude type numeric(18,15) using latitude::numeric,
  alter column longitude type numeric(18,15) using longitude::numeric;

alter table if exists public.employees
  alter column last_location_latitude type numeric(18,15) using last_location_latitude::numeric,
  alter column last_location_longitude type numeric(18,15) using last_location_longitude::numeric;

alter table if exists public.attendance_events
  alter column latitude type numeric(18,15) using latitude::numeric,
  alter column longitude type numeric(18,15) using longitude::numeric;

alter table if exists public.employee_locations
  alter column latitude type numeric(18,15) using latitude::numeric,
  alter column longitude type numeric(18,15) using longitude::numeric;

alter table if exists public.employee_locations
  add column if not exists accuracy_meters numeric(10,2);

alter table if exists public.profiles
  add column if not exists phone text;

-- The frontend now sends accuracy_meters only. This patch intentionally does not add an
-- accuracy column, so bad payloads keep failing instead of hiding schema drift.
update public.branches
set name = 'مجمع منيل شيحة',
    address = 'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912',
    latitude = 29.951196809090636,
    longitude = 31.238367688465857,
    geofence_radius_meters = 300,
    max_accuracy_meters = 500,
    active = true,
    is_deleted = false,
    updated_at = now()
where code in ('MAIN', 'AHLA-MANIL')
   or name ilike '%منيل%';

insert into public.branches (code, name, address, latitude, longitude, geofence_radius_meters, max_accuracy_meters, active, is_deleted)
select 'AHLA-MANIL',
       'مجمع منيل شيحة',
       'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912',
       29.951196809090636,
       31.238367688465857,
       300,
       500,
       true,
       false
where not exists (select 1 from public.branches where code in ('MAIN', 'AHLA-MANIL') or name ilike '%منيل%');

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='address') then
    execute $sql$
      update public.complexes
      set address = 'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912'
      where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')
    $sql$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='latitude') then
    execute $sql$
      update public.complexes
      set latitude = 29.951196809090636
      where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')
    $sql$;
  end if;

  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='complexes' and column_name='longitude') then
    execute $sql$
      update public.complexes
      set longitude = 31.238367688465857
      where name ilike '%منيل%' or code in ('AHLA-MANIL', 'CX-AHLA-MANIL')
    $sql$;
  end if;
end $$;

-- Keep phone login lookup fast after contact edits.
create index if not exists idx_employees_phone_normalized on public.employees (public.normalize_egypt_phone(phone));
create index if not exists idx_profiles_phone_normalized on public.profiles (public.normalize_egypt_phone(phone));
