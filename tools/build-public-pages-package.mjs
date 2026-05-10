import { mkdirSync, rmSync, cpSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const out = join(root, 'dist_public_pages');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const include = [
  'index.html',
  'admin-login.html',
  'health.html',
  'admin',
  'employee',
  'executive',
  'operations-gate',
  'shared',
  'sw.js',
  'sw-admin.js',
  'sw-employee.js',
  'sw-executive.js',
  '_headers',
  'vercel.json',
];
for (const rel of include) {
  const src = join(root, rel);
  if (existsSync(src)) cpSync(src, join(out, rel), { recursive: true });
}
writeFileSync(join(out, 'PUBLIC_UPLOAD_README.txt'), `هذه حزمة رفع GitHub Pages فقط.\nلا تحتوي على .env أو .git أو supabase/.temp.\nارفع محتويات هذا المجلد إلى GitHub Pages بعد تشغيل RUN_IN_SUPABASE_SQL_EDITOR.sql الذي أصبح يضم v104/v106/v107 UI stability SQL Merge، ثم تشغيل VERIFY_AFTER_SUPABASE_DEPLOY.sql ونشر Supabase Functions.\n`, 'utf8');
try {
  execFileSync('zip', ['-qr', join(root, 'HR_AHLA_SHABAB_PUBLIC_UPLOAD_107_CLEAN_UI.zip'), '.'], { cwd: out, stdio: 'inherit' });
  console.log('Public package created: HR_AHLA_SHABAB_PUBLIC_UPLOAD_107_CLEAN_UI.zip');
} catch (error) {
  try {
    execFileSync('powershell', [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${join(out, '*').replaceAll("'", "''")}' -DestinationPath '${join(root, 'HR_AHLA_SHABAB_PUBLIC_UPLOAD_107_CLEAN_UI.zip').replaceAll("'", "''")}' -Force`,
    ], { stdio: 'inherit' });
    console.log('Public package created: HR_AHLA_SHABAB_PUBLIC_UPLOAD_107_CLEAN_UI.zip');
  } catch {
    console.warn('zip command unavailable; dist_public_pages folder is ready.');
  }
}
