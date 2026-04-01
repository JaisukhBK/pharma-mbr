// server/db/seed-all.js
// PharmaMES.AI — Comprehensive Database Seeder
// ─────────────────────────────────────────────────────────────────
// 1. Wipes all existing seed data (reverse dependency order)
// 2. Seeds fresh data into the correct tables
// 3. No column assumptions — queries actual schema before insert
//
// Run:  node db/seed-all.js
// ─────────────────────────────────────────────────────────────────

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const bcrypt = require('bcrypt');
const { pool, query, runMigrations } = require('./pool');

const PW = 'pharma123';
const today = new Date();
const fmt = (d) => d.toISOString().split('T')[0];
const addDays = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };

// Runtime ID map
const R = {};

// Helper: check if column exists
async function hasColumn(table, column) {
  const r = await query(
    `SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2`,
    [table, column]
  );
  return r.rows.length > 0;
}

// ═════════════════════════════════════════════════════════════════
async function seed() {
  console.log('\n  ╔══════════════════════════════════════════════╗');
  console.log('  ║   PharmaMES.AI — Clean Seed (Wipe + Reseed)  ║');
  console.log('  ╚══════════════════════════════════════════════╝\n');

  await runMigrations();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // STEP 0: WIPE ALL DATA (reverse dependency order)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('  [0/8] Wiping existing data...');
  const WIPE = [
    // EBR children
    'ebr_release_signatures', 'ebr_yield_records', 'ebr_ipc_results',
    'ebr_equipment_usage', 'ebr_material_consumptions', 'ebr_deviations',
    'ebr_parameter_values', 'ebr_step_executions',
    // EBR
    'ebrs',
    // DevCAPA
    'capa_tasks', 'deviation_capas', 'capas', 'deviations',
    // MBR children (M-007 tables)
    'co_designer_proposals', 'co_designer_sessions',
    'mbr_status_transitions', 'mbr_signatures',
    'mbr_ipc_checks', 'mbr_step_equipment', 'mbr_step_materials',
    'mbr_step_parameters', 'mbr_formulas', 'mbr_bom_items',
    'mbr_steps', 'mbr_phases', 'mbr_versions',
    // MBR children (M-002 legacy tables)
    'step_equipment', 'step_materials', 'step_parameters',
    // MBR main
    'mbrs', 'master_batch_records',
    // Equipment
    'equipment_calibrations', 'equipment',
    'calibration_records', 'maintenance_records', 'qualification_records', 'equipment_master',
    // Training
    'training_records', 'training_curricula',
    // Change control
    'change_approvals', 'change_requests',
    // Genealogy
    'recall_lots', 'recall_events', 'batch_genealogy', 'material_lots',
    // Compliance
    'risk_assessments', 'periodic_reviews',
    'ai_performance_metrics', 'ai_model_registry', 'system_config_snapshots',
    // Audit (keep structure, clear data)
    'audit_trail',
    // Sessions
    'refresh_tokens',
    // Users last (everything references them)
    'users',
  ];

  for (const t of WIPE) {
    await query(`DELETE FROM ${t}`).catch(() => {});
  }
  console.log('     ✓ All tables cleared\n');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 1. USERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('  [1/8] Seeding users...');
  const hash = await bcrypt.hash(PW, 10);
  const expiry = new Date(Date.now() + 90 * 86400000).toISOString();

  const USERS = [
    { email: 'jaisukh.patel@pharmambr.com',   username: 'jaisukh.patel',   name: 'Jaisukh Patel',   title: 'System Administrator',  gid: 'admin' },
    { email: 'priya.singh@pharmambr.com',     username: 'priya.singh',     name: 'Priya Singh',     title: 'QA Reviewer',           gid: 'qa_reviewer' },
    { email: 'raj.kumar@pharmambr.com',       username: 'raj.kumar',       name: 'Raj Kumar',       title: 'Production Operator',   gid: 'production_operator' },
    { email: 'carlos.martinez@pharmambr.com', username: 'carlos.martinez', name: 'Carlos Martinez', title: 'Production Supervisor', gid: 'designer' },
    { email: 'wei.chen@pharmambr.com',        username: 'wei.chen',        name: 'Wei Chen',        title: 'Systems Engineer',      gid: 'designer' },
  ];

  for (const u of USERS) {
    const r = await query(
      `INSERT INTO users (email, username, password_hash, full_name, title, group_id, status, must_change_password, training_status, password_expires_at, failed_attempts)
       VALUES ($1,$2,$3,$4,$5,$6,'Active',false,'Current',$7,0) RETURNING id`,
      [u.email, u.username, hash, u.name, u.title, u.gid, expiry]
    );
    R[u.gid] = r.rows[0].id; // last one wins for duplicate gids (designer)
    if (u.gid === 'admin') R.admin = r.rows[0].id;
    if (u.email.startsWith('raj'))    R.operator = r.rows[0].id;
    if (u.email.startsWith('priya'))  R.qa = r.rows[0].id;
    if (u.email.startsWith('carlos')) R.carlos = r.rows[0].id;
    if (u.email.startsWith('wei'))    R.wei = r.rows[0].id;
    console.log('     ✓ ' + u.name + ' [' + u.gid + ']');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 2. MBRs (into BOTH mbrs AND master_batch_records for FK compat)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  [2/8] Seeding MBRs...');
  const MBRS = [
    { key: 'mbr1', code: 'MBR-MET-500-001', name: 'Metformin HCl 500mg Tablets',  pcode: 'PROD-MET-500', str: '500mg', form: 'Tablet',  size: 200000, unit: 'tablets',  btype: 'Production', mkt: 'US/EU', desc: 'Metformin HCl 500mg film-coated tablets. Wet granulation.', status: 'Effective', yld: 97.00 },
    { key: 'mbr2', code: 'MBR-AMX-500-001', name: 'Amoxicillin 500mg Capsules',   pcode: 'PROD-AMX-500', str: '500mg', form: 'Capsule', size: 150000, unit: 'capsules', btype: 'Production', mkt: 'US',    desc: 'Amoxicillin trihydrate 500mg hard gelatin capsules.',       status: 'Approved',  yld: 98.00 },
    { key: 'mbr3', code: 'MBR-OMP-20-001',  name: 'Omeprazole 20mg DR Capsules',  pcode: 'PROD-OMP-20',  str: '20mg',  form: 'Capsule', size: 100000, unit: 'capsules', btype: 'Validation', mkt: 'EU',    desc: 'Omeprazole 20mg delayed-release capsules.',                 status: 'Draft',     yld: 95.00 },
  ];

  for (const m of MBRS) {
    // Insert into mbrs (M-007 — what the app reads)
    const r = await query(
      `INSERT INTO mbrs (mbr_code, product_name, product_code, strength, dosage_form, batch_size, batch_size_unit, batch_type, market, description, status, current_version, target_yield, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1,$12,$13) RETURNING id`,
      [m.code, m.name, m.pcode, m.str, m.form, m.size, m.unit, m.btype, m.mkt, m.desc, m.status, m.yld, R.admin]
    );
    R[m.key] = r.rows[0].id;

    // Mirror into master_batch_records (M-002 — FK compat for phases/steps)
    await query(
      `INSERT INTO master_batch_records (id, mbr_code, product_name, product_code, dosage_form, batch_size, batch_size_unit, description, status, current_version, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,1,$10)`,
      [R[m.key], m.code, m.name, m.pcode, m.form, m.size, m.unit, m.desc, m.status, R.admin]
    ).catch(() => {});

    console.log('     ✓ ' + m.code + ' — ' + m.name + ' [' + m.status + ']');
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 3. PHASES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  [3/8] Seeding phases...');
  const PHASES = [
    { k: 'ph_disp',  m: 'mbr1', n: 1, nm: 'Dispensing',       d: 'Weigh and dispense all raw materials per BOM' },
    { k: 'ph_gran',  m: 'mbr1', n: 2, nm: 'Granulation',      d: 'Wet granulation using high-shear granulator' },
    { k: 'ph_blend', m: 'mbr1', n: 3, nm: 'Blending',         d: 'Blend granules with extragranular excipients' },
    { k: 'ph_comp',  m: 'mbr1', n: 4, nm: 'Compression',      d: 'Compress blend into tablets using rotary press' },
    { k: 'ph_coat',  m: 'mbr1', n: 5, nm: 'Coating',          d: 'Film coat tablets in perforated coating pan' },
    { k: 'ph_pkg',   m: 'mbr1', n: 6, nm: 'Packaging',        d: 'Primary and secondary packaging' },
    { k: 'ph2_disp', m: 'mbr2', n: 1, nm: 'Dispensing',       d: 'Weigh and dispense API and excipients' },
    { k: 'ph2_bld',  m: 'mbr2', n: 2, nm: 'Blending',         d: 'Blend amoxicillin with excipients in V-blender' },
    { k: 'ph2_fill', m: 'mbr2', n: 3, nm: 'Capsule Filling',  d: 'Fill hard gelatin capsules with blended powder' },
    { k: 'ph3_coat', m: 'mbr3', n: 1, nm: 'Pellet Coating',   d: 'Enteric coat omeprazole pellets in fluid bed' },
    { k: 'ph3_fill', m: 'mbr3', n: 2, nm: 'Capsule Filling',  d: 'Fill capsules with coated pellets' },
  ];

  for (const p of PHASES) {
    const r = await query(
      `INSERT INTO mbr_phases (mbr_id, phase_number, phase_name, description, sort_order)
       VALUES ($1,$2,$3,$4,$2) RETURNING id`,
      [R[p.m], p.n, p.nm, p.d]
    );
    R[p.k] = r.rows[0].id;
  }
  console.log('     ✓ ' + PHASES.length + ' phases');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 4. STEPS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  [4/8] Seeding steps + parameters + BOM + IPC...');
  const STEPS = [
    // MBR1 — Metformin (14 steps)
    { k: 'st01', p: 'ph_disp',  m: 'mbr1', n: 1,  nm: 'Line Clearance',        ins: 'Verify dispensing area is clean. Check cleaning log.',                                        tp: 'Verification', dur: 15,  cr: false, gm: true  },
    { k: 'st02', p: 'ph_disp',  m: 'mbr1', n: 2,  nm: 'API Dispensing',         ins: 'Weigh Metformin HCl API per BOM. Double-weigh required. Record tare/gross/net.',               tp: 'Weighing',     dur: 30,  cr: true,  gm: true  },
    { k: 'st03', p: 'ph_disp',  m: 'mbr1', n: 3,  nm: 'Excipient Dispensing',   ins: 'Weigh all excipients per BOM quantities. Verify lot numbers and expiry dates.',                 tp: 'Weighing',     dur: 45,  cr: false, gm: true  },
    { k: 'st04', p: 'ph_gran',  m: 'mbr1', n: 4,  nm: 'Dry Mixing',             ins: 'Load API + intragranular excipients into HSG. Mix dry 5 min.',                                  tp: 'Processing',   dur: 10,  cr: false, gm: false },
    { k: 'st05', p: 'ph_gran',  m: 'mbr1', n: 5,  nm: 'Wet Massing',            ins: 'Add PVP K30 binder solution at controlled rate. Monitor torque and temperature.',               tp: 'Processing',   dur: 15,  cr: true,  gm: true  },
    { k: 'st06', p: 'ph_gran',  m: 'mbr1', n: 6,  nm: 'Drying',                 ins: 'Transfer to FBD. Dry at 60C inlet until LOD 1.5-3.0%. Record product temperature.',             tp: 'Processing',   dur: 60,  cr: true,  gm: true  },
    { k: 'st07', p: 'ph_gran',  m: 'mbr1', n: 7,  nm: 'Sizing / Milling',       ins: 'Pass dried granules through Comil with 1.0mm screen. Record yield.',                            tp: 'Processing',   dur: 20,  cr: false, gm: false },
    { k: 'st08', p: 'ph_blend', m: 'mbr1', n: 8,  nm: 'Lubrication & Blending', ins: 'Add Mg stearate. Blend in V-blender 3 min. Do NOT over-blend.',                                 tp: 'Processing',   dur: 10,  cr: true,  gm: false },
    { k: 'st09', p: 'ph_comp',  m: 'mbr1', n: 9,  nm: 'Press Setup',            ins: 'Install 13mm biconvex tooling. Set fill depth, pre/main compression.',                          tp: 'Processing',   dur: 30,  cr: false, gm: false },
    { k: 'st10', p: 'ph_comp',  m: 'mbr1', n: 10, nm: 'Compression Run',        ins: 'Compress at target. Monitor weight, hardness, thickness, friability per IPC.',                   tp: 'Processing',   dur: 480, cr: true,  gm: true  },
    { k: 'st11', p: 'ph_coat',  m: 'mbr1', n: 11, nm: 'Coating Solution Prep',  ins: 'Prepare Opadry II suspension. Mix 45 min. Strain through 60 mesh.',                             tp: 'Processing',   dur: 60,  cr: false, gm: false },
    { k: 'st12', p: 'ph_coat',  m: 'mbr1', n: 12, nm: 'Film Coating',           ins: 'Load cores. Apply coating to 3% weight gain. Monitor temperatures.',                            tp: 'Processing',   dur: 120, cr: true,  gm: true  },
    { k: 'st13', p: 'ph_pkg',   m: 'mbr1', n: 13, nm: 'Primary Packaging',      ins: 'Blister pack 10 tablets/blister. Seal integrity check.',                                        tp: 'Packaging',    dur: 180, cr: false, gm: false },
    { k: 'st14', p: 'ph_pkg',   m: 'mbr1', n: 14, nm: 'Secondary Packaging',    ins: 'Carton, label, weigh, serialize. Verify barcode/print.',                                        tp: 'Packaging',    dur: 120, cr: false, gm: false },
    // MBR2 — Amoxicillin (4 steps)
    { k: 'st21', p: 'ph2_disp', m: 'mbr2', n: 1,  nm: 'Line Clearance',         ins: 'Verify dispensing area is clean.',                                                              tp: 'Verification', dur: 15,  cr: false, gm: true  },
    { k: 'st22', p: 'ph2_disp', m: 'mbr2', n: 2,  nm: 'API Dispensing',          ins: 'Weigh Amoxicillin trihydrate. Double-weigh required.',                                          tp: 'Weighing',     dur: 30,  cr: true,  gm: true  },
    { k: 'st23', p: 'ph2_bld',  m: 'mbr2', n: 3,  nm: 'Powder Blending',         ins: 'Blend API with MCC and SSG in V-blender 15 min.',                                               tp: 'Processing',   dur: 20,  cr: true,  gm: false },
    { k: 'st24', p: 'ph2_fill', m: 'mbr2', n: 4,  nm: 'Capsule Filling',         ins: 'Fill size 0 capsules. Target 550mg fill weight.',                                                tp: 'Processing',   dur: 240, cr: true,  gm: true  },
    // MBR3 — Omeprazole (3 steps)
    { k: 'st31', p: 'ph3_coat', m: 'mbr3', n: 1,  nm: 'Pellet Loading',          ins: 'Load omeprazole pellets into Wurster coater.',                                                   tp: 'Processing',   dur: 15,  cr: false, gm: false },
    { k: 'st32', p: 'ph3_coat', m: 'mbr3', n: 2,  nm: 'Enteric Coating',         ins: 'Apply Eudragit L30D-55 coat. Target 30% weight gain.',                                          tp: 'Processing',   dur: 180, cr: true,  gm: true  },
    { k: 'st33', p: 'ph3_fill', m: 'mbr3', n: 3,  nm: 'Capsule Filling',         ins: 'Fill size 2 capsules with coated pellets. Target 180mg.',                                        tp: 'Processing',   dur: 180, cr: true,  gm: true  },
  ];

  for (const s of STEPS) {
    const r = await query(
      `INSERT INTO mbr_steps (phase_id, mbr_id, step_number, step_name, instruction, step_type, duration_min, is_critical, is_gmp_critical, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$3) RETURNING id`,
      [R[s.p], R[s.m], s.n, s.nm, s.ins, s.tp, s.dur, s.cr, s.gm]
    );
    R[s.k] = r.rows[0].id;
  }
  console.log('     ✓ ' + STEPS.length + ' steps');

  // ── Parameters (detect schema: sort_order may or may not exist) ──
  const paramHasSortOrder = await hasColumn('mbr_step_parameters', 'sort_order');
  const paramHasMbrId     = await hasColumn('mbr_step_parameters', 'mbr_id');

  const PARAMS = [
    // Wet Massing
    { s: 'st05', m: 'mbr1', nm: 'Impeller Speed',       tgt: '250',  u: 'RPM',    lo: 200,  hi: 300,  cpp: true,  cqa: false },
    { s: 'st05', m: 'mbr1', nm: 'Chopper Speed',        tgt: '1500', u: 'RPM',    lo: 1200, hi: 1800, cpp: false, cqa: false },
    { s: 'st05', m: 'mbr1', nm: 'Granulation Time',     tgt: '10',   u: 'min',    lo: 8,    hi: 15,   cpp: true,  cqa: false },
    { s: 'st05', m: 'mbr1', nm: 'Binder Addition Rate', tgt: '200',  u: 'mL/min', lo: 150,  hi: 250,  cpp: true,  cqa: false },
    { s: 'st05', m: 'mbr1', nm: 'Product Temperature',  tgt: '45',   u: 'C',      lo: 35,   hi: 55,   cpp: true,  cqa: false },
    // Drying
    { s: 'st06', m: 'mbr1', nm: 'Inlet Air Temperature',tgt: '60',   u: 'C',      lo: 55,   hi: 65,   cpp: true,  cqa: false },
    { s: 'st06', m: 'mbr1', nm: 'Product Temperature',  tgt: '40',   u: 'C',      lo: 35,   hi: 50,   cpp: true,  cqa: false },
    { s: 'st06', m: 'mbr1', nm: 'LOD (%)',              tgt: '2.0',  u: '%',      lo: 1.5,  hi: 3.0,  cpp: false, cqa: true  },
    // Compression
    { s: 'st10', m: 'mbr1', nm: 'Main Compression Force',tgt: '25',   u: 'kN',  lo: 18,   hi: 32,   cpp: true,  cqa: false },
    { s: 'st10', m: 'mbr1', nm: 'Pre-compression Force', tgt: '5',    u: 'kN',  lo: 3,    hi: 8,    cpp: false, cqa: false },
    { s: 'st10', m: 'mbr1', nm: 'Turret Speed',          tgt: '45',   u: 'RPM', lo: 35,   hi: 55,   cpp: true,  cqa: false },
    { s: 'st10', m: 'mbr1', nm: 'Tablet Weight',         tgt: '700',  u: 'mg',  lo: 665,  hi: 735,  cpp: false, cqa: true  },
    { s: 'st10', m: 'mbr1', nm: 'Tablet Hardness',       tgt: '120',  u: 'N',   lo: 80,   hi: 160,  cpp: false, cqa: true  },
    { s: 'st10', m: 'mbr1', nm: 'Tablet Thickness',      tgt: '5.5',  u: 'mm',  lo: 5.2,  hi: 5.8,  cpp: false, cqa: true  },
    { s: 'st10', m: 'mbr1', nm: 'Fill Depth',            tgt: '12.5', u: 'mm',  lo: 11.5, hi: 13.5, cpp: true,  cqa: false },
    // Coating
    { s: 'st12', m: 'mbr1', nm: 'Inlet Air Temp',   tgt: '65', u: 'C',     lo: 60,  hi: 70,  cpp: true,  cqa: false },
    { s: 'st12', m: 'mbr1', nm: 'Pan Speed',        tgt: '8',  u: 'RPM',   lo: 6,   hi: 12,  cpp: true,  cqa: false },
    { s: 'st12', m: 'mbr1', nm: 'Spray Rate',       tgt: '80', u: 'g/min', lo: 60,  hi: 100, cpp: true,  cqa: false },
    { s: 'st12', m: 'mbr1', nm: 'Weight Gain',      tgt: '3.0',u: '%',     lo: 2.5, hi: 3.5, cpp: false, cqa: true  },
    // MBR2 — Capsule Fill
    { s: 'st24', m: 'mbr2', nm: 'Fill Weight',   tgt: '550', u: 'mg',  lo: 522, hi: 578, cpp: false, cqa: true  },
    { s: 'st24', m: 'mbr2', nm: 'Machine Speed', tgt: '50',  u: 'RPM', lo: 40,  hi: 60,  cpp: true,  cqa: false },
    // MBR3 — Enteric Coating
    { s: 'st32', m: 'mbr3', nm: 'Coating Weight Gain', tgt: '30', u: '%', lo: 25, hi: 35, cpp: true, cqa: true  },
    { s: 'st32', m: 'mbr3', nm: 'Inlet Air Temp',     tgt: '40', u: 'C', lo: 35, hi: 45, cpp: true, cqa: false },
  ];

  for (const p of PARAMS) {
    // Build columns dynamically based on actual schema
    let cols = 'step_id, param_name, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa';
    let vals = '$1, $2, $3, $4, $5, $6, $7, $8';
    let params = [R[p.s], p.nm, p.tgt, p.u, p.lo, p.hi, p.cpp, p.cqa];
    let idx = 9;

    if (paramHasMbrId) {
      cols += ', mbr_id';
      vals += ', $' + idx;
      params.push(R[p.m]);
      idx++;
    }
    if (paramHasSortOrder) {
      cols += ', sort_order';
      vals += ', 0';
    }

    await query(`INSERT INTO mbr_step_parameters (${cols}) VALUES (${vals})`, params);
  }
  console.log('     ✓ ' + PARAMS.length + ' parameters (CPP/CQA)');

  // ── BOM Items ───────────────────────────────────────────────
  const BOM = [
    { m: 'mbr1', c: 'RM-MET-001', nm: 'Metformin HCl',               q: 100,    u: 'kg',  a: true,  sq: 1, gr: 'Ph.Eur/USP',   sp: 'Aurobindo Pharma' },
    { m: 'mbr1', c: 'RM-MCC-001', nm: 'Microcrystalline Cellulose',  q: 20,     u: 'kg',  a: false, sq: 2, gr: 'Avicel PH-101', sp: 'DuPont' },
    { m: 'mbr1', c: 'RM-PVP-001', nm: 'Povidone K30',                q: 6,      u: 'kg',  a: false, sq: 3, gr: 'Kollidon 30',   sp: 'BASF' },
    { m: 'mbr1', c: 'RM-CCS-001', nm: 'Croscarmellose Sodium',       q: 8,      u: 'kg',  a: false, sq: 4, gr: 'Ac-Di-Sol',     sp: 'DuPont' },
    { m: 'mbr1', c: 'RM-MGS-001', nm: 'Magnesium Stearate',          q: 1.4,    u: 'kg',  a: false, sq: 5, gr: 'NF/Ph.Eur',     sp: 'Peter Greven' },
    { m: 'mbr1', c: 'RM-OPD-001', nm: 'Opadry II White',             q: 4.2,    u: 'kg',  a: false, sq: 6, gr: '85F18422',      sp: 'Colorcon' },
    { m: 'mbr1', c: 'RM-PW-001',  nm: 'Purified Water',              q: 30,     u: 'L',   a: false, sq: 7, gr: 'USP',           sp: 'In-house WFI' },
    { m: 'mbr2', c: 'RM-AMX-001', nm: 'Amoxicillin Trihydrate',      q: 82.5,   u: 'kg',  a: true,  sq: 1, gr: 'Ph.Eur/USP',   sp: 'Sandoz' },
    { m: 'mbr2', c: 'RM-MCC-002', nm: 'Microcrystalline Cellulose',  q: 12,     u: 'kg',  a: false, sq: 2, gr: 'Avicel PH-102', sp: 'DuPont' },
    { m: 'mbr2', c: 'RM-SSG-001', nm: 'Sodium Starch Glycolate',     q: 4,      u: 'kg',  a: false, sq: 3, gr: 'Explotab',      sp: 'JRS Pharma' },
    { m: 'mbr2', c: 'RM-CAP-001', nm: 'Hard Gelatin Capsules Size 0',q: 150000, u: 'pcs', a: false, sq: 4, gr: 'Coni-Snap',     sp: 'Capsugel' },
  ];

  const bomHasSortOrder = await hasColumn('mbr_bom_items', 'sort_order');
  for (const b of BOM) {
    let cols = 'mbr_id, material_code, material_name, quantity_per_batch, unit, is_active_ingredient, dispensing_sequence, grade, supplier';
    let vals = '$1,$2,$3,$4,$5,$6,$7,$8,$9';
    let params = [R[b.m], b.c, b.nm, b.q, b.u, b.a, b.sq, b.gr, b.sp];
    if (bomHasSortOrder) { cols += ', sort_order'; vals += ', $7'; }
    await query(`INSERT INTO mbr_bom_items (${cols}) VALUES (${vals})`, params);
  }
  console.log('     ✓ ' + BOM.length + ' BOM items');

  // ── IPC Checks ──────────────────────────────────────────────
  const IPC = [
    { s: 'st10', m: 'mbr1', nm: 'Individual Tablet Weight', tp: 'Physical',    sp: '700 +/- 35 mg',      fr: 'Every 30 min' },
    { s: 'st10', m: 'mbr1', nm: 'Tablet Hardness',          tp: 'Physical',    sp: '80-160 N',            fr: 'Every 30 min' },
    { s: 'st10', m: 'mbr1', nm: 'Tablet Thickness',         tp: 'Physical',    sp: '5.2-5.8 mm',          fr: 'Every 30 min' },
    { s: 'st10', m: 'mbr1', nm: 'Friability',               tp: 'Physical',    sp: 'NMT 1.0%',            fr: 'Start / Mid / End' },
    { s: 'st10', m: 'mbr1', nm: 'Disintegration Time',      tp: 'Performance', sp: 'NMT 15 min',          fr: 'Start / Mid / End' },
    { s: 'st06', m: 'mbr1', nm: 'Loss on Drying (LOD)',     tp: 'Moisture',    sp: '1.5-3.0%',            fr: 'Every 15 min after 30 min' },
    { s: 'st12', m: 'mbr1', nm: 'Coating Weight Gain',      tp: 'Physical',    sp: '2.5-3.5%',            fr: 'End of coating' },
    { s: 'st24', m: 'mbr2', nm: 'Capsule Fill Weight',      tp: 'Physical',    sp: '550 +/- 28 mg',       fr: 'Every 15 min' },
    { s: 'st32', m: 'mbr3', nm: 'Acid Resistance',          tp: 'Dissolution', sp: 'NMT 10% in 2h acid',  fr: 'End of coating' },
  ];

  const ipcHasSortOrder = await hasColumn('mbr_ipc_checks', 'sort_order');
  for (const c of IPC) {
    let cols = 'step_id, mbr_id, check_name, check_type, specification, frequency';
    let vals = '$1,$2,$3,$4,$5,$6';
    if (ipcHasSortOrder) { cols += ', sort_order'; vals += ', 0'; }
    await query(`INSERT INTO mbr_ipc_checks (${cols}) VALUES (${vals})`, [R[c.s], R[c.m], c.nm, c.tp, c.sp, c.fr]);
  }
  console.log('     ✓ ' + IPC.length + ' IPC checks');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 5. EQUIPMENT
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  [5/8] Seeding equipment...');
  const EQ = [
    { c: 'EQ-HSG-001', nm: 'High-Shear Granulator 300L',    tp: 'Granulator',     mf: 'Diosna',             md: 'P 300',          sn: 'DIO-P300-2022-0042', lc: 'Building A / Room 201', ar: 'Solid Dosage',    gmp: true,  d: 180, lca: -90,  cdu: 90,   q: 'Qualified',     st: 'Available' },
    { c: 'EQ-FBD-001', nm: 'Fluid Bed Dryer 120kg',         tp: 'Dryer',          mf: 'Glatt',              md: 'GPCG-120',       sn: 'GL-GPCG-2021-0078',  lc: 'Building A / Room 202', ar: 'Solid Dosage',    gmp: true,  d: 365, lca: -120, cdu: 245,  q: 'Qualified',     st: 'Available' },
    { c: 'EQ-BLD-001', nm: 'V-Blender 500L',                tp: 'Blender',        mf: 'GEA',                md: 'VB-500',         sn: 'GEA-VB500-2020-0091',lc: 'Building A / Room 203', ar: 'Solid Dosage',    gmp: true,  d: 365, lca: -200, cdu: 165,  q: 'Qualified',     st: 'Available' },
    { c: 'EQ-TAB-001', nm: 'Rotary Tablet Press 45-Stn',    tp: 'Tablet Press',   mf: 'Fette',              md: 'P3010',          sn: 'FP-2023-1188',       lc: 'Building A / Room 301', ar: 'Compression',     gmp: true,  d: 180, lca: -30,  cdu: 150,  q: 'Qualified',     st: 'Available' },
    { c: 'EQ-TAB-002', nm: 'Rotary Tablet Press 27-Stn',    tp: 'Tablet Press',   mf: 'Korsch',             md: 'XL 100',         sn: 'KOR-XL100-2019-0055',lc: 'Building A / Room 302', ar: 'Compression',     gmp: true,  d: 180, lca: -200, cdu: -20,  q: 'Not Qualified', st: 'Out of Service' },
    { c: 'EQ-COT-001', nm: 'Perforated Coating Pan 60"',    tp: 'Coater',         mf: 'Thomas Engineering', md: 'Accela-Cota 60', sn: 'TE-AC60-2021-0033',  lc: 'Building B / Room 110', ar: 'Coating',         gmp: true,  d: 365, lca: -60,  cdu: 305,  q: 'Qualified',     st: 'Available' },
    { c: 'EQ-BAL-001', nm: 'Analytical Balance 220g',       tp: 'Balance',        mf: 'Mettler Toledo',     md: 'XPR225',         sn: 'MT-XPR-2024-5512',   lc: 'QC Lab / Room 401',     ar: 'Quality Control', gmp: true,  d: 180, lca: -10,  cdu: 170,  q: 'Qualified',     st: 'Available' },
    { c: 'EQ-BAL-002', nm: 'Platform Balance 15kg',         tp: 'Balance',        mf: 'Mettler Toledo',     md: 'ICS465',         sn: 'MT-ICS-2023-3301',   lc: 'Dispensing / Room 102', ar: 'Dispensing',      gmp: true,  d: 90,  lca: -85,  cdu: 5,    q: 'Qualified',     st: 'Available' },
    { c: 'EQ-BLI-001', nm: 'Blister Packaging Machine',     tp: 'Packaging',      mf: 'IMA',                md: 'Blista 30',      sn: 'IMA-B30-2020-0017',  lc: 'Building C / Room 501', ar: 'Packaging',       gmp: false, d: 365, lca: -180, cdu: 185,  q: 'Qualified',     st: 'Available' },
    { c: 'EQ-MIL-001', nm: 'Cone Mill / Comil 197S',        tp: 'Mill',           mf: 'Quadro Engineering', md: 'Comil 197S',     sn: 'QE-197S-2024-0008',  lc: 'Building A / Room 204', ar: 'Solid Dosage',    gmp: true,  d: 365, lca: null, cdu: null, q: 'Not Qualified', st: 'Available' },
    { c: 'EQ-CAP-001', nm: 'Capsule Filler MG2 Planeta',    tp: 'Capsule Filler', mf: 'MG2',                md: 'Planeta 100',    sn: 'MG2-PL100-2023-009', lc: 'Building B / Room 201', ar: 'Encapsulation',   gmp: true,  d: 180, lca: -45,  cdu: 135,  q: 'Qualified',     st: 'Available' },
    { c: 'EQ-FBD-002', nm: 'Wurster Fluid Bed Coater',      tp: 'Coater',         mf: 'Glatt',              md: 'GPCG-60 Wurster',sn: 'GL-W60-2022-0031',   lc: 'Building B / Room 105', ar: 'Coating',         gmp: true,  d: 365, lca: -100, cdu: 265,  q: 'Qualified',     st: 'Available' },
  ];

  for (const e of EQ) {
    await query(
      `INSERT INTO equipment (equipment_code, equipment_name, equipment_type, manufacturer, model, serial_number, location, area, gmp_critical, calibration_interval_days, last_calibration, calibration_due, qualification_status, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [e.c, e.nm, e.tp, e.mf, e.md, e.sn, e.lc, e.ar, e.gmp, e.d,
       e.lca !== null ? fmt(addDays(e.lca)) : null,
       e.cdu !== null ? fmt(addDays(e.cdu)) : null,
       e.q, e.st]
    );
    console.log('     ' + (e.st === 'Available' ? '✓' : '!') + ' ' + e.c + ' — ' + e.nm);
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 6. TRAINING
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  [6/8] Seeding training...');
  const CURR = [
    { c: 'GMP-001',  nm: 'GMP Fundamentals',                        r: '{admin,designer,qa_reviewer,production_operator,viewer}', mo: 12 },
    { c: 'ESIG-001', nm: 'Electronic Signature Policy (21 CFR 11)', r: '{admin,designer,qa_reviewer,production_operator}',        mo: 12 },
    { c: 'MBR-001',  nm: 'MBR Designer Operations',                 r: '{admin,designer}',                                        mo: 12 },
    { c: 'QA-001',   nm: 'QA Review & Approval Procedures',         r: '{qa_reviewer,admin}',                                     mo: 12 },
    { c: 'MFG-001',  nm: 'Manufacturing Execution (EBR)',            r: '{production_operator,admin}',                             mo: 12 },
    { c: 'AI-001',   nm: 'AI Co-Designer Usage & Governance',        r: '{admin,designer}',                                        mo: 24 },
  ];

  for (const c of CURR) {
    await query(
      `INSERT INTO training_curricula (course_code, course_name, required_for_roles, validity_months, is_active, created_by)
       VALUES ($1,$2,$3,$4,true,$5)`,
      [c.c, c.nm, c.r, c.mo, R.admin]
    );
  }
  console.log('     ✓ ' + CURR.length + ' curricula');

  // Auto-complete training records
  const allCurr = await query('SELECT id, required_for_roles, validity_months FROM training_curricula');
  let tc = 0;
  for (const u of USERS) {
    const uid = R[u.gid] || R.admin;
    for (const c of allCurr.rows) {
      if (c.required_for_roles && c.required_for_roles.includes(u.gid)) {
        const exp = new Date(); exp.setMonth(exp.getMonth() + (c.validity_months || 12));
        await query(
          `INSERT INTO training_records (curriculum_id, user_id, status, assigned_by, completed_at, completed_by, expiry_date, evidence_notes)
           VALUES ($1,$2,'Completed',$2,NOW(),$2,$3,'Initial training - system seed')`,
          [c.id, uid, exp.toISOString()]
        );
        tc++;
      }
    }
  }
  console.log('     ✓ ' + tc + ' training records');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 7. SAMPLE EBR
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  [7/8] Seeding sample EBR...');
  // Detect which columns exist on ebrs (M-004 vs M-007 schema differences)
  const ebrHasBSU = await hasColumn('ebrs', 'batch_size_unit');
  const ebrHasVer = await hasColumn('ebrs', 'mbr_version');
  const ebrHasYld = await hasColumn('ebrs', 'theoretical_yield');
  const ebrHasCreatedBy = await hasColumn('ebrs', 'created_by');

  let ebrCols = 'ebr_code, mbr_id, batch_number, product_name, batch_size, operator_id, status';
  let ebrVals = "$1,$2,$3,'Metformin HCl 500mg Tablets',200000,$4,'In Progress'";
  let ebrParams = ['EBR-MET-2026-001', R.mbr1, 'BTC-MET-2026-001', R.operator];
  if (ebrHasBSU) { ebrCols += ', batch_size_unit'; ebrVals += ", 'tablets'"; }
  if (ebrHasVer) { ebrCols += ', mbr_version'; ebrVals += ', 1'; }
  if (ebrHasYld) { ebrCols += ', theoretical_yield'; ebrVals += ', 200000'; }
  if (ebrHasCreatedBy) { ebrCols += ', created_by'; ebrVals += ', $' + (ebrParams.length + 1); ebrParams.push(R.admin); }

  const ebr = await query(
    `INSERT INTO ebrs (${ebrCols}) VALUES (${ebrVals}) RETURNING id`, ebrParams
  );
  const ebrId = ebr.rows[0].id;

  const mbrSteps = await query(
    `SELECT s.*, p.phase_name FROM mbr_steps s JOIN mbr_phases p ON s.phase_id=p.id WHERE s.mbr_id=$1 ORDER BY s.step_number LIMIT 4`,
    [R.mbr1]
  );

  const execHasPhase = await hasColumn('ebr_step_executions', 'phase_name');
  const execHasInstr = await hasColumn('ebr_step_executions', 'instruction');
  const execHasCrit  = await hasColumn('ebr_step_executions', 'is_critical');
  const execHasGmp   = await hasColumn('ebr_step_executions', 'is_gmp_critical');
  const execHasDur   = await hasColumn('ebr_step_executions', 'duration_min');

  for (let i = 0; i < mbrSteps.rows.length; i++) {
    const s = mbrSteps.rows[i];
    const st = i < 2 ? 'Completed' : (i === 2 ? 'In Progress' : 'Pending');

    let cols = 'ebr_id, mbr_step_id, step_number, step_name, status, operator_id, started_at, completed_at';
    let vals = '$1,$2,$3,$4,$5,$6,$7,$8';
    let params = [ebrId, s.id, s.step_number, s.step_name, st, R.operator,
      st !== 'Pending' ? new Date(Date.now() - (4-i)*3600000).toISOString() : null,
      st === 'Completed' ? new Date(Date.now() - (3-i)*3600000).toISOString() : null];
    let idx = 9;

    if (execHasPhase) { cols += ', phase_name'; vals += ', $' + idx; params.push(s.phase_name); idx++; }
    if (execHasInstr) { cols += ', instruction'; vals += ', $' + idx; params.push(s.instruction); idx++; }
    if (execHasCrit)  { cols += ', is_critical'; vals += ', $' + idx; params.push(s.is_critical); idx++; }
    if (execHasGmp)   { cols += ', is_gmp_critical'; vals += ', $' + idx; params.push(s.is_gmp_critical); idx++; }
    if (execHasDur)   { cols += ', duration_min'; vals += ', $' + idx; params.push(Math.round(Number(s.duration_min) || 0)); idx++; }

    await query(`INSERT INTO ebr_step_executions (${cols}) VALUES (${vals})`, params);
  }
  console.log('     ✓ EBR-MET-2026-001 — In Progress (2/4 steps done)');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // 8. DEVIATIONS + CAPAs
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  [8/8] Seeding deviations + CAPAs...');
  await query(
    `INSERT INTO deviations (title, description, severity, category, status, area, batch_number, detected_by, root_cause, created_by, assigned_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    ['Granule moisture above specification during Metformin batch',
     'LOD measured at 3.8% (spec: 1.5-3.0%) after 60 min drying. FBD inlet at 60C. Suspected ambient humidity spike.',
     'Major', 'Process', 'Investigating', 'Granulation', 'BTC-MET-2026-001', 'Raj Kumar',
     'Suspected high ambient humidity (>70% RH) affecting FBD performance.',
     R.operator, R.qa]
  );

  await query(
    `INSERT INTO deviations (title, description, severity, category, status, area, detected_by, created_by, assigned_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    ['Tablet press tooling wear detected during compression',
     'Upper punch tip wear marks at batch midpoint. No quality impact observed.',
     'Minor', 'Equipment', 'Open', 'Compression', 'Carlos Martinez', R.carlos, R.carlos]
  );

  const capaHasActionPlan = await hasColumn('capas', 'action_plan');
  const capaHasEffCriteria = await hasColumn('capas', 'effectiveness_criteria');

  let capaCols = 'title, description, capa_type, priority, status, due_date, assigned_to, created_by';
  let capaVals = '$1,$2,$3,$4,$5,$6,$7,$8';
  let capaParams = [
    'Install dehumidification system for granulation area',
    'Install dehumidifier in Building A Room 201-202 to maintain RH below 45%.',
    'Preventive', 'High', 'In Progress',
    fmt(addDays(60)), R.wei, R.qa
  ];
  let capaIdx = 9;

  if (capaHasActionPlan) {
    capaCols += ', action_plan';
    capaVals += ', $' + capaIdx;
    capaParams.push('1. Procure unit\n2. Install in Room 201\n3. Validate RH control\n4. Update SOP');
    capaIdx++;
  }
  if (capaHasEffCriteria) {
    capaCols += ', effectiveness_criteria';
    capaVals += ', $' + capaIdx;
    capaParams.push('Room 201 RH below 45% for 3 consecutive batches');
    capaIdx++;
  }

  await query(`INSERT INTO capas (${capaCols}) VALUES (${capaVals})`, capaParams);
  console.log('     ✓ 2 deviations + 1 CAPA');

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DONE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('\n  ══════════════════════════════════════════════');
  console.log('  SEED COMPLETE');
  console.log('  ══════════════════════════════════════════════\n');
  console.log('  MBRs:        3  (Metformin/Amoxicillin/Omeprazole)');
  console.log('  Phases:      11');
  console.log('  Steps:       21');
  console.log('  Parameters:  23 (CPP/CQA)');
  console.log('  BOM Items:   11');
  console.log('  IPC Checks:  9');
  console.log('  Equipment:   12');
  console.log('  Training:    6 curricula + ' + tc + ' records');
  console.log('  EBR:         1 (In Progress)');
  console.log('  Deviations:  2  +  CAPAs: 1');
  console.log('');
  console.log('  Login with password: ' + PW);
  console.log('  ─────────────────────────────────────────────');
  USERS.forEach(u => console.log('  ' + u.title.padEnd(26) + u.email));
  console.log('');

  process.exit(0);
}

seed().catch(err => {
  console.error('\n  [FATAL] Seed failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
