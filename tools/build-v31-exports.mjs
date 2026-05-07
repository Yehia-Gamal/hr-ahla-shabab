import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const exportsDir = join(root, 'exports');
const devDir = join(exportsDir, 'hr_ahla_shabab_v31_development_full_production_deploy_ready_keep_dev_files');
const publicDir = join(exportsDir, 'hr_ahla_shabab_v31_public_pages_upload');
const devZip = join(exportsDir, 'hr_ahla_shabab_v31_development_full_production_deploy_ready_keep_dev_files.zip');
const publicZip = join(exportsDir, 'hr_ahla_shabab_v31_public_pages_upload.zip');

rmSync(exportsDir, { recursive: true, force: true });
mkdirSync(devDir, { recursive: true });
mkdirSync(publicDir, { recursive: true });

const devExclude = new Set(['exports', 'node_modules']);
for (const rel of [
  '.env', '.git', '.github', '.vscode', 'admin', 'docs', 'employee', 'executive',
  'operations-gate', 'shared', 'supabase', 'tools', '_archive',
  'index.html', 'admin-login.html', 'health.html', 'package.json', 'package-lock.json',
  'README.md', 'run-patches.mjs', 'DEPLOY_SUPABASE_PRODUCTION.ps1',
  'DEPLOY_SUPABASE_PRODUCTION.sh', 'RUN_LOCAL_CHECKS.ps1', 'RUN_LOCAL_CHECKS.sh',
  'sw.js', 'sw-admin.js', 'sw-employee.js', 'sw-executive.js', 'vercel.json', '_headers',
]) {
  if (devExclude.has(rel) || !existsSync(join(root, rel))) continue;
  cpSync(join(root, rel), join(devDir, rel), { recursive: true, verbatimSymlinks: true });
}

for (const rel of [
  'index.html', 'admin-login.html', 'health.html', 'admin', 'employee', 'executive',
  'operations-gate', 'shared', 'sw.js', 'sw-admin.js', 'sw-employee.js',
  'sw-executive.js', '_headers',
]) {
  if (existsSync(join(root, rel))) cpSync(join(root, rel), join(publicDir, rel), { recursive: true, verbatimSymlinks: true });
}

writeFileSync(join(publicDir, 'PUBLIC_UPLOAD_README.txt'), [
  'GitHub Pages upload package for v31.',
  'Does not contain .env, .git, supabase/.temp, supabase/functions, supabase/sql, node_modules, or _archive.',
  'Apply supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql and deploy Supabase Functions from the development package before publishing.',
  '',
].join('\n'), 'utf8');

function compress(sourceDir, zipPath) {
  rmSync(zipPath, { force: true });
  const ps = [
    '$ErrorActionPreference = "Stop"',
    `$items = Get-ChildItem -LiteralPath '${sourceDir.replace(/'/g, "''")}' -Force`,
    `Compress-Archive -LiteralPath $items.FullName -DestinationPath '${zipPath.replace(/'/g, "''")}' -Force`,
  ].join('; ');
  execFileSync('powershell', ['-NoProfile', '-Command', ps], { stdio: 'inherit' });
}

compress(devDir, devZip);
compress(publicDir, publicZip);

console.log(`Created ${devZip}`);
console.log(`Created ${publicZip}`);
