/**
 * Deploy SQL patches to Supabase via the Management API.
 * Splits the SQL bundle by patch boundaries and sends each patch separately.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN || '';
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || '';
if (!PROJECT_REF) {
  console.error('Missing SUPABASE_PROJECT_REF.');
  process.exit(1);
}
const API_URL = `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`;

const sqlFileArg = process.argv[2];
const defaultSqlFile = join(process.cwd(), 'supabase', 'sql', 'PRODUCTION_SQL_EDITOR_ALL_PATCHES_001_TO_043.sql');
const sqlFile = sqlFileArg ? join(process.cwd(), 'supabase', 'sql', sqlFileArg) : defaultSqlFile;
const fullSql = readFileSync(sqlFile, 'utf8');

// Split by patch markers
const patchMarker = /^-- =========================================================\r?\n-- BEGIN PATCH: (.+?)\r?\n-- =========================================================$/gm;
const patches = [];
let lastIndex = 0;
let match;

while ((match = patchMarker.exec(fullSql)) !== null) {
  if (lastIndex > 0) {
    patches.push({ name: patches.length > 0 ? patches[patches.length - 1].name : 'preamble', sql: fullSql.slice(lastIndex, match.index).trim() });
  }
  patches.push({ name: match[1], startIndex: match.index });
  lastIndex = match.index;
}

// Get everything from last patch to end
if (lastIndex > 0) {
  // Remove the last empty entry and rebuild
}

// Alternative approach: split by "BEGIN PATCH" markers
const parts = fullSql.split(/(?=-- =========================================================\r?\n-- BEGIN PATCH:)/);
const sqlParts = [];

for (const part of parts) {
  const nameMatch = part.match(/BEGIN PATCH: (.+)/);
  const name = nameMatch ? nameMatch[1].trim() : 'preamble';
  const sql = part.trim();
  if (sql.length > 0) {
    sqlParts.push({ name, sql });
  }
}

console.log(`Found ${sqlParts.length} SQL patch(es) to deploy.`);

// Further split any patch that's too large (>50KB) into smaller sub-chunks
const MAX_CHUNK = 50000;
const finalChunks = [];

for (const part of sqlParts) {
  if (part.sql.length <= MAX_CHUNK) {
    finalChunks.push(part);
  } else {
    // Split by statement boundaries (double newline + non-comment line) while respecting DO $$ blocks
    const statements = [];
    let current = '';
    let inDollar = false;
    
    for (const line of part.sql.split('\n')) {
      current += line + '\n';
      
      // Track $$ blocks
      const dollarCount = (line.match(/\$\$/g) || []).length;
      if (dollarCount % 2 !== 0) inDollar = !inDollar;
      
      // If we're outside a $$ block and line ends with ;, check if we should split
      if (!inDollar && line.trim().endsWith(';') && current.length > 1000) {
        statements.push(current);
        current = '';
      }
    }
    if (current.trim()) statements.push(current);
    
    // Group statements into chunks under MAX_CHUNK
    let chunk = '';
    let chunkNum = 1;
    for (const stmt of statements) {
      if (chunk.length + stmt.length > MAX_CHUNK && chunk.length > 0) {
        finalChunks.push({ name: `${part.name} [part ${chunkNum}]`, sql: chunk });
        chunkNum++;
        chunk = '';
      }
      chunk += stmt;
    }
    if (chunk.trim()) {
      finalChunks.push({ name: `${part.name} [part ${chunkNum}]`, sql: chunk });
    }
  }
}

console.log(`Split into ${finalChunks.length} chunk(s) for deployment.\n`);

async function executeSQL(sql, name) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`HTTP ${response.status}: ${errorText}`);
  }
  
  return await response.json();
}

let successCount = 0;
let failCount = 0;

for (let i = 0; i < finalChunks.length; i++) {
  const chunk = finalChunks[i];
  const progress = `[${i + 1}/${finalChunks.length}]`;
  process.stdout.write(`${progress} Deploying: ${chunk.name} (${chunk.sql.length} chars)... `);
  
  try {
    await executeSQL(chunk.sql, chunk.name);
    console.log('✓ OK');
    successCount++;
  } catch (error) {
    console.log(`✗ FAILED: ${error.message.slice(0, 200)}`);
    failCount++;
    // Continue with next patch
  }
  
  // Small delay to avoid rate limiting
  await new Promise(r => setTimeout(r, 500));
}

console.log(`\n=== Deployment Summary ===`);
console.log(`Success: ${successCount}/${finalChunks.length}`);
console.log(`Failed: ${failCount}/${finalChunks.length}`);

if (failCount === 0) {
  console.log('\n✅ All SQL patches deployed successfully!');
} else {
  console.log('\n⚠️ Some patches failed. Check the output above for details.');
  process.exit(1);
}
