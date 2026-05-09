import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
function moduleToScript(source) {
  return source.replace(/^\s*import\s+[^;]+;\s*$/gm, '').replace(/^\s*export\s+default\s+/gm, '').replace(/^\s*export\s+(async\s+function|function|class)\s+/gm, '$1 ').replace(/^\s*export\s+(const|let|var)\s+/gm, '$1 ').replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
}
for (const file of ['shared/js/api.js','shared/js/app-admin.js','shared/js/employee-app.js','shared/js/executive-app.js','shared/js/supabase-api.js','shared/js/register-sw.js','shared/js/runtime-diagnostics.js','sw.js','sw-admin.js','sw-employee.js','sw-executive.js','shared/js/v9-hardening.js','shared/js/v10-private-deploy-fixes.js']) {
  try { new Script(moduleToScript(read(file)), { filename: file }); } catch (error) { failures.push(`${file}: ${error.message}`); }
}
for (const file of ['index.html','admin-login.html','operations-gate/index.html','admin/index.html','employee/index.html','executive/index.html','tools/reset-cache.html'].filter((f) => existsSync(join(root, f)))) {
  const html = read(file);
  [...html.matchAll(/<script(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)].forEach((match, index) => {
    const code = match[1].trim();
    if (!code) return;
    try { new Script(code, { filename: `${file} inline script #${index + 1}` }); } catch (error) { failures.push(`${file} inline script #${index + 1}: ${error.message}`); }
  });
}
const api = read('shared/js/api.js');
const app = read('shared/js/app-admin.js');
const db = read('shared/js/database.js');
const sw = read('sw.js');
const reg = read('shared/js/register-sw.js');
const supabaseApi = read('shared/js/supabase-api.js');
const finalSql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
assert(read('package.json').includes('v33-ui-ux-overhaul-101'), 'Package version must be v33-ui-ux-overhaul-101.');
assert(existsSync(join(root, 'shared/js/runtime-diagnostics.js')), 'Runtime diagnostics module must exist.');
assert(read('health.html').includes('runRuntimeDiagnostics'), 'health.html must use runtime diagnostics.');
assert(existsSync(join(root, 'supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql')), 'Final SQL Editor file must exist.');
assert(existsSync(join(root, 'supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql')), 'Post deploy verify SQL must exist.');
for (const token of ['037_kpi_policy_window_hr_scoring','038_kpi_cycle_control_reports','039_management_hr_reports_workflow','040_runtime_alignment_fix','041_audit_v7_security_mobile_alignment','042_authorized_roster_phone_login_internal_channel','064_attendance_fallback_workflow']) assert(finalSql.includes(token), `${token} must exist in final SQL bundle.`);
for (const route of ['management-structure','team-dashboard','hr-operations','dispute-workflow','report-center','presence-map','attendance-risk','admin-decisions','monthly-auto-pdf']) assert(app.includes(route), `Missing route ${route}.`);
for (const fn of ['managementStructure','assignManager','teamDashboard','hrOperations','disputeWorkflow','reportCenter','exportManagementReport','executivePresenceDashboard','attendanceRiskCenter','adminDecisions','monthlyAutoPdfReports']) assert(api.includes(`${fn}: async`), `Missing local endpoint ${fn}.`);
for (const fn of ['managementStructure','assignManager','teamDashboard','hrOperations','disputeWorkflow','reportCenter','exportManagementReport','monthlyEvaluations','runSmartAttendance','databaseMigrationsStatus','myActionCenter','executivePresenceDashboard','attendanceRiskCenter','adminDecisions','monthlyAutoPdfReports']) assert(supabaseApi.includes(`${fn}: async`), `Missing Supabase endpoint ${fn}.`);
for (const scope of ['organization:manage','team:dashboard','hr:operations','disputes:escalate','reports:pdf','reports:excel','attendance:risk','decisions:manage','reports:monthly-pdf-auto']) assert(api.includes(scope) && db.includes(scope), `Missing permission ${scope}.`);
assert(app.includes('حضور حلقة الشيخ وليد يوسف الأسبوعية') && app.includes('خاص بـ HR'), 'KPI HR-only fields must remain clear.');
assert(sw.includes('v33-ui-ux-overhaul-101') && reg.includes('v33-ui-ux-overhaul-101'), 'Service worker cache must use v33-ui-ux-overhaul-101.');
assert(sw.includes('CLEAR_HR_CACHES') && reg.includes('CLEAR_HR_CACHES'), 'Service worker cache clear command must exist.');
assert(supabaseApi.includes('send-push-notifications') && !supabaseApi.includes('send-push-notification"') && !supabaseApi.includes("send-push-notification'"), 'Runtime must use canonical send-push-notifications only.');
assert(read('operations-gate/index.html').includes('hr.opsGatewayUnlockedTarget'), 'Operations gate must keep scoped target unlock.');
assert(read('admin/index.html').includes("unlockedTarget === 'admin'"), 'Admin gate must require admin target.');
assert(read('executive/index.html').includes("unlockedTarget === 'executive'"), 'Executive gate must require executive target.');
if (failures.length) {
  console.error('All web checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('JS syntax check passed.');
console.log('HTML inline script check passed.');
console.log('Web guard check passed.');
console.log('KPI checks passed.');
console.log('Management/HR/reports suite check passed.');
console.log('Smoke check passed.');
console.log('All web checks passed.');
process.exit(0);
