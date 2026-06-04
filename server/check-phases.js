// check-phases.js — Run from server folder: node check-phases.js
// Checks if Co-Designer proposals actually created phases in the DB
require('dotenv').config();
const pg = require('pg');

async function run() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  // Find the MBR you're working on (the copy one)
  const mbrs = await client.query("SELECT id, mbr_code, product_name FROM mbrs WHERE product_name LIKE '%Copy%' OR product_name LIKE '%Omeprazole%' ORDER BY created_at DESC LIMIT 5");
  console.log('\n=== MBRs ===');
  mbrs.rows.forEach(m => console.log(`  ${m.mbr_code} | ${m.product_name} | ID: ${m.id}`));

  for (const mbr of mbrs.rows) {
    const phases = await client.query('SELECT id, phase_number, phase_name FROM mbr_phases WHERE mbr_id=$1 ORDER BY phase_number', [mbr.id]);
    console.log(`\n=== Phases for ${mbr.mbr_code} (${phases.rows.length}) ===`);
    phases.rows.forEach(p => console.log(`  ${p.phase_number}. ${p.phase_name} | ID: ${p.id}`));

    const steps = await client.query('SELECT id, step_number, step_name, phase_id FROM mbr_steps WHERE mbr_id=$1 ORDER BY step_number', [mbr.id]);
    console.log(`  Steps: ${steps.rows.length}`);
    steps.rows.forEach(s => console.log(`    ${s.step_number}. ${s.step_name}`));
  }

  // Check proposals
  const proposals = await client.query("SELECT id, proposal_type, status, reasoning FROM co_designer_proposals ORDER BY created_at DESC LIMIT 10");
  console.log('\n=== Recent Proposals ===');
  proposals.rows.forEach(p => console.log(`  [${p.status}] ${p.proposal_type}: ${p.reasoning?.substring(0, 80)}`));

  await client.end();
}

run().catch(e => { console.error(e.message); process.exit(1); });
