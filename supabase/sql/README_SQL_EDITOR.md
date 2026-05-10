# Supabase SQL Editor — HR v104

## الملف الرئيسي

شغّل الملف التالي داخل Supabase SQL Editor:

`supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql`

هذا الملف أصبح يضم:

1. الـ base schema والـ patches السابقة حتى 098.
2. دمج v104 SQL الآمن بعد فحص حزمة `HR_104_COMPLETE_SQL_MIGRATION.zip`.

## التحقق بعد التشغيل

بعد التشغيل، شغّل:

`supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql`

يجب أن تظهر نتيجة `OK` خاصة بـ:

- `latest_base_migration_098`
- `v104_sql_merge_marker`
- `v104_system_setting`
- `v104_attendance_points_table`
- `v104_employee_analytics_table`
- `v104_push_log_table`

## ملاحظة مهمة

تم أرشفة ملف SQL الأصلي المرفوع لأنه كان يحتوي تعارضات قد تكسر التشغيل:

`supabase/sql/_archive/v104_complete_sql_migration_original/`

وتم دمج نسخة آمنة مُراجعة داخل `RUN_IN_SUPABASE_SQL_EDITOR.sql`.
