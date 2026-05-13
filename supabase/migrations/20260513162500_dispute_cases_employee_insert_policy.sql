-- Allow employees to submit their own dispute/complaint cases through the
-- mobile portal while keeping writes scoped to the authenticated employee.

begin;

create or replace function public.set_dispute_case_actor()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_dispute_cases_actor on public.dispute_cases;
create trigger trg_dispute_cases_actor
before insert or update on public.dispute_cases
for each row execute function public.set_dispute_case_actor();

drop policy if exists "disputes_insert_own_employee" on public.dispute_cases;
create policy "disputes_insert_own_employee" on public.dispute_cases
  for insert to authenticated
  with check (
    public.current_is_full_access()
    or employee_id = public.current_employee_id()
  );

drop policy if exists "disputes_update_own_draft" on public.dispute_cases;
create policy "disputes_update_own_draft" on public.dispute_cases
  for update to authenticated
  using (
    public.current_is_full_access()
    or (created_by = auth.uid() and employee_id = public.current_employee_id())
  )
  with check (
    public.current_is_full_access()
    or (created_by = auth.uid() and employee_id = public.current_employee_id())
  );

notify pgrst, 'reload schema';

commit;
