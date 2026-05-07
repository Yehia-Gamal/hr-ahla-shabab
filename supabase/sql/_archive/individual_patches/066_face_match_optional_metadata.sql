-- Patch 066: Optional face-match metadata for punch selfies
begin;

alter table if exists public.attendance_identity_checks
  add column if not exists face_match_score numeric,
  add column if not exists face_match_status text default 'NOT_RUN'
    check (face_match_status in ('NOT_RUN','MATCH','WEAK_MATCH','NO_MATCH','MANUAL_REVIEW','ERROR')),
  add column if not exists liveness_status text default 'NOT_RUN'
    check (liveness_status in ('NOT_RUN','PASS','FAIL','MANUAL_REVIEW','ERROR'));

create index if not exists idx_attendance_identity_face_status
  on public.attendance_identity_checks(face_match_status, created_at desc);

commit;
