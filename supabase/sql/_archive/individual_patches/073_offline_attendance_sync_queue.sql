-- Patch 073: Offline attendance sync queue
begin;

create table if not exists public.offline_attendance_sync_queue (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid null,
  user_id uuid null references auth.users(id),
  client_attempt_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'PENDING_REVIEW' check (status in ('PENDING_REVIEW','SYNCED','REJECTED','DUPLICATE')),
  review_note text default '',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz null,
  unique(client_attempt_id)
);

create index if not exists idx_offline_attendance_sync_status
  on public.offline_attendance_sync_queue(status, created_at desc);

commit;
