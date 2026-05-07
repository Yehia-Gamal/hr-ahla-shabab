-- Patch 067: Smart alerts engine rules and event queue
begin;

create table if not exists public.smart_alert_rules (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  title text not null,
  description text default '',
  target_role text default 'hr',
  is_active boolean not null default true,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','CRITICAL')),
  schedule_hint text default '',
  created_at timestamptz not null default now()
);

create table if not exists public.smart_alert_events (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null,
  employee_id uuid null,
  title text not null,
  body text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','CRITICAL')),
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED','DISMISSED')),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz null
);

insert into public.smart_alert_rules(code,title,description,target_role,severity,schedule_hint)
values
('MISSING_PUNCH_0930','تذكير بصمة 9:30','تنبيه للموظفين الذين لم يسجلوا حضورهم حتى 9:30','employee','WARNING','daily 09:30'),
('HIGH_RISK_ATTENDANCE','بصمة عالية الخطورة','تصعيد بصمات الحضور ذات درجة خطر عالية','hr','CRITICAL','realtime'),
('PENDING_MANAGER_APPROVAL','موافقات مدير معلقة','تنبيه المدير بطلبات فريقه المعلقة','direct_manager','WARNING','hourly')
on conflict (code) do update set title=excluded.title, description=excluded.description, target_role=excluded.target_role, severity=excluded.severity, schedule_hint=excluded.schedule_hint;

commit;
