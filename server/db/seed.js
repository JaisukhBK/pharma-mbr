// server/db/seed.js
// PharmaMES.AI — Database Seeder
// Run: node db/seed.js
// Idempotent — safe to re-run. Uses ON CONFLICT to upsert.

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const bcrypt = require('bcrypt');
const { query, runMigrations } = require('./pool');

const DEMO_PASSWORD = 'pharma123';
const BCRYPT_ROUNDS = 10;

const USERS = [
  {
    id:          'a1000001-0000-0000-0000-000000000001',
    email:       'jaisukh.patel@pharmambr.com',
    username:    'jaisukh.patel',
    full_name:   'Jaisukh Patel',
    title:       'System Administrator',
    group_id:    'admin',
    training_status: 'Current',
  },
  {
    id:          'a1000002-0000-0000-0000-000000000002',
    email:       'priya.singh@pharmambr.com',
    username:    'priya.singh',
    full_name:   'Priya Singh',
    title:       'QA Reviewer',
    group_id:    'qa_reviewer',
    training_status: 'Current',
  },
  {
    id:          'a1000003-0000-0000-0000-000000000003',
    email:       'raj.kumar@pharmambr.com',
    username:    'raj.kumar',
    full_name:   'Raj Kumar',
    title:       'Production Operator',
    group_id:    'production_operator',
    training_status: 'Current',
  },
  {
    id:          'a1000005-0000-0000-0000-000000000005',
    email:       'carlos.martinez@pharmambr.com',
    username:    'carlos.martinez',
    full_name:   'Carlos Martinez',
    title:       'Production Supervisor',
    group_id:    'designer',
    training_status: 'Current',
  },
  {
    id:          'a1000004-0000-0000-0000-000000000004',
    email:       'wei.chen@pharmambr.com',
    username:    'wei.chen',
    full_name:   'Wei Chen',
    title:       'Systems Engineer',
    group_id:    'designer',
    training_status: 'Current',
  },
];

const MBR_ID  = 'b1000001-0000-0000-0000-000000000001';
const ADMIN_ID = USERS[0].id;

const PH = {
  dispensing:  'c1000001-0000-0000-0000-000000000001',
  granulation: 'c1000002-0000-0000-0000-000000000002',
  blending:    'c1000003-0000-0000-0000-000000000003',
  compression: 'c1000004-0000-0000-0000-000000000004',
  coating:     'c1000005-0000-0000-0000-000000000005',
  packaging:   'c1000006-0000-0000-0000-000000000006',
};

const ST = {
  lineClear:  'd1000001-0000-0000-0000-000000000001',
  apiDisp:    'd1000002-0000-0000-0000-000000000002',
  excDisp:    'd1000003-0000-0000-0000-000000000003',
  dryMix:     'd1000004-0000-0000-0000-000000000004',
  wetMass:    'd1000005-0000-0000-0000-000000000005',
  drying:     'd1000006-0000-0000-0000-000000000006',
  sizing:     'd1000007-0000-0000-0000-000000000007',
  pressSetup: 'd1000008-0000-0000-0000-000000000008',
  compRun:    'd1000009-0000-0000-0000-000000000009',
};

