/**
 * Deploy the full consolidated SQL to Supabase via Management API.
 * Splits by SECTION/PATCH markers and sends each chunk separately.
 * Handles large files by further splitting oversized chunks.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || '';

if (!ACCESS_TOKEN || !PROJECT_REF) {
  console.error('❌ Missing SUPABASE_ACCESS_TOKEN or SUPABASE_PROJECT_REF');
  process.exit(1);
}

const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;
const sqlFile = join(__dirname, '..', 'supabase', 'sql', 'RUN_IN_SUPABASE_SQL_EDITOR.sql');
const fullSql = readFileSync(sqlFile, 'utf8');

console.log(`📄 SQL file: ${sqlFile}`);
console.log(`📏 Total size: ${(fullSql.length / 1024).toFixed(1)} KB`);

// Split by SECTION or PATCH boundaries
const splitPattern = /^-- ={3,}\r?\n-- (?:BEGIN (?:SECTION|PATCH)|END (?:SECTION|PATCH)): .+?\r?\n-- ={3,}$/gm;

const sections = [];
let lastIdx = 0;
let lastLabel = 'preamble';
let match;

// Find all boundaries
const boundaries = [];
const re = /^-- ={3,}\r?\n-- BEGIN (?:SECTION|PATCH): (.+?)\r?\n-- ={3,}$/gm;
while ((match = re.exec(fullSql)) !== null) {
  boundaries.push({ label: match[1].trim(), index: match.index });
}

// Build section list
for (let i = 0; i < boundaries.length; i++) {
  const start = i === 0 ? 0 : boundaries[i].index;
  const end = i + 1 < boundaries.length ? boundaries[i + 1].index : fullSql.length;
  const sql = fullSql.slice(start, end).trim();
  if (sql.length > 0) {
    sections.push({ label: boundaries[i].label, sql });
  }
}

// If no boundaries found, treat entire file as one section
if (sections.length === 0) {
  sections.push({ label: 'full-file', sql: fullSql.trim() });
}

console.log(`🔀 Found ${sections.length} sections\n`);

// Further split sections larger than 48KB
const MAX_CHUNK = 48000;
const chunks = [];

for (const section of sections) {
  if (section.sql.length <= MAX_CHUNK) {
    chunks.push(section);
    continue;
  }

  // Split by statement boundaries respecting $$ blocks
  const lines = section.sql.split('\n');
  let current = '';
  let inDollar = false;
  const stmts = [];

  for (const line of lines) {
    current += line + '\n';
    const dCount = (line.match(/\$\$/g) || []).length;
    if (dCount % 2 !== 0) inDollar = !inDollar;

    if (!inDollar && line.trim().endsWith(';') && current.length > 500) {
      stmts.push(current);
      current = '';
    }
  }
  if (current.trim()) stmts.push(current);

  // Group statements into sub-chunks
  let chunk = '';
  let partNum = 1;
  for (const stmt of stmts) {
    if (chunk.length + stmt.length > MAX_CHUNK && chunk.length > 0) {
      chunks.push({ label: `${section.label} [part ${partNum}]`, sql: chunk });
      partNum++;
      chunk = '';
    }
    chunk += stmt;
  }
  if (chunk.trim()) {
    chunks.push({ label: `${section.label} [part ${partNum}]`, sql: chunk });
  }
}

console.log(`📦 Split into ${chunks.length} deployable chunks\n`);

// Deploy each chunk
async function executeSQL(sql) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  }

  // Check for SQL errors in the response
  let data;
  try { data = JSON.parse(text); } catch { return text; }
  if (data && data.message && /error|ERROR/.test(data.message)) {
    throw new Error(data.message.slice(0, 300));
  }
  return data;
}

let ok = 0;
let fail = 0;
const errors = [];

for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];
  const pct = ((i + 1) / chunks.length * 100).toFixed(0);
  process.stdout.write(`[${i + 1}/${chunks.length}] (${pct}%) ${c.label} (${(c.sql.length / 1024).toFixed(1)}KB)... `);

  try {
    await executeSQL(c.sql);
    console.log('✅');
    ok++;
  } catch (err) {
    const msg = err.message || String(err);
    // Some errors are acceptable (duplicate object, already exists)
    if (/duplicate|already exists|does not exist.*policy/i.test(msg)) {
      console.log(`⚠️ (acceptable: ${msg.slice(0, 80)})`);
      ok++;
    } else {
      console.log(`❌ ${msg.slice(0, 150)}`);
      fail++;
      errors.push({ label: c.label, error: msg.slice(0, 200) });
    }
  }

  // Rate limit delay
  await new Promise(r => setTimeout(r, 800));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`✅ Success: ${ok}/${chunks.length}`);
console.log(`❌ Failed:  ${fail}/${chunks.length}`);

if (errors.length > 0) {
  console.log('\n--- Errors ---');
  for (const e of errors) {
    console.log(`  • ${e.label}: ${e.error}`);
  }
}

if (fail === 0) {
  console.log('\n🎉 All SQL deployed successfully to Supabase!');
} else {
  console.log('\n⚠️ Some chunks failed. Review errors above.');
  process.exit(1);
}
