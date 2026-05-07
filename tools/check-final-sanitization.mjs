import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
assert(existsSync(join(root, 'supabase/functions/send-push-notifications/index.ts')), 'Canonical send-push-notifications Edge Function must exist.');
assert(!existsSync(join(root, 'supabase/functions/send-push-notification/index.ts')), 'Deprecated singular push function must not be active.');
assert(sql.includes("to_regclass('public.role_permissions')"), 'Final SQL must guard legacy role_permissions.');
assert(sql.includes('join public.roles r on r.id = p.role_id'), 'Policies must use profiles.role_id + roles.slug.');
assert(read('supabase/config.toml').includes('[functions.send-push-notifications]'), 'Supabase config must include send-push-notifications function.');
assert(!read('supabase/config.toml').includes('[functions.send-push-notification]'), 'Supabase config must not include deprecated singular push function.');
if (failures.length) { console.error('Final sanitization check failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('Final sanitization check passed.');
