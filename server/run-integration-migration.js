// run-integration-migration.js — Run from server folder: node run-integration-migration.js
require('dotenv').config();
const pg = require('pg');
const fs = require('fs');
async function run() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('Connected.\n');
  const sql = fs.readFileSync(__dirname + '/db/migration_integration_platform.sql', 'utf8');
  const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const s of stmts) {
    try { await c.query(s); const m = s.match(/(?:CREATE TABLE|CREATE INDEX).*?(?:IF NOT EXISTS\s+)?(\w+)/i); console.log('✓', m ? m[1] : 'OK'); }
    catch (e) { console.log(e.message.includes('already exists') ? '⊘ exists' : '✗ ' + e.message.substring(0, 80)); }
  }
  console.log('\n=== VERIFICATION ===');
  for (const t of ['integration_connections','integration_queue','integration_field_mappings','integration_log','lims_samples','erp_production_orders','historian_batch_contexts']) {
    const r = await c.query(`SELECT COUNT(*) as cnt FROM ${t}`).catch(() => ({ rows: [{ cnt: 'MISSING' }] }));
    console.log(`  ${t}: ${r.rows[0].cnt} rows`);
  }
  await c.end();
  console.log('\nDone.');
}
run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
