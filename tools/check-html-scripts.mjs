import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';

const root = process.cwd();
const htmlFiles = [
  'index.html',
  'admin-login.html',
  'operations-gate/index.html',
  'admin/index.html',
  'employee/index.html',
  'executive/index.html',
  'tools/reset-cache.html',
].filter((file) => existsSync(join(root, file)));

const failures = [];
for (const file of htmlFiles) {
  const html = readFileSync(join(root, file), 'utf8');
  const scripts = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  scripts.forEach((match, index) => {
    const code = match[1].trim();
    if (!code) return;
    try {
      new Script(code, { filename: `${file} inline script #${index + 1}` });
    } catch (error) {
      failures.push(`${file} inline script #${index + 1}: ${error.message}`);
    }
  });
}

if (failures.length) {
  console.error('HTML inline script check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('HTML inline script check passed.');
process.exit(0);
