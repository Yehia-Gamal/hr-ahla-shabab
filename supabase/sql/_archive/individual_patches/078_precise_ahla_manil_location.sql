-- Patch 078: Precise Ahla Shabab Manil Shihah geofence.
-- Source: user-provided Google Maps coordinate 29.950738592862045, 31.238094542328678.

begin;

update public.branches
set name = case when nullif(trim(name), '') is null then 'مجمع أحلى شباب منيل شيحة' else name end,
    address = 'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912',
    latitude = 29.950738592862045,
    longitude = 31.238094542328678,
    geofence_radius_meters = 180,
    max_accuracy_meters = 90,
    active = true,
    is_deleted = false,
    updated_at = now()
where code in ('MAIN', 'AHLA-MANIL', 'CX-AHLA-MANIL')
   or name ilike '%منيل%'
   or name ilike '%أحلى شباب%';

insert into public.branches (code, name, address, latitude, longitude, geofence_radius_meters, max_accuracy_meters, active, is_deleted)
select
  'AHLA-MANIL',
  'مجمع أحلى شباب منيل شيحة',
  'شارع مزلقان العرب, Manil Shihah, Abu El Numrus, Giza Governorate 12912',
  29.950738592862045,
  31.238094542328678,
  180,
  90,
  true,
  false
where not exists (
  select 1 from public.branches
  where code in ('MAIN', 'AHLA-MANIL', 'CX-AHLA-MANIL')
     or name ilike '%منيل%'
     or name ilike '%أحلى شباب%'
);

do $$
begin
  if to_regclass('public.complexes') is not null then
    update public.complexes
    set name = case when nullif(trim(name), '') is null then 'مجمع أحلى شباب منيل شيحة' else name end,
        active = true,
        is_deleted = false,
        updated_at = now()
    where code in ('AHLA-MANIL', 'CX-AHLA-MANIL')
       or name ilike '%منيل%'
       or name ilike '%أحلى شباب%';

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'complexes' and column_name = 'latitude'
    ) then
      update public.complexes
      set latitude = 29.950738592862045
      where code in ('AHLA-MANIL', 'CX-AHLA-MANIL') or name ilike '%منيل%' or name ilike '%أحلى شباب%';
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'complexes' and column_name = 'longitude'
    ) then
      update public.complexes
      set longitude = 31.238094542328678
      where code in ('AHLA-MANIL', 'CX-AHLA-MANIL') or name ilike '%منيل%' or name ilike '%أحلى شباب%';
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'complexes' and column_name = 'radius_meters'
    ) then
      update public.complexes
      set radius_meters = 180
      where code in ('AHLA-MANIL', 'CX-AHLA-MANIL') or name ilike '%منيل%' or name ilike '%أحلى شباب%';
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'complexes' and column_name = 'max_accuracy_meters'
    ) then
      update public.complexes
      set max_accuracy_meters = 90
      where code in ('AHLA-MANIL', 'CX-AHLA-MANIL') or name ilike '%منيل%' or name ilike '%أحلى شباب%';
    end if;
  end if;
end $$;

insert into public.settings (key, value, updated_at)
values (
  'attendance.gps_policy',
  '{"samples":18,"sampleWindowMs":30000,"targetAccuracyMeters":15,"maxAcceptableAccuracyMeters":90,"safetyBufferMeters":90,"uncertainReviewOnly":true,"branchLocation":{"name":"مجمع أحلى شباب","area":"منيل شيحة - الجيزة","latitude":29.950738592862045,"longitude":31.238094542328678,"radiusMeters":180,"safetyBufferMeters":90,"maxAccuracyMeters":90}}'::jsonb,
  now()
)
on conflict (key) do update
set value = excluded.value,
    updated_at = excluded.updated_at;

insert into public.system_settings (key, value, description, updated_at)
values (
  'attendance.gps_policy',
  '{"samples":18,"sampleWindowMs":30000,"targetAccuracyMeters":15,"maxAcceptableAccuracyMeters":90,"safetyBufferMeters":90,"uncertainReviewOnly":true,"branchLocation":{"name":"مجمع أحلى شباب","area":"منيل شيحة - الجيزة","latitude":29.950738592862045,"longitude":31.238094542328678,"radiusMeters":180,"safetyBufferMeters":90,"maxAccuracyMeters":90}}'::jsonb,
  'Precise Ahla Shabab Manil Shihah GPS policy and geofence center.',
  now()
)
on conflict (key) do update
set value = excluded.value,
    description = excluded.description,
    updated_at = excluded.updated_at;

commit;
