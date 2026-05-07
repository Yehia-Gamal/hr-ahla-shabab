import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const read = (file) => readFileSync(join(root, file), 'utf8');
for (const file of ['supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql','supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql','DEPLOY_SUPABASE_PRODUCTION.sh','DEPLOY_SUPABASE_PRODUCTION.ps1','shared/js/supabase-api.js','shared/js/register-sw.js','sw-admin.js']) assert(existsSync(join(root, file)), `${file} must exist.`);
const sql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
for (const token of ['safe_create_notification','safe_create_notifications_bulk','push_subscriptions','live_location_requests','081_v28_clean_single_push_function']) assert(sql.includes(token), `Final SQL must include ${token}.`);
assert(read('shared/js/supabase-api.js').includes('send-push-notifications'), 'Runtime must use canonical push function.');
assert(read('supabase/config.toml').includes('[functions.send-push-notifications]'), 'Supabase config must include canonical push function.');
if (failures.length) { console.error('Live deploy readiness check failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('Live deploy readiness checks passed.');
