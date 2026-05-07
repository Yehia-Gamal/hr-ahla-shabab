import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const requiredFiles = [
  'shared/css/neon-admin-theme.css',
  'shared/css/v10-private-deploy-theme.css',
  'docs/NEON_COMMAND_CENTER_THEME_V3_GUIDE.md',
  'docs/theme-preview/index.html',
];

const requiredPages = [
  'index.html',
  'employee/index.html',
  'admin/index.html',
  'executive/index.html',
  'operations-gate/index.html',
  'admin-login.html',
];

const requiredSW = ['sw.js', 'sw-employee.js', 'sw-admin.js', 'sw-executive.js'];
const failures = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing required theme file: ${file}`);
}

for (const page of requiredPages) {
  const html = read(page);
  if (!html.includes('neon-admin-theme.css')) failures.push(`Page does not load neon theme: ${page}`);
  if (!html.includes('v10-private-deploy-theme.css')) failures.push(`Page does not load unified V10 theme: ${page}`);
}

for (const sw of requiredSW) {
  const js = read(sw);
  if (!js.includes('./shared/css/neon-admin-theme.css') && !js.includes('shared/css/neon-admin-theme.css')) {
    failures.push(`Service worker does not cache neon theme: ${sw}`);
  }
  if (!js.includes('./shared/css/v10-private-deploy-theme.css') && !js.includes('shared/css/v10-private-deploy-theme.css')) {
    failures.push(`Service worker does not cache unified V10 theme: ${sw}`);
  }
}

const css = read('shared/css/neon-admin-theme.css');
for (const needle of ['--neon-focus', 'prefers-reduced-motion', 'risk-high', 'touch-action: manipulation', 'neon-command-center']) {
  if (!css.includes(needle)) failures.push(`Theme CSS missing: ${needle}`);
}
const unifiedCss = read('shared/css/v10-private-deploy-theme.css');
for (const needle of ['#050A1A', '#0B1628', '#1A6EFF', '#00C2FF', '#FF3B6B', 'Unified Ahla Shabab HR command theme']) {
  if (!unifiedCss.includes(needle)) failures.push(`Unified theme CSS missing: ${needle}`);
}

if (failures.length) {
  failures.forEach((failure) => console.error('❌', failure));
  process.exit(1);
}
console.log('✅ Neon Command Center Theme V3 check passed.');
