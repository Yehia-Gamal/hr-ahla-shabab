import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (file) => readFileSync(join(root, file), 'utf8');
for (const file of ['index.html','admin/index.html','employee/index.html','executive/index.html','shared/js/api.js','shared/js/supabase-api.js','supabase/functions/send-push-notifications/index.ts','supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql']) assert(existsSync(join(root, file)), `${file} must exist.`);
const sql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
for (const token of ['employee_policies','daily_reports','kpi_cycles','push_subscriptions','safe_create_notifications_bulk']) assert(sql.includes(token), `Final SQL must include ${token}.`);
assert(read('shared/js/supabase-api.js').includes('send-push-notifications'), 'Push runtime must use canonical function.');
if (failures.length) { console.error('Smoke check failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('Smoke check passed.');
