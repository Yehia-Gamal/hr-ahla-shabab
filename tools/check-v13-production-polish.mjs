import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
assert(sql.includes('v13_production_polish') || sql.includes('076_v13_phone_login_org_permissions_polish'), 'Final SQL must include v13 production polish marker.');
if (failures.length) { console.error('tools/check-v13-production-polish.mjs failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('v13 production polish check passed.');
