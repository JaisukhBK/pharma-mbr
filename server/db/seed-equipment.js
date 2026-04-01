// server/db/seed-equipment.js
// PharmaMES.AI — Equipment Seed Data
// Run: node db/seed-equipment.js
// Seeds realistic OSD (Oral Solid Dosage) pharmaceutical manufacturing equipment.
// Idempotent — uses ON CONFLICT DO NOTHING.

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { query, runMigrations } = require('./pool');

const today      = new Date();
const fmt        = (d) => d.toISOString().split('T')[0];
const addDays    = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const addMonths  = (d, n) => { const x = new Date(d); x.setMonth(x.getMonth() + n); return x; };

const EQUIPMENT = [
  // ── Granulation Line ─────────────────────────────────────────────────────
  {
    equipment_code:           'EQ-HSG-001',
    equipment_name:           'High-Shear Granulator 300L',
    equipment_type:           'Granulator',
    manufacturer:             'Diosna',
    model:                    'P 300',
    serial_number:            'DIO-P300-2022-0042',
    location:                 'Building A / Room 201',
    area:                     'Solid Dosage',
    gmp_critical:             true,
    calibration_interval_days: 180,
    last_calibration:         fmt(addDays(today, -90)),
    calibration_due:          fmt(addDays(today, 90)),
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  {
    equipment_code:           'EQ-FBD-001',
    equipment_name:           'Fluid Bed Dryer 120kg',
    equipment_type:           'Dryer',
    manufacturer:             'Glatt',
    model:                    'GPCG-120',
    serial_number:            'GL-GPCG-2021-0078',
    location:                 'Building A / Room 202',
    area:                     'Solid Dosage',
    gmp_critical:             true,
    calibration_interval_days: 365,
    last_calibration:         fmt(addDays(today, -120)),
    calibration_due:          fmt(addDays(today, 245)),
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  // ── Blending ─────────────────────────────────────────────────────────────
  {
    equipment_code:           'EQ-BLD-001',
    equipment_name:           'V-Blender 500L',
    equipment_type:           'Blender',
    manufacturer:             'GEA',
    model:                    'VB-500',
    serial_number:            'GEA-VB500-2020-0091',
    location:                 'Building A / Room 203',
    area:                     'Solid Dosage',
    gmp_critical:             true,
    calibration_interval_days: 365,
    last_calibration:         fmt(addDays(today, -200)),
    calibration_due:          fmt(addDays(today, 165)),
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  // ── Compression ──────────────────────────────────────────────────────────
  {
    equipment_code:           'EQ-TAB-001',
    equipment_name:           'Rotary Tablet Press 45-Station',
    equipment_type:           'Tablet Press',
    manufacturer:             'Fette',
    model:                    'P3010',
    serial_number:            'FP-2023-1188',
    location:                 'Building A / Room 301',
    area:                     'Compression',
    gmp_critical:             true,
    calibration_interval_days: 180,
    last_calibration:         fmt(addDays(today, -30)),
    calibration_due:          fmt(addDays(today, 150)),
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  {
    equipment_code:           'EQ-TAB-002',
    equipment_name:           'Rotary Tablet Press 27-Station',
    equipment_type:           'Tablet Press',
    manufacturer:             'Korsch',
    model:                    'XL 100',
    serial_number:            'KOR-XL100-2019-0055',
    location:                 'Building A / Room 302',
    area:                     'Compression',
    gmp_critical:             true,
    calibration_interval_days: 180,
    last_calibration:         fmt(addDays(today, -200)),
    calibration_due:          fmt(addDays(today, -20)),  // OVERDUE
    qualification_status:     'Requalification',
    status:                   'Out of Service',
  },
  // ── Coating ──────────────────────────────────────────────────────────────
  {
    equipment_code:           'EQ-COT-001',
    equipment_name:           'Perforated Coating Pan 60"',
    equipment_type:           'Coater',
    manufacturer:             'Thomas Engineering',
    model:                    'Accela-Cota 60',
    serial_number:            'TE-AC60-2021-0033',
    location:                 'Building B / Room 110',
    area:                     'Coating',
    gmp_critical:             true,
    calibration_interval_days: 365,
    last_calibration:         fmt(addDays(today, -60)),
    calibration_due:          fmt(addDays(today, 305)),
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  // ── Weighing / QC ────────────────────────────────────────────────────────
  {
    equipment_code:           'EQ-BAL-001',
    equipment_name:           'Analytical Balance 220g',
    equipment_type:           'Balance',
    manufacturer:             'Mettler Toledo',
    model:                    'XPR225',
    serial_number:            'MT-XPR-2024-5512',
    location:                 'QC Lab / Room 401',
    area:                     'Quality Control',
    gmp_critical:             true,
    calibration_interval_days: 180,
    last_calibration:         fmt(addDays(today, -10)),
    calibration_due:          fmt(addDays(today, 170)),
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  {
    equipment_code:           'EQ-BAL-002',
    equipment_name:           'Platform Balance 15kg',
    equipment_type:           'Balance',
    manufacturer:             'Mettler Toledo',
    model:                    'ICS465',
    serial_number:            'MT-ICS-2023-3301',
    location:                 'Dispensing / Room 102',
    area:                     'Dispensing',
    gmp_critical:             true,
    calibration_interval_days: 90,
    last_calibration:         fmt(addDays(today, -85)),
    calibration_due:          fmt(addDays(today, 5)),   // DUE SOON
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  // ── Packaging ────────────────────────────────────────────────────────────
  {
    equipment_code:           'EQ-BLI-001',
    equipment_name:           'Blister Packaging Machine',
    equipment_type:           'Packaging',
    manufacturer:             'IMA',
    model:                    'Blista 30',
    serial_number:            'IMA-B30-2020-0017',
    location:                 'Building C / Room 501',
    area:                     'Packaging',
    gmp_critical:             false,
    calibration_interval_days: 365,
    last_calibration:         fmt(addDays(today, -180)),
    calibration_due:          fmt(addDays(today, 185)),
    qualification_status:     'Qualified',
    status:                   'Available',
  },
  // ── Under Qualification ───────────────────────────────────────────────────
  {
    equipment_code:           'EQ-MIL-001',
    equipment_name:           'Cone Mill / Comil 197S',
    equipment_type:           'Mill',
    manufacturer:             'Quadro Engineering',
    model:                    'Comil 197S',
    serial_number:            'QE-197S-2024-0008',
    location:                 'Building A / Room 204',
    area:                     'Solid Dosage',
    gmp_critical:             true,
    calibration_interval_days: 365,
    last_calibration:         null,
    calibration_due:          null,
    qualification_status:     'IQ',
    status:                   'New',
  },
];

async function seedEquipment() {
  console.log('\n  PharmaMES.AI — Equipment Seed');
  console.log('  ================================\n');

  await runMigrations();

  console.log('  -> Seeding ' + EQUIPMENT.length + ' equipment records...\n');

  for (const eq of EQUIPMENT) {
    try {
      const r = await query(
        `INSERT INTO equipment
           (equipment_code, equipment_name, equipment_type, manufacturer, model,
            serial_number, location, area, gmp_critical, calibration_interval_days,
            last_calibration, calibration_due, qualification_status, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (equipment_code) DO UPDATE SET
           equipment_name        = EXCLUDED.equipment_name,
           qualification_status  = EXCLUDED.qualification_status,
           status                = EXCLUDED.status,
           calibration_due       = EXCLUDED.calibration_due,
           updated_at            = NOW()
         RETURNING id, equipment_code, equipment_name, status, qualification_status`,
        [
          eq.equipment_code, eq.equipment_name, eq.equipment_type,
          eq.manufacturer, eq.model, eq.serial_number,
          eq.location, eq.area, eq.gmp_critical,
          eq.calibration_interval_days, eq.last_calibration,
          eq.calibration_due, eq.qualification_status, eq.status,
        ]
      );

      const icon = eq.status === 'Available' ? '✓' :
                   eq.status === 'Out of Service' ? '!' : '~';
      console.log(`     ${icon} ${r.rows[0].equipment_code.padEnd(14)} ${r.rows[0].equipment_name.padEnd(40)} [${r.rows[0].status}]`);

    } catch (err) {
      console.error('     ✗ Failed:', eq.equipment_code, err.message);
    }
  }

  // Summary
  const stats = await query(`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE status='Available') as available,
      COUNT(*) FILTER (WHERE status='Out of Service') as out_of_service,
      COUNT(*) FILTER (WHERE status='Under Qualification') as qualifying,
      COUNT(*) FILTER (WHERE calibration_due < NOW()) as cal_overdue,
      COUNT(*) FILTER (WHERE calibration_due BETWEEN NOW() AND NOW() + INTERVAL '30 days') as cal_due_soon,
      COUNT(*) FILTER (WHERE gmp_critical=true) as gmp_critical
    FROM equipment
  `);

  const s = stats.rows[0];
  console.log('\n  Equipment summary:');
  console.log(`  Total: ${s.total}  |  Available: ${s.available}  |  Out of Service: ${s.out_of_service}  |  Qualifying: ${s.qualifying}`);
  console.log(`  GMP Critical: ${s.gmp_critical}  |  Cal Overdue: ${s.cal_overdue}  |  Cal Due Soon: ${s.cal_due_soon}`);
  console.log('');

  process.exit(0);
}

seedEquipment().catch(function(err) {
  console.error('\n  [FATAL] Equipment seed failed:', err.message);
  process.exit(1);
});
