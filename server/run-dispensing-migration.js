// run-dispensing-migration.js — Run from server folder: node run-dispensing-migration.js
require('dotenv').config();
const pg = require('pg');
const fs = require('fs');

async function run() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected.\n');

  const sql = fs.readFileSync(__dirname + '/db/migration_dispensing.sql', 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

  for (const stmt of statements) {
    try {
      await client.query(stmt);
      const name = stmt.match(/(?:CREATE TABLE|CREATE INDEX).*?(\w+)/i)?.[1] || 'OK';
      console.log(`✓ ${name}`);
    } catch (e) {
      if (e.message.includes('already exists')) console.log(`⊘ Already exists`);
      else console.error(`✗ ${e.message.substring(0, 80)}`);
    }
  }

  // Verify
  console.log('\n=== VERIFICATION ===');
  for (const table of ['dispensing_orders', 'dispensing_records']) {
    const r = await client.query(`SELECT COUNT(*) as cnt FROM ${table}`).catch(() => ({ rows: [{ cnt: 'MISSING' }] }));
    console.log(`  ${table}: ${r.rows[0].cnt} rows`);
  }

  await client.end();
  console.log('\nDone.');
}
run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
