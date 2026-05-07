import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';

const root = process.cwd();
const files = [
  'shared/js/api.js',
  'shared/js/app-admin.js',
  'shared/js/employee-app.js',
  'shared/js/executive-app.js',
  'shared/js/supabase-api.js',
  'shared/js/register-sw.js',
  'sw.js',
  'sw-admin.js',
  'sw-employee.js',
  'sw-executive.js',
  'shared/js/v9-hardening.js',
  'shared/js/v10-private-deploy-fixes.js',
];

function moduleToScriptForSyntaxCheck(source) {
  return source
    // Remove static imports; URL query strings in imports are valid in browser modules but not useful for this syntax check.
    .replace(/^\s*import\s+[^;]+;\s*$/gm, '')
    // Convert common export declarations to normal declarations so vm.Script can parse the body.
    .replace(/^\s*export\s+default\s+/gm, '')
    .replace(/^\s*export\s+(async\s+function|function|class)\s+/gm, '$1 ')
    .replace(/^\s*export\s+(const|let|var)\s+/gm, '$1 ')
    .replace(/^\s*export\s*\{[^}]*\};?\s*$/gm, '');
}

const failures = [];
for (const file of files) {
  const full = join(root, file);
  if (!existsSync(full)) {
    failures.push(`${file}: missing file`);
    continue;
  }
  try {
    new Script(moduleToScriptForSyntaxCheck(readFileSync(full, 'utf8')), { filename: file });
  } catch (error) {
    failures.push(`${file}: ${error.message}`);
  }
}

if (failures.length) {
  console.error('JS syntax check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('JS syntax check passed.');
process.exit(0);
