import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
assert(sql.includes('attendance_identity_verification'), 'Final SQL must include attendance_identity_verification.');
assert(sql.includes('attendance_identity_server_review'), 'Final SQL must include attendance_identity_server_review.');
assert(sql.includes('trusted_device_approval'), 'Final SQL must include trusted_device_approval.');
assert(sql.includes('attendance_branch_qr_challenge'), 'Final SQL must include attendance_branch_qr_challenge.');
assert(sql.includes('attendance_anti_spoofing_risk'), 'Final SQL must include attendance_anti_spoofing_risk.');
assert(sql.includes('attendance_risk_center'), 'Final SQL must include attendance_risk_center.');
if (failures.length) { console.error('tools/check-attendance-identity.mjs failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('attendance identity check passed.');
