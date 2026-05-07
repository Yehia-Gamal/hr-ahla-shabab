-- =========================================================
-- 037 KPI Policy Window + HR-only scoring fields
-- تقييم الأداء الشهري: من يوم 20 إلى يوم 25
-- HR فقط: الحضور والانصراف، الصلاة في المسجد، حلقة الشيخ وليد يوسف الأسبوعية لتدريس القرآن والتجويد
-- =========================================================

alter table if exists public.kpi_evaluations
  add column if not exists meeting_held boolean default false,
  add column if not exists hr_notes text,
  add column if not exists submitted_to_manager_at timestamptz,
  add column if not exists manager_reviewed_at timestamptz,
  add column if not exists hr_reviewed_at timestamptz,
  add column if not exists secretary_reviewed_at timestamptz,
  add column if not exists executive_approved_at timestamptz;

create table if not exists public.kpi_policy (
  id text primary key default 'default',
  evaluation_start_day integer not null default 20 check (evaluation_start_day between 1 and 31),
  evaluation_end_day integer not null default 25 check (evaluation_end_day between 1 and 31),
  submission_deadline_day integer not null default 25 check (submission_deadline_day between 1 and 31),
  meeting_required boolean not null default true,
  total_score integer not null default 100,
  hr_only_codes text[] not null default array['ATTENDANCE_COMMITMENT','MOSQUE_PRAYER','QURAN_CIRCLE'],
  updated_at timestamptz not null default now()
);

insert into public.kpi_policy (
  id,
  evaluation_start_day,
  evaluation_end_day,
  submission_deadline_day,
  meeting_required,
  total_score,
  hr_only_codes
) values (
  'default',
  20,
  25,
  25,
  true,
  100,
  array['ATTENDANCE_COMMITMENT','MOSQUE_PRAYER','QURAN_CIRCLE']
)
on conflict (id) do update set
  evaluation_start_day = excluded.evaluation_start_day,
  evaluation_end_day = excluded.evaluation_end_day,
  submission_deadline_day = excluded.submission_deadline_day,
  meeting_required = excluded.meeting_required,
  total_score = excluded.total_score,
  hr_only_codes = excluded.hr_only_codes,
  updated_at = now();

-- مرجع معايير KPI الرسمي داخل قاعدة البيانات لمن يريد استخدامه في التقارير.
create table if not exists public.kpi_criteria_policy (
  code text primary key,
  name text not null,
  max_score numeric not null,
  scoring_owner text not null check (scoring_owner in ('employee_manager','hr_only')),
  sort_order integer not null
);

insert into public.kpi_criteria_policy (code, name, max_score, scoring_owner, sort_order) values
  ('TARGET', 'تحقيق الأهداف', 40, 'employee_manager', 1),
  ('TASK_EFFICIENCY', 'الكفاءة في أداء المهام', 20, 'employee_manager', 2),
  ('ATTENDANCE_COMMITMENT', 'الالتزام بمواعيد العمل حضورًا وانصرافًا', 20, 'hr_only', 3),
  ('CONDUCT', 'حسن التعامل والسلوك مع الزملاء والمديرين', 5, 'employee_manager', 4),
  ('MOSQUE_PRAYER', 'الالتزام بالصلاة في المسجد', 5, 'hr_only', 5),
  ('QURAN_CIRCLE', 'حضور حلقة الشيخ وليد يوسف الأسبوعية لتدريس القرآن والتجويد', 5, 'hr_only', 6),
  ('INITIATIVES_DONATIONS', 'المشاركة في التبرعات والمبادرات', 5, 'employee_manager', 7)
on conflict (code) do update set
  name = excluded.name,
  max_score = excluded.max_score,
  scoring_owner = excluded.scoring_owner,
  sort_order = excluded.sort_order;

-- تأكيد صلاحية اعتماد المدير التنفيذي النهائي للتقييمات.
update public.roles
set permissions = (
  select array_agg(distinct permission)
  from unnest(coalesce(permissions, '{}') || array['kpi:executive','kpi:final-approve']) as permission
)
where slug in ('executive') or key = 'EXECUTIVE';

-- تأكيد صلاحيات HR لمراجعة بنوده فقط، والمدير المباشر لبنود الفريق.
update public.roles
set permissions = (
  select array_agg(distinct permission)
  from unnest(coalesce(permissions, '{}') || array['kpi:hr','hr:attendance','employees:read']) as permission
)
where slug in ('hr-manager') or key = 'HR_MANAGER';

update public.roles
set permissions = (
  select array_agg(distinct permission)
  from unnest(coalesce(permissions, '{}') || array['kpi:team','team:read']) as permission
)
where slug in ('manager', 'direct-manager', 'operations-manager-1', 'operations-manager-2') or key in ('MANAGER', 'DIRECT_MANAGER');

comment on table public.kpi_policy is 'السياسة الرسمية لتقييم KPI: من يوم 20 إلى 25، آخر تسليم يوم 25، وإجمالي 100 درجة.';
comment on table public.kpi_criteria_policy is 'تعريف معايير KPI الرسمية وتحديد البنود الخاصة بـ HR فقط.';
