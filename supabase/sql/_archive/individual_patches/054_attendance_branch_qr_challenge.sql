-- Patch 054: Rotating branch QR challenge for attendance confirmation
begin;

create extension if not exists pgcrypto;

create table if not exists public.branch_qr_challenges (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid,
  challenge_code text not null unique,
  challenge_hash text not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null default (now() + interval '90 seconds'),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

alter table public.branch_qr_challenges enable row level security;

drop policy if exists "reviewers_manage_branch_qr" on public.branch_qr_challenges;
create policy "reviewers_manage_branch_qr"
  on public.branch_qr_challenges
  for all
  using (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'))
  with check (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage'));

create index if not exists idx_branch_qr_valid
  on public.branch_qr_challenges(branch_id, valid_until desc);

create or replace function public.create_branch_qr_challenge(p_branch_id uuid default null)
returns table (id uuid, challenge_code text, valid_until timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not (public.has_app_permission('attendance:review') or public.has_app_permission('users:manage')) then
    raise exception 'NOT_AUTHORIZED';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(9), 'hex'), 1, 12));
  insert into public.branch_qr_challenges(branch_id, challenge_code, challenge_hash, created_by)
  values (p_branch_id, v_code, encode(digest(v_code, 'sha256'), 'hex'), auth.uid())
  returning public.branch_qr_challenges.id, public.branch_qr_challenges.challenge_code, public.branch_qr_challenges.valid_until
  into id, challenge_code, valid_until;
  return next;
end;
$$;

create or replace function public.validate_branch_qr_challenge(
  p_branch_id uuid default null,
  p_challenge_code text default ''
)
returns table (valid boolean, reason text, challenge_id uuid)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  return query
  select true, 'VALID'::text, c.id
  from public.branch_qr_challenges c
  where c.challenge_hash = encode(digest(upper(trim(coalesce(p_challenge_code,''))), 'sha256'), 'hex')
    and (p_branch_id is null or c.branch_id is null or c.branch_id = p_branch_id)
    and now() between c.valid_from and c.valid_until
  order by c.valid_until desc
  limit 1;
  if not found then
    return query select false, 'INVALID_OR_EXPIRED'::text, null::uuid;
  end if;
end;
$$;

comment on table public.branch_qr_challenges is
  'أكواد QR متغيرة داخل الفرع؛ الموظف يثبت حضوره فعليًا داخل المكان بمسح كود صالح قصير المدة.';

commit;
