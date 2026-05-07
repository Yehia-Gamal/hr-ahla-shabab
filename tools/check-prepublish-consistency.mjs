import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
assert(sql.includes('032b_pre_publish_role_portal_consistency'), 'Final SQL must include 032b_pre_publish_role_portal_consistency.');
assert(sql.includes('033a_final_web_production_hardening'), 'Final SQL must include 033a_final_web_production_hardening.');
assert(sql.includes('034a_final_lockdown_cleanup'), 'Final SQL must include 034a_final_lockdown_cleanup.');
assert(sql.includes('035_final_sanitization_live_readiness'), 'Final SQL must include 035_final_sanitization_live_readiness.');
if (failures.length) { console.error('tools/check-prepublish-consistency.mjs failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('prepublish consistency check passed.');
