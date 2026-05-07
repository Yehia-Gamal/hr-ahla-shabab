import { readFileSync } from 'node:fs';
import pkg from 'pg';
const { Client } = pkg;

const connectionString = process.env.SUPABASE_DB_URL;
if (!connectionString) {
  console.error('Set SUPABASE_DB_URL first. Example: SUPABASE_DB_URL="<your-supabase-postgres-connection-string>" node run-patches.mjs');
  process.exit(1);
}

const patches = [
  'supabase/sql/patches/035_final_sanitization_live_readiness.sql',
  'supabase/sql/patches/036_role_kpi_workflow_access.sql',
  'supabase/sql/patches/037_kpi_policy_window_hr_scoring.sql',
  'supabase/sql/patches/038_kpi_cycle_control_reports.sql',
  'supabase/sql/patches/039_management_hr_reports_workflow.sql',
  'supabase/sql/patches/040_runtime_alignment_fix.sql',
];

const client = new Client({ connectionString, ssl: process.env.SUPABASE_DB_SSL === 'false' ? false : { rejectUnauthorized: false } });
try {
  await client.connect();
  for (const patch of patches) {
    console.log(`Executing ${patch}...`);
    await client.query(readFileSync(patch, 'utf8'));
    console.log(`OK ${patch}`);
  }
  console.log('All patches executed successfully.');
} finally {
  await client.end().catch(() => null);
}
