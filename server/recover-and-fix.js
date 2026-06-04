// recover-and-fix.js
// Run from: C:\Users\jaisukh\my-projects\pharma-mbr\server
// Command:  node recover-and-fix.js
//
// This script does NOT delete any data. It only reads and fixes constraints.

require('dotenv').config();
const pg = require('pg');

async function run() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to database.\n');

  // ─── STEP 1: Check if MBR data still exists ───
  console.log('=== STEP 1: Checking MBR data ===');
  const mbrCount = await client.query('SELECT COUNT(*) as cnt FROM mbrs');
  console.log('Total MBRs in database:', mbrCount.rows[0].cnt);

  const mbrList = await client.query('SELECT id, mbr_code, product_name, status FROM mbrs ORDER BY created_at');
  if (mbrList.rows.length > 0) {
    console.log('\nYour MBRs (all safe):');
    mbrList.rows.forEach(r => console.log('  ', r.mbr_code, '|', r.product_name, '|', r.status));
  } else {
    console.log('\n⚠ No MBRs found — this means data was empty BEFORE the script ran, or your seed needs re-running.');
    console.log('  To re-seed: node db/seed-all.js  (or whichever seed file you used originally)');
  }

  // ─── STEP 2: List all unique status values actually in use ───
  console.log('\n=== STEP 2: Status values in use ===');
  const statuses = await client.query('SELECT DISTINCT status FROM mbrs ORDER BY status');
  const inUse = statuses.rows.map(r => r.status);
  console.log('Statuses found:', inUse.length > 0 ? inUse.join(', ') : '(none — table is empty)');

  // ─── STEP 3: Check current constraints ───
  console.log('\n=== STEP 3: Current constraints on mbrs ===');
  const constraints = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) as def 
     FROM pg_constraint 
     WHERE conrelid = 'mbrs'::regclass AND contype = 'c'`
  );
  if (constraints.rows.length === 0) {
    console.log('  No check constraints found (they were dropped).');
  } else {
    constraints.rows.forEach(r => console.log('  ', r.conname, '→', r.def));
  }

  // ─── STEP 4: Build the correct constraint including ALL existing + Ineffective ───
  console.log('\n=== STEP 4: Fixing constraint ===');
  const allStatuses = new Set([
    'Draft', 'In Review', 'Approved', 'Effective', 'Ineffective', 'Superseded', 'Obsolete',
    ...inUse  // include any status already in the data so nothing breaks
  ]);
  const statusList = [...allStatuses].map(s => `'${s}'`).join(',');
  console.log('Allowed statuses:', [...allStatuses].join(', '));

  // Drop existing status constraints (if any remain)
  for (const row of constraints.rows) {
    if (row.def.toLowerCase().includes('status')) {
      await client.query(`ALTER TABLE mbrs DROP CONSTRAINT IF EXISTS "${row.conname}"`);
      console.log('  Dropped old:', row.conname);
    }
  }

  // Also drop by common names in case they exist
  await client.query(`ALTER TABLE mbrs DROP CONSTRAINT IF EXISTS mbrs_status_check`).catch(() => {});

  // Add the correct constraint
  await client.query(`ALTER TABLE mbrs ADD CONSTRAINT mbrs_status_check CHECK (status IN (${statusList}))`);
  console.log('  ✓ Added: mbrs_status_check');

  // ─── STEP 5: Same for master_batch_records ───
  try {
    const c2 = await client.query(
      `SELECT conname, pg_get_constraintdef(oid) as def 
       FROM pg_constraint 
       WHERE conrelid = 'master_batch_records'::regclass AND contype = 'c'`
    );
    for (const row of c2.rows) {
      if (row.def.toLowerCase().includes('status')) {
        await client.query(`ALTER TABLE master_batch_records DROP CONSTRAINT IF EXISTS "${row.conname}"`);
        console.log('  Dropped old (master_batch_records):', row.conname);
      }
    }
    await client.query(`ALTER TABLE master_batch_records DROP CONSTRAINT IF EXISTS master_batch_records_status_check`).catch(() => {});
    await client.query(`ALTER TABLE master_batch_records ADD CONSTRAINT master_batch_records_status_check CHECK (status IN (${statusList}))`);
    console.log('  ✓ Added: master_batch_records_status_check');
  } catch (e) {
    console.log('  master_batch_records: skipped (' + e.message.substring(0, 50) + ')');
  }

  // ─── STEP 6: Final verification ───
  console.log('\n=== FINAL VERIFICATION ===');
  const finalMbrs = await client.query('SELECT COUNT(*) as cnt FROM mbrs');
  console.log('MBRs in database:', finalMbrs.rows[0].cnt);

  const finalConstraints = await client.query(
    `SELECT conname, pg_get_constraintdef(oid) as def 
     FROM pg_constraint 
     WHERE conrelid = 'mbrs'::regclass AND contype = 'c'`
  );
  finalConstraints.rows.forEach(r => console.log('  ', r.conname, '→', r.def));

  const ok = finalConstraints.rows.some(r => r.def.includes('Ineffective'));
  const dataOk = parseInt(finalMbrs.rows[0].cnt) > 0;

  console.log('');
  console.log(dataOk ? '✓ Data intact — all MBRs are safe.' : '⚠ Table is empty — run your seed file to restore demo data.');
  console.log(ok ? '✓ Constraint fixed — Ineffective status is now allowed.' : '✗ Constraint issue — check errors above.');

  await client.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
