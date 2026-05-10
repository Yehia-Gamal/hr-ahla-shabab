/**
 * Deploy the fix SQL patches to Supabase via Management API.
 * Splits by "FIX N:" markers and sends each chunk separately.
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || '';
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const sqlFile = process.argv[2]
  ? join(__dirname, '..', 'supabase', 'sql', process.argv[2])
  : join(__dirname, '..', 'supabase', 'sql', 'FIX_REMAINING_PATCHES.sql');

const fullSql = readFileSync(sqlFile, 'utf8');
console.log(`📄 File: ${sqlFile} (${(fullSql.length/1024).toFixed(1)} KB)\n`);

// Split into chunks by "FIX N:" markers
const parts = fullSql.split(/(?=-- ={3,}\r?\n-- FIX \d+:)/);
const chunks = parts
  .map(p => p.trim())
  .filter(p => p.length > 10)
  .map((sql, i) => {
    const m = sql.match(/-- FIX (\d+): (.+)/);
    return { label: m ? `FIX ${m[1]}: ${m[2]}` : `chunk-${i+1}`, sql };
  });

console.log(`📦 ${chunks.length} chunks to deploy\n`);

async function run(sql) {
  const r = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`HTTP ${r.status}: ${t.slice(0, 250)}`);
  }
  const data = await r.json();
  if (data?.message && /error/i.test(data.message)) throw new Error(data.message.slice(0, 250));
  return data;
}

let ok = 0, fail = 0;
for (let i = 0; i < chunks.length; i++) {
  const c = chunks[i];
  process.stdout.write(`[${i+1}/${chunks.length}] ${c.label} (${(c.sql.length/1024).toFixed(1)}KB)... `);
  try {
    await run(c.sql);
    console.log('✅');
    ok++;
  } catch (e) {
    if (/duplicate|already exists/i.test(e.message)) {
      console.log(`⚠️ OK (already exists)`);
      ok++;
    } else {
      console.log(`❌ ${e.message.slice(0, 120)}`);
      fail++;
    }
  }
  await new Promise(r => setTimeout(r, 600));
}

console.log(`\n${'='.repeat(50)}`);
console.log(`✅ ${ok}/${chunks.length} succeeded  ❌ ${fail}/${chunks.length} failed`);
if (fail === 0) console.log('\n🎉 All fix patches deployed successfully!');
else process.exit(1);
