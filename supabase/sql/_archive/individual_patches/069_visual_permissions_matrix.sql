-- Patch 069: Visual permissions matrix support
begin;

create table if not exists public.permission_catalog (
  permission_key text primary key,
  title_ar text not null,
  category text not null default 'general',
  description text default '',
  is_sensitive boolean not null default false,
  created_at timestamptz not null default now()
);

insert into public.permission_catalog(permission_key,title_ar,category,is_sensitive)
values
('employees:read','عرض الموظفين','employees',false),
('employees:manage','إدارة الموظفين','employees',true),
('attendance:review','مراجعة الحضور','attendance',true),
('reports:export','تصدير التقارير','reports',true),
('settings:manage','إدارة الإعدادات','settings',true),
('disputes:committee','لجنة الخلافات','disputes',true)
on conflict (permission_key) do update set title_ar=excluded.title_ar, category=excluded.category, is_sensitive=excluded.is_sensitive;

commit;
