-- Patch 072: Official internal messages and read receipts
begin;

create table if not exists public.official_messages (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  audience text not null default 'all',
  created_by uuid null references auth.users(id),
  is_formal_decision boolean not null default false,
  requires_ack boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.official_message_receipts (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.official_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz null,
  acknowledged_at timestamptz null,
  device_id text default '',
  unique(message_id, user_id)
);

create index if not exists idx_official_message_receipts_user
  on public.official_message_receipts(user_id, read_at desc);

commit;
