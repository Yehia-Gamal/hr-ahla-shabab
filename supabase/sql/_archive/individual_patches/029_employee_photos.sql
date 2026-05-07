-- =========================================================
-- 029_employee_photos.sql
-- Production hardening note:
-- Employee face photos are no longer bundled inside the web package.
-- Upload real photos to Supabase Storage bucket `avatars` and save signed/public URLs
-- through the app instead of shipping personal images with the frontend.
-- This migration is intentionally safe/no-op for fresh production installs.
-- =========================================================

alter table if exists public.employees add column if not exists photo_url text;
alter table if exists public.profiles add column if not exists avatar_url text;

-- Remove old packaged-image references if a previous build inserted them.
update public.employees
set photo_url = null
where photo_url like '%/shared/images/employees/%';

update public.profiles
set avatar_url = null
where avatar_url like '%/shared/images/employees/%';
