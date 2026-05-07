import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';

const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };
const moduleToScript = (source) => source
  .replace(/^\s*export\s+(async\s+function|function|class)\s+/gm, '$1 ')
  .replace(/^\s*export\s+(const|let|var)\s+/gm, '$1 ')
  .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');

assert(existsSync(join(root, 'shared/js/runtime-diagnostics.js')), 'shared/js/runtime-diagnostics.js is missing.');
assert(existsSync(join(root, 'health.html')), 'health.html is missing.');
try { new Script(moduleToScript(read('shared/js/runtime-diagnostics.js')), { filename: 'shared/js/runtime-diagnostics.js' }); }
catch (error) { failures.push(`runtime-diagnostics syntax: ${error.message}`); }
const runtime = read('shared/js/runtime-diagnostics.js');
const health = read('health.html');
for (const token of ['runRuntimeDiagnostics', 'clearRuntimeCaches', 'testLocalNotification', 'downloadDiagnosticsReport']) assert(runtime.includes(token), `runtime diagnostics missing ${token}.`);
for (const token of ['إعادة الفحص الآن', 'اختبار إشعار محلي', 'تنظيف الكاش', 'runRuntimeDiagnostics']) assert(health.includes(token), `health.html missing ${token}.`);
for (const swFile of ['sw.js', 'sw-admin.js', 'sw-employee.js', 'sw-executive.js']) {
  const body = read(swFile);
  assert(body.includes('runtime-diagnostics.js'), `${swFile} must cache runtime-diagnostics.js.`);
  assert(body.includes('CLEAR_HR_CACHES'), `${swFile} must respond to CLEAR_HR_CACHES.`);
}
if (failures.length) {
  console.error('Runtime diagnostics check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Runtime diagnostics check passed.');
