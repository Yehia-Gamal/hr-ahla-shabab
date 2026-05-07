import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
assert(existsSync(join(root, 'supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql')), 'Final SQL Editor bundle must exist.');
const allSql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
for (const token of ['create table if not exists public.system_settings','add column if not exists keys jsonb','database_migration_status','current_can_view_password_vault','encrypted_temporary_password','current_can_see_employee','admin_decision_acknowledgements','safe_create_notification','safe_create_notifications_bulk']) assert(allSql.includes(token), `Final SQL must include ${token}.`);
assert(read('shared/js/supabase-api.js').includes('send-push-notifications'), 'Supabase runtime must invoke canonical send-push-notifications.');
assert(!read('shared/js/supabase-api.js').includes('send-push-notification"') && !read('shared/js/supabase-api.js').includes("send-push-notification'"), 'Supabase runtime must not call deprecated singular push function.');
if (failures.length) { console.error('SQL/runtime alignment check failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('SQL/runtime alignment check passed.');
