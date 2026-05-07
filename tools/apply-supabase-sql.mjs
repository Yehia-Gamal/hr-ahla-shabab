import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pkg from 'pg';
const { Client } = pkg;

const projectRef = process.env.SUPABASE_PROJECT_REF;
const password = process.env.SUPABASE_DB_PASSWORD;
const connectionString = process.env.SUPABASE_DB_URL;

if (!connectionString && (!projectRef || !password)) {
  console.error('Missing SUPABASE_DB_URL or both SUPABASE_PROJECT_REF and SUPABASE_DB_PASSWORD.');
  process.exit(1);
}

const root = process.cwd();
const sqlFile = join(root, 'supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql');
const verifyFile = join(root, 'supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql');

const client = new Client(connectionString ? {
  connectionString,
  ssl: process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
} : {
  host: process.env.SUPABASE_DB_HOST || `db.${projectRef}.supabase.co`,
  port: Number(process.env.SUPABASE_DB_PORT || 5432),
  database: process.env.SUPABASE_DB_NAME || 'postgres',
  user: process.env.SUPABASE_DB_USER || 'postgres',
  password,
  ssl: process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 30000,
});

try {
  await client.connect();
  if (process.env.VERIFY_ONLY !== '1') {
    console.log('Applying supabase/sql/RUN_IN_SUPABASE_SQL_EDITOR.sql ...');
    await client.query(readFileSync(sqlFile, 'utf8'));
    console.log('SQL apply OK');
  }
  console.log('Running supabase/sql/VERIFY_AFTER_SUPABASE_DEPLOY.sql ...');
  const result = await client.query(readFileSync(verifyFile, 'utf8'));
  console.log('Verify OK');
  if (result?.rows?.length) console.table(result.rows);
} finally {
  await client.end().catch(() => null);
}
