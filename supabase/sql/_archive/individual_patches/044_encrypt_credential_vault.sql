-- Patch 044: Encrypt credential_vault.temporary_password
-- Requires: app.vault_key to be set in Supabase Project Settings / Secrets before running.
begin;

create extension if not exists pgcrypto;

alter table if exists public.credential_vault
  add column if not exists encrypted_password bytea;

do $$
declare
  vault_key text;
begin
  vault_key := current_setting('app.vault_key', true);
  if vault_key is null or vault_key = '' then
    raise warning 'app.vault_key is not set; encrypted_password migration skipped. Set the secret and re-run this patch.';
  else
    update public.credential_vault
    set encrypted_password = extensions.pgp_sym_encrypt(coalesce(temporary_password, ''), vault_key)
    where temporary_password is not null
      and temporary_password <> ''
      and encrypted_password is null;
  end if;
end $$;

comment on column public.credential_vault.temporary_password is
  'DEPRECATED PLAINTEXT — use encrypted_password. Drop this column only after verifying migration.';

create or replace function public.get_my_vault_entry()
returns table (id text, created_at timestamptz, decrypted_password text)
language sql
security definer
stable
set search_path = public
as $$
  select
    cv.id::text,
    cv.created_at,
    extensions.pgp_sym_decrypt(cv.encrypted_password, current_setting('app.vault_key', true)) as decrypted_password
  from public.credential_vault cv
  where cv.encrypted_password is not null
    and (public.current_can_view_password_vault())
  order by cv.created_at desc
  limit 1;
$$;

commit;
