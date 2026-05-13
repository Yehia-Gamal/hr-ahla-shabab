import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];
const assert = (condition, message) => { if (!condition) failures.push(message); };
const forbiddenNames = new Set(['.env', '.env.local', '.env.production']);
const ignoredTraversalNames = new Set(['.git', 'node_modules', 'dist_public_pages']);
const requiredFiles = ['index.html', 'employee/index.html', 'admin/index.html', 'executive/index.html', 'operations-gate/index.html', 'health.html', 'shared/js/runtime-diagnostics.js', '_headers', 'vercel.json'];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (ignoredTraversalNames.has(name)) continue;
    const abs = join(dir, name);
    const rel = relative(root, abs).replaceAll('\\', '/');
    if (forbiddenNames.has(name)) failures.push(`Forbidden release item exists: ${rel}`);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs);
  }
}
walk(root);
for (const file of requiredFiles) assert(existsSync(join(root, file)), `Required file missing: ${file}`);
const config = readFileSync(join(root, 'shared/js/supabase-config.js'), 'utf8');
assert(config.includes('packageVersion: "v47-smart-entry-gateway"'), 'Config packageVersion must be v38/v106.');
assert(config.includes('cacheVersion: "v47-smart-entry-gateway"'), 'Config cacheVersion must be v38/v106.');
assert(config.includes('expectedPatch: "104_royal_blue_full_migration"'), 'Config expectedPatch must be 104_royal_blue_full_migration.');
const verifySql = readFileSync(join(root, 'supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql'), 'utf8');
assert(verifySql.includes('098_location_security_edge_hardening') && verifySql.includes('104_royal_blue_full_migration'), 'Supabase verify SQL must check 098 and 104_royal_blue_full_migration.');
assert(existsSync(join(root, 'shared/css/v106-mobile-stability.css')), 'v106 CSS missing.');
assert(existsSync(join(root, 'shared/js/v106-mobile-stability.js')), 'v106 JS missing.');
const swText = readFileSync(join(root, 'sw.js'), 'utf8');
assert(swText.includes('shared/css/v106-mobile-stability.css') && swText.includes('shared/js/v106-mobile-stability.js'), 'Main SW must precache v106 assets.');
const headers = readFileSync(join(root, '_headers'), 'utf8');
const vercel = readFileSync(join(root, 'vercel.json'), 'utf8');
assert(headers.includes("connect-src") && headers.includes('https://*.supabase.co') && headers.includes('https://esm.sh'), '_headers CSP must allow Supabase and esm.sh.');
assert(vercel.includes('https://*.supabase.co') && vercel.includes('https://esm.sh'), 'vercel.json CSP must allow Supabase and esm.sh.');
if (warnings.length) for (const warning of warnings) console.warn(`WARNING: ${warning}`);
if (failures.length) {
  console.error('Release artifact check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Release artifact check passed.');
