// run-env-migration.js — Run from server folder: node run-env-migration.js
require('dotenv').config();
const pg = require('pg');
const fs = require('fs');

async function run() {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  console.log('Connected.\n');

  const sql = fs.readFileSync(__dirname + '/db/migration_env_monitoring.sql', 'utf8');
  const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);

  for (const stmt of statements) {
    try {
      await client.query(stmt);
      const match = stmt.match(/(?:CREATE TABLE|CREATE INDEX).*?(?:IF NOT EXISTS\s+)?(\w+)/i);
      console.log(`✓ ${match ? match[1] : 'OK'}`);
    } catch (e) {
      if (e.message.includes('already exists')) console.log(`⊘ Already exists`);
      else console.error(`✗ ${e.message.substring(0, 80)}`);
    }
  }

  console.log('\n=== VERIFICATION ===');
  for (const table of ['env_zones', 'env_sensors', 'env_readings', 'env_alerts', 'env_bms_connections']) {
    const r = await client.query(`SELECT COUNT(*) as cnt FROM ${table}`).catch(() => ({ rows: [{ cnt: 'MISSING' }] }));
    console.log(`  ${table}: ${r.rows[0].cnt} rows`);
  }

  // Fix column sizes if tables already exist from previous run
  try {
    await client.query('ALTER TABLE env_zones ALTER COLUMN gmp_grade TYPE VARCHAR(20)');
    console.log('✓ Fixed gmp_grade column size');
  } catch (e) { /* already correct or table doesn't exist */ }

  // Seed demo zones and sensors if empty
  const zoneCount = await client.query('SELECT COUNT(*) as cnt FROM env_zones');
  if (parseInt(zoneCount.rows[0].cnt) < 5) {
    console.log('\n=== SEEDING DEMO DATA ===');
    const zones = [
      { code: 'CR-A-101', name: 'Clean Room A-101 (Dispensing)', type: 'Dispensing', iso: 'ISO 7', grade: 'C', building: 'A', floor: '1' },
      { code: 'CR-A-102', name: 'Clean Room A-102 (Granulation)', type: 'Production', iso: 'ISO 8', grade: 'D', building: 'A', floor: '1' },
      { code: 'CR-B-201', name: 'Clean Room B-201 (Compression)', type: 'Production', iso: 'ISO 8', grade: 'D', building: 'B', floor: '2' },
      { code: 'WH-001',   name: 'Warehouse Area 1 (RM Storage)', type: 'Warehouse', iso: null, grade: 'Unclassified', building: 'C', floor: 'G' },
      { code: 'QC-LAB-01', name: 'QC Laboratory 01', type: 'QC Lab', iso: 'ISO 7', grade: 'C', building: 'A', floor: '2' },
    ];

    for (const z of zones) {
      const r = await client.query(
        `INSERT INTO env_zones (zone_code, zone_name, zone_type, iso_class, gmp_grade, building, floor) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (zone_code) DO NOTHING RETURNING id`,
        [z.code, z.name, z.type, z.iso, z.grade, z.building, z.floor]);
      
      // Get zone ID (whether just inserted or already existed)
      let zId;
      if (r.rows.length > 0) {
        zId = r.rows[0].id;
      } else {
        const existing = await client.query('SELECT id FROM env_zones WHERE zone_code=$1', [z.code]);
        if (existing.rows.length === 0) continue;
        zId = existing.rows[0].id;
      }

      // Check if sensors already exist for this zone
      const sensorCount = await client.query('SELECT COUNT(*) as cnt FROM env_sensors WHERE zone_id=$1', [zId]);
      if (parseInt(sensorCount.rows[0].cnt) > 0) {
        console.log(`  ⊘ Zone: ${z.code} (already has sensors)`);
        continue;
      }

      // Add standard sensors per zone
      const sensors = [
        { code: z.code + '-TEMP', name: 'Temperature', type: 'Temperature', unit: '°C', low: 18, high: 25, lowA: 17, highA: 26, tag: z.code + '.TEMP.PV' },
        { code: z.code + '-RH', name: 'Relative Humidity', type: 'Humidity', unit: '%RH', low: 30, high: 65, lowA: 25, highA: 70, tag: z.code + '.RH.PV' },
        { code: z.code + '-DP', name: 'Differential Pressure', type: 'DiffPressure', unit: 'Pa', low: 5, high: 60, lowA: 3, highA: 65, tag: z.code + '.DP.PV' },
      ];
      if (z.iso) sensors.push({ code: z.code + '-PC05', name: 'Particle Count ≥0.5µm', type: 'ParticleCount_0.5um', unit: 'p/m³', low: 0, high: z.grade === 'C' ? 3520000 : 352000, lowA: 0, highA: z.grade === 'C' ? 3520000 : 352000, tag: z.code + '.PC05.PV' });

      for (const s of sensors) {
        await client.query(
          `INSERT INTO env_sensors (zone_id, sensor_code, sensor_name, parameter_type, unit, low_limit, high_limit, low_alert, high_alert, bms_tag, is_critical) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [zId, s.code, s.name, s.type, s.unit, s.low, s.high, s.lowA, s.highA, s.tag, s.type === 'ParticleCount_0.5um']);
      }
      console.log(`  ✓ Zone: ${z.code} + ${sensors.length} sensors`);
    }
  }

  await client.end();
  console.log('\nDone.');
}
run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
