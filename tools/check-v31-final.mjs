import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { Script } from 'node:vm';

const root = process.cwd();
const version = 'v47-smart-entry-gateway';
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) failures.push(message); };

function walk(dir, out = []) {
  if (!existsSync(dir)) return out;
  if (statSync(dir).isFile()) { out.push(dir); return out; }
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, item.name);
    if (item.isDirectory()) {
      if (['.git', 'node_modules', 'exports', 'dist', 'dist_public_pages'].includes(item.name)) continue;
      walk(abs, out);
    } else out.push(abs);
  }
  return out;
}

function moduleToScript(source) {
  return source
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+(async\s+function|function|class)\s+/gm, '$1 ')
    .replace(/^\s*export\s+(const|let|var)\s+/gm, '$1 ')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
}

for (const rel of [
  'index.html', 'admin/index.html', 'employee/index.html', 'executive/index.html',
  'sw.js', 'sw-admin.js', 'sw-employee.js', 'sw-executive.js',
  'shared/js/register-sw.js', 'shared/js/api.js', 'shared/js/supabase-api.js',
  'shared/js/app-admin.js', 'shared/js/employee-app.js', 'shared/js/executive-app.js',
]) assert(existsSync(join(root, rel)), `${rel} must exist.`);

for (const file of [
  'shared/js/api.js', 'shared/js/supabase-api.js', 'shared/js/app-admin.js',
  'shared/js/employee-app.js', 'shared/js/executive-app.js', 'shared/js/register-sw.js',
  'sw.js', 'sw-admin.js', 'sw-employee.js', 'sw-executive.js',
].map((rel) => join(root, rel))) {
  try { new Script(moduleToScript(readFileSync(file, 'utf8')), { filename: relative(root, file) }); }
  catch (error) { failures.push(`${relative(root, file)}: ${error.message}`); }
}

for (const file of ['index.html', 'admin/index.html', 'employee/index.html', 'executive/index.html', 'operations-gate/index.html', 'admin-login.html']) {
  const html = read(file);
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const code = match[1].trim();
    if (!code) continue;
    try { new Script(code, { filename: `${file} inline script` }); }
    catch (error) { failures.push(`${file}: ${error.message}`); }
  }
  for (const src of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) {
    const target = src[1].split('?')[0];
    if (/^(https?:|mailto:|tel:|#)/.test(target) || target.startsWith('data:')) continue;
    const resolved = join(root, file.includes('/') ? file.split('/').slice(0, -1).join('/') : '.', target);
    assert(existsSync(resolved), `${file} references missing asset ${target}`);
  }
}

const frontend = ['index.html', 'admin-login.html', 'admin', 'employee', 'executive', 'operations-gate', 'shared', 'sw.js', 'sw-admin.js', 'sw-employee.js', 'sw-executive.js']
  .flatMap((rel) => existsSync(join(root, rel)) ? walk(join(root, rel)) : [])
  .filter((abs) => /\.(html|js|css)$/.test(abs))
  .map((abs) => readFileSync(abs, 'utf8'))
  .join('\n');

assert(!/send-push-notification(?!s)/.test(frontend), 'Frontend must not call deprecated send-push-notification.');
assert(!/employee-register/.test(frontend), 'Frontend must not call deprecated employee-register.');
assert(!/>[\s\n]*(CHECK_IN|CHECK_OUT)[\s\n]*</.test(frontend), 'CHECK_IN/CHECK_OUT must not be visible UI text.');
assert(!/PRODUCTION_SQL_EDITOR_PATCHES_07[789]/.test(read('README.md') + read('docs/PRODUCTION_DEPLOYMENT_GUIDE.md')), 'Final docs must not instruct old 077/078/079 patches.');

const deployPs = read('DEPLOY_SUPABASE_PRODUCTION.ps1');
const deploySh = read('DEPLOY_SUPABASE_PRODUCTION.sh');
for (const fn of ['admin-create-user', 'admin-update-user', 'resolve-login-identifier', 'passkey-register', 'send-attendance-reminders', 'send-push-notifications']) {
  assert(deployPs.includes(fn) && deploySh.includes(fn), `Deploy scripts must publish ${fn}.`);
}
assert(!/send-push-notification(?!s)|employee-register/.test(deployPs + deploySh), 'Deploy scripts must not publish deprecated functions.');
assert(deployPs.includes('WEBAUTHN_ENABLED="false"') && deploySh.includes('WEBAUTHN_ENABLED="false"'), 'WebAuthn must remain disabled by default.');

const sqlDirEntries = readdirSync(join(root, 'supabase/sql')).filter((name) => name !== '_archive');
assert(sqlDirEntries.includes('RUN_IN_SUPABASE_SQL_EDITOR.sql'), 'RUN SQL file must exist.');
assert(sqlDirEntries.includes('VERIFY_AFTER_SUPABASE_DEPLOY.sql'), 'Verify SQL file must exist.');
assert(sqlDirEntries.every((name) => ['RUN_IN_SUPABASE_SQL_EDITOR.sql', 'VERIFY_AFTER_SUPABASE_DEPLOY.sql', 'README_SQL_EDITOR.md'].includes(name)), 'supabase/sql root must only contain final SQL, verify SQL, README, and _archive.');

const finalSql = read('supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
for (const token of ['notifications', 'push_subscriptions', 'live_location_requests', 'live_location_responses', 'safe_create_notification', 'safe_create_notifications_bulk', '084_v31_production_deploy_ready_keep_dev_files']) {
  assert(finalSql.includes(token), `Final SQL must include ${token}.`);
}
assert(!/\b(drop\s+table|truncate\s+table|delete\s+from\s+\w+\s*;)/i.test(finalSql), 'Final SQL must not contain broad destructive SQL.');
assert(read('supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql').includes('check_name') && read('supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql').includes('details'), 'Verify SQL must return check_name/status/details.');

for (const sw of ['sw.js', 'sw-admin.js', 'sw-employee.js', 'sw-executive.js']) {
  const text = read(sw);
  assert(text.includes('hostname.endsWith("supabase.co")') && text.includes('/functions/v1/'), `${sw} must bypass Supabase REST/functions.`);
  assert(text.includes(version), `${sw} must use current v38/v106 cache version.`);
}
assert(!read('sw-employee.js').includes('/admin/') && !read('sw-employee.js').includes('admin/index.html'), 'sw-employee.js must not fallback to admin.');
assert(read('shared/js/register-sw.js').includes('try') && read('shared/js/register-sw.js').includes('catch'), 'register-sw.js must handle registration failures.');
assert(read('shared/js/supabase-api.js').includes('async function core({ force = false } = {})') && read('shared/js/supabase-api.js').includes('sessionStorage.setItem("hr.core"'), 'core() must keep memory/session cache with force option.');
assert(frontend.includes(version), 'Frontend must include current v38/v106 cache-busting version.');
assert(!/\bv2[1456789]\b|v30-final-verified-no-local-errors/.test(frontend), 'Final frontend runtime must not contain old v21/v24/v25/v26/v27/v28/v29/v30 version strings.');

if (failures.length) {
  console.error('current final compatibility check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('current final compatibility check passed.');
