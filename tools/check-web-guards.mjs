import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const failures = [];
const read = (file) => readFileSync(join(root, file), 'utf8');

for (const file of ['operations-gate/index.html', 'admin/index.html', 'executive/index.html']) {
  if (!existsSync(join(root, file))) failures.push(`Missing guarded page: ${file}`);
}

if (!failures.length) {
  const gate = read('operations-gate/index.html');
  const admin = read('admin/index.html');
  const executive = read('executive/index.html');
  if (!gate.includes('hr.opsGatewayUnlockedTarget')) failures.push('Operations gate must store a scoped unlocked target.');
  if (!admin.includes("unlockedTarget === 'admin'")) failures.push('Admin page must require an admin-scoped gate unlock.');
  if (!executive.includes("unlockedTarget === 'executive'")) failures.push('Executive page must require an executive-scoped gate unlock.');
}

for (const file of ['shared/js/employee-app.js', 'shared/js/executive-app.js']) {
  const text = read(file);
  if (/\b(prompt|confirm)\s*\(/.test(text)) failures.push(`${file} must use mobile modal dialogs instead of native prompt/confirm.`);
}

const api = read('shared/js/api.js');
if (/isTechnicalAdmin[\s\S]{0,240}(emp-yahia|yahia|yehia|يحيى|يحيي|جمال السبع)/.test(api)) {
  failures.push('Technical admin access must not be granted by a personal name, email, or employee id.');
}

if (failures.length) {
  console.error('Web guard check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Web guard check passed: scoped gate, mobile dialogs, and technical admin rules are OK.');
process.exit(0);