async function seed() {
  console.log('\n  PharmaMES.AI — Database Seed');
  console.log('  ================================\n');

  await runMigrations();

  const hash   = await bcrypt.hash(DEMO_PASSWORD, BCRYPT_ROUNDS);
  const expiry = new Date(Date.now() + 90 * 86400000).toISOString();

  // ── Users ──────────────────────────────────────────────────────────────────
  console.log('  -> Seeding users...');
  for (const u of USERS) {
    await query(
      `INSERT INTO users
         (id, email, username, password_hash, full_name, title, group_id,
          status, must_change_password, training_status, password_expires_at, failed_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'Active',false,$8,$9,0)
       ON CONFLICT (id) DO UPDATE SET
         email           = EXCLUDED.email,
         username        = EXCLUDED.username,
         password_hash   = EXCLUDED.password_hash,
         full_name       = EXCLUDED.full_name,
         title           = EXCLUDED.title,
         group_id        = EXCLUDED.group_id,
         training_status = EXCLUDED.training_status,
         updated_at      = NOW()`,
      [u.id, u.email, u.username, hash, u.full_name, u.title,
       u.group_id, u.training_status, expiry]
    );
    console.log('     + ' + u.full_name + ' [' + u.group_id + ']');
  }

  // ── MBR ────────────────────────────────────────────────────────────────────
  console.log('\n  -> Seeding Metformin 500mg MBR...');
  await query(
    `INSERT INTO master_batch_records
       (id, mbr_code, product_name, product_code, dosage_form,
        batch_size, batch_size_unit, description, status, current_version, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO NOTHING`,
    [MBR_ID, 'MBR-MET-500-001', 'Metformin HCl 500mg Tablets',
     'PROD-MET-500', 'Tablet', 200000, 'tablets',
     'Master Batch Record for Metformin HCl 500mg film-coated tablets. Wet granulation.',
     'Draft', 1, ADMIN_ID]
  );

  // ── Phases ─────────────────────────────────────────────────────────────────
  const phases = [
    [PH.dispensing,  1, 'Dispensing',  'Weigh and dispense all raw materials per BOM'],
    [PH.granulation, 2, 'Granulation', 'Wet granulation using high-shear granulator'],
    [PH.blending,    3, 'Blending',    'Blend granules with extragranular excipients'],
    [PH.compression, 4, 'Compression', 'Compress blend into tablets using rotary press'],
    [PH.coating,     5, 'Coating',     'Film coat tablets in perforated coating pan'],
    [PH.packaging,   6, 'Packaging',   'Primary and secondary packaging'],
  ];
  for (const [id, num, name, desc] of phases) {
    await query(
      `INSERT INTO mbr_phases (id,mbr_id,phase_number,phase_name,description,sort_order)
       VALUES ($1,$2,$3,$4,$5,$3) ON CONFLICT (id) DO NOTHING`,
      [id, MBR_ID, num, name, desc]
    );
  }

  // ── Steps ──────────────────────────────────────────────────────────────────
  const steps = [
    [ST.lineClear,  PH.dispensing,  1, 'Line Clearance',      'Verify dispensing area is clean.',               'Verification', 15,  false, 1],
    [ST.apiDisp,    PH.dispensing,  2, 'API Dispensing',       'Weigh Metformin HCl API. Double-weigh required.','Weighing',     30,  true,  2],
    [ST.excDisp,    PH.dispensing,  3, 'Excipient Dispensing', 'Weigh all excipients per BOM.',                  'Weighing',     45,  false, 3],
    [ST.dryMix,     PH.granulation, 1, 'Dry Mixing',           'Load API + excipients. Mix dry 5 min.',          'Processing',   10,  false, 1],
    [ST.wetMass,    PH.granulation, 2, 'Wet Massing',          'Add PVP K30 binder at controlled rate.',         'Processing',   15,  true,  2],
    [ST.drying,     PH.granulation, 3, 'Drying',               'FBD at 60C until LOD 1.5-3.0%.',                 'Processing',   60,  true,  3],
    [ST.sizing,     PH.granulation, 4, 'Sizing',               'Mill through 1.0mm screen.',                     'Processing',   20,  false, 4],
    [ST.pressSetup, PH.compression, 1, 'Press Setup',          'Install tooling. Set params. Run setup tablets.','Processing',   30,  false, 1],
    [ST.compRun,    PH.compression, 2, 'Compression Run',      'Compress at target. Monitor weight/hardness.',   'Processing',   480, true,  2],
  ];
  for (const [id, phId, num, name, instr, type, dur, crit, sort] of steps) {
    await query(
      `INSERT INTO mbr_steps
         (id,phase_id,mbr_id,step_number,step_name,instruction,step_type,duration_min,is_critical,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
      [id, phId, MBR_ID, num, name, instr, type, dur, crit, sort]
    );
  }

  // ── Parameters ─────────────────────────────────────────────────────────────
  const params = [
    [ST.wetMass, 'Impeller Speed',        '250',  'RPM',    200,  300,  true],
    [ST.wetMass, 'Chopper Speed',         '1500', 'RPM',    1200, 1800, false],
    [ST.wetMass, 'Granulation Time',      '10',   'min',    8,    15,   true],
    [ST.wetMass, 'Binder Addition Rate',  '200',  'mL/min', 150,  250,  true],
    [ST.wetMass, 'Product Temperature',   '45',   'deg C',  35,   55,   true],
    [ST.drying,  'Inlet Air Temperature', '60',   'deg C',  55,   65,   true],
    [ST.drying,  'Product Temp (LOD)',    '40',   'deg C',  35,   50,   true],
    [ST.compRun, 'Main Compression Force','25',   'kN',     18,   32,   true],
    [ST.compRun, 'Pre-compression Force', '5',    'kN',     3,    8,    false],
    [ST.compRun, 'Turret Speed',          '45',   'RPM',    35,   55,   true],
    [ST.compRun, 'Tablet Weight',         '700',  'mg',     665,  735,  true],
    [ST.compRun, 'Fill Depth',            '12.5', 'mm',     11.5, 13.5, true],
  ];
  for (const [stepId, name, target, unit, lo, hi, cpp] of params) {
    const ex = await query(
      'SELECT 1 FROM step_parameters WHERE step_id=$1 AND param_name=$2',
      [stepId, name]
    );
    if (ex.rows.length === 0) {
      await query(
        `INSERT INTO step_parameters
           (step_id, param_name, target_value, unit, lower_limit, upper_limit, is_cpp)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [stepId, name, target, unit, lo, hi, cpp]
      );
    }
  }

  console.log('     + MBR: 6 phases, 9 steps, 12 parameters');

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n  Demo credentials (password: ' + DEMO_PASSWORD + ')');
  console.log('  ─────────────────────────────────────────────────');
  USERS.forEach(function(u) {
    console.log('  ' + u.title.padEnd(26) + u.email);
  });
  console.log('');

  process.exit(0);
}

seed().catch(function(err) {
  console.error('\n  [FATAL] Seed failed:', err.message);
  process.exit(1);
});
