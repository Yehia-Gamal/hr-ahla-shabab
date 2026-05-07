import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];
const textFiles = [];
const developmentOnly = ['.env', '.env.local', '.env.production', '.git', 'node_modules'];
const actualSecretPatterns = [
  /SUPABASE_SERVICE_ROLE_KEY\s*=\s*eyJ[A-Za-z0-9_.-]{40,}/i,
  /SUPABASE_ACCESS_TOKEN\s*=\s*sbp_[A-Za-z0-9_.-]{20,}/i,
  /GITHUB_TOKEN\s*=\s*gh[pousr]_[A-Za-z0-9_]{20,}/i,
  /DB_PASSWORD\s*=\s*(?!CHANGE_ME|your_|<|\$\{|\s*$)[^\r\n\s#]{8,}/i,
  /VAPID_PRIVATE_KEY\s*=\s*(?!CHANGE_ME|your_|<|\$\{|\s*$)[^\r\n\s#]{20,}/i,
];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = relative(root, abs).replaceAll('\\\\', '/');
    if (rel.startsWith('node_modules/') || rel.startsWith('.git/')) continue;
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs);
    else if (/\.(js|mjs|html|json|md|toml|sql|txt|example|sh|ps1|yml|yaml|css)$/i.test(name) || name === '_headers' || name.startsWith('.env')) textFiles.push(rel);
  }
}

for (const rel of developmentOnly) {
  if (existsSync(join(root, rel))) warnings.push(`${rel} exists in the developer tree; it must be excluded from release ZIPs.`);
}
walk(root);
for (const rel of textFiles) {
  if (rel.startsWith('.env')) continue;
  const body = readFileSync(join(root, rel), 'utf8');
  for (const pattern of actualSecretPatterns) {
    if (pattern.test(body)) failures.push(`${rel}: contains a real-looking secret matching ${pattern}`);
  }
}
const config = readFileSync(join(root, 'shared/js/supabase-config.js'), 'utf8');
if (/code\s*:\s*["']00000000["']/.test(config) || /accessCode\s*:\s*["']00000000["']/.test(config)) failures.push('shared/js/supabase-config.js still contains insecure 00000000 gateway code.');
if (!config.includes('codeSha256')) failures.push('Gateway must use codeSha256, not plain default access codes.');
const headers = readFileSync(join(root, '_headers'), 'utf8');
const vercel = readFileSync(join(root, 'vercel.json'), 'utf8');
if (!headers.includes('https://esm.sh') || !vercel.includes('https://esm.sh')) failures.push('CSP must allow https://esm.sh for the Supabase runtime import.');
// Persian/Farsi digits (۰-۹) are legitimately used in phone normalization across
// api.js, app-admin.js, employee-app.js, executive-app.js, supabase-api.js,
// operations-gate, and Edge Functions. Only flag if found in unexpected files.
const phoneNormFiles = new Set([
  'shared/js/api.js', 'shared/js/app-admin.js', 'shared/js/employee-app.js',
  'shared/js/executive-app.js', 'shared/js/supabase-api.js',
  'operations-gate/index.html',
  'supabase/functions/resolve-login-identifier/index.ts',
  'supabase/functions/admin-create-user/index.ts',
  'supabase/functions/admin-update-user/index.ts',
  'supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql',
  'tools/issue-supabase-passwords.mjs',
]);
const nonNormFiles = textFiles.filter((f) => {
  const norm = f.replace(/\\/g, '/');
  return norm !== 'tools/check-release-security.mjs' && !phoneNormFiles.has(norm) && !norm.startsWith('_archive') && !norm.includes('_archive/');
});
const combinedNonNorm = nonNormFiles.map((f) => readFileSync(join(root, f), 'utf8')).join('\n');
if (/Û°|Û±|Û²|Û³|Û´|Ûµ|Û¶|Û·|Û¸|Û¹/.test(combinedNonNorm)) failures.push('Mojibake Persian digit characters still found outside the security checker and phone normalization.');

for (const message of warnings) console.warn(`WARNING: ${message}`);
if (failures.length) {
  console.error('Release security check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Release security check passed.');
