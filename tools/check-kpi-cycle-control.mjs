import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
const sql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
assert(sql.includes('038_kpi_cycle_control_reports'), 'Final SQL must include 038_kpi_cycle_control_reports.');
assert(sql.includes('kpi_cycles'), 'Final SQL must include kpi_cycles.');
if (failures.length) { console.error('tools/check-kpi-cycle-control.mjs failed:'); failures.forEach((f) => console.error(`- ${f}`)); process.exit(1); }
console.log('kpi cycle control check passed.');
