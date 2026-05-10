

-- QC5 legacy audit_log compatibility: older installations used singular audit_log
-- without entity metadata columns. Add them safely when the legacy table exists.
alter table if exists public.audit_log
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists metadata jsonb default '{}'::jsonb;

-- =========================================================
-- QC5 FINAL SQL ALIGNMENT MARKER
-- Ensures patch_markers exists before verification references it.
-- =========================================================
create table if not exists public.patch_markers (
  patch_key text primary key,
  applied_at timestamptz not null default now(),
  notes text default ''
);

alter table public.patch_markers enable row level security;

drop policy if exists "patch_markers_read_admins" on public.patch_markers;
create policy "patch_markers_read_admins" on public.patch_markers
  for select using (
    public.has_any_permission(array['settings:manage','database:migrations','audit:read','*'])
  );

drop policy if exists "patch_markers_write_admins" on public.patch_markers;
create policy "patch_markers_write_admins" on public.patch_markers
  for all using (
    public.has_any_permission(array['settings:manage','database:migrations','*'])
  ) with check (
    public.has_any_permission(array['settings:manage','database:migrations','*'])
  );

insert into public.database_migration_status (name, status, applied_at, notes)
values
  ('104_sql_qc4_static_runtime_alignment', 'APPLIED', now(), 'QC4: Guarded legacy runtime references and aligned operations center.'),
  ('104_sql_qc5_final_alignment', 'APPLIED', now(), 'QC5: Created patch_markers safely and aligned verification checks for fresh Supabase installs.')
on conflict (name) do update
  set status = excluded.status,
      notes = excluded.notes,
      applied_at = now();

insert into public.patch_markers(patch_key, applied_at, notes)
values
  ('104_sql_qc4_static_runtime_alignment', now(), 'Guarded legacy attendance/audit cleanup references and aligned operations center with missions table.'),
  ('104_sql_qc5_final_alignment', now(), 'Created patch_markers safely and aligned verification checks for fresh Supabase installs.')
on conflict (patch_key) do update
  set applied_at = excluded.applied_at,
      notes = excluded.notes;

notify pgrst, 'reload schema';
