// run-ebr-env-migration.js — Run from server folder: node run-ebr-env-migration.js
require('dotenv').config();
const pg = require('pg');
const fs = require('fs');
async function run() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();
  console.log('Connected.');
  const sql = fs.readFileSync(__dirname + '/db/migration_ebr_env_records.sql', 'utf8');
  const stmts = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
  for (const s of stmts) {
    try { await c.query(s); const m = s.match(/(\w+)\s*$/); console.log('✓', m ? m[1] : 'OK'); }
    catch (e) { console.log(e.message.includes('already exists') ? '⊘ exists' : '✗ ' + e.message.substring(0, 80)); }
  }
  const r = await c.query('SELECT COUNT(*) as cnt FROM ebr_env_records').catch(() => ({ rows: [{ cnt: 'MISSING' }] }));
  console.log(`\nVerification: ebr_env_records — ${r.rows[0].cnt} rows\nDone.`);
  await c.end();
}
run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
