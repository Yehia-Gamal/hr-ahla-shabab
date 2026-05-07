-- Patch 047: MFA trusted devices table
begin;

create table if not exists public.trusted_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_fingerprint text not null,
  device_name text default '',
  trusted_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  created_at timestamptz not null default now()
);

create unique index if not exists idx_trusted_devices_user_fp
  on public.trusted_devices(user_id, device_fingerprint);

alter table public.trusted_devices enable row level security;

drop policy if exists "user_own_devices" on public.trusted_devices;
create policy "user_own_devices" on public.trusted_devices
  for all using (auth.uid() = user_id);

-- Remove expired trusted devices
create or replace function public.cleanup_expired_trusted_devices()
returns void language sql security definer as $$
  delete from public.trusted_devices where expires_at < now();
$$;

comment on table public.trusted_devices is
  'أجهزة موثوقة لتجاوز MFA لمدة 30 يوم للأدوار الحساسة';

commit;
