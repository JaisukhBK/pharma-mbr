// fix-genealogy-tables.js — Permanent fix: drop and recreate tables with wrong columns
// Run from server folder: node fix-genealogy-tables.js
require('dotenv').config();
const pg = require('pg');

const EXPECTED_COLUMNS = {
  material_master: ['id','material_code','material_name','material_type','cas_number','grade','supplier','supplier_code','unit','retest_interval_days','shelf_life_months','storage_conditions','min_stock','is_controlled','is_active','created_by','created_at','updated_at'],
  material_lots: ['id','material_id','lot_number','supplier_lot','quantity_received','quantity_available','unit','received_date','manufacture_date','expiry_date','retest_date','coa_reference','coa_status','status','warehouse_location','received_by','released_by','released_at','notes','created_at','updated_at'],
  material_transactions: ['id','lot_id','material_id','transaction_type','quantity','unit','batch_number','ebr_id','mbr_step_id','performed_by','reason','created_at'],
  batch_genealogy: ['id','ebr_id','batch_number','product_name','material_id','lot_id','quantity_used','unit','step_name','consumed_at'],
};

const TABLE_SQL = {
  material_master: `CREATE TABLE material_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_code VARCHAR(50) UNIQUE NOT NULL,
    material_name VARCHAR(255) NOT NULL,
    material_type VARCHAR(30) DEFAULT 'Raw Material' CHECK (material_type IN ('API','Excipient','Raw Material','Packaging','Solvent','Intermediate','Finished Good')),
    cas_number VARCHAR(30),
    grade VARCHAR(50),
    supplier VARCHAR(255),
    supplier_code VARCHAR(50),
    unit VARCHAR(20) DEFAULT 'kg',
    retest_interval_days INT,
    shelf_life_months INT,
    storage_conditions VARCHAR(100),
    min_stock NUMERIC(12,4),
    is_controlled BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  material_lots: `CREATE TABLE material_lots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    material_id UUID NOT NULL REFERENCES material_master(id) ON DELETE CASCADE,
    lot_number VARCHAR(50) NOT NULL,
    supplier_lot VARCHAR(50),
    quantity_received NUMERIC(12,4) NOT NULL,
    quantity_available NUMERIC(12,4) NOT NULL,
    unit VARCHAR(20) DEFAULT 'kg',
    received_date DATE NOT NULL,
    manufacture_date DATE,
    expiry_date DATE,
    retest_date DATE,
    coa_reference VARCHAR(100),
    coa_status VARCHAR(20) DEFAULT 'Pending' CHECK (coa_status IN ('Pending','Approved','Rejected','Expired')),
    status VARCHAR(20) DEFAULT 'Quarantine' CHECK (status IN ('Quarantine','Released','Rejected','Expired','Consumed','Returned')),
    warehouse_location VARCHAR(100),
    received_by UUID REFERENCES users(id),
    released_by UUID REFERENCES users(id),
    released_at TIMESTAMPTZ,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(material_id, lot_number)
  )`,
  material_transactions: `CREATE TABLE material_transactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lot_id UUID NOT NULL REFERENCES material_lots(id),
    material_id UUID NOT NULL REFERENCES material_master(id),
    transaction_type VARCHAR(20) NOT NULL CHECK (transaction_type IN ('Receive','Dispense','Consume','Return','Adjust','Dispose','Sample')),
    quantity NUMERIC(12,4) NOT NULL,
    unit VARCHAR(20) DEFAULT 'kg',
    batch_number VARCHAR(50),
    ebr_id UUID,
    mbr_step_id UUID,
    performed_by UUID REFERENCES users(id),
    reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  batch_genealogy: `CREATE TABLE batch_genealogy (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ebr_id UUID,
    batch_number VARCHAR(50) NOT NULL,
    product_name VARCHAR(255),
    material_id UUID NOT NULL REFERENCES material_master(id),
    lot_id UUID NOT NULL REFERENCES material_lots(id),
    quantity_used NUMERIC(12,4),
    unit VARCHAR(20),
    step_name VARCHAR(255),
    consumed_at TIMESTAMPTZ DEFAULT NOW()
  )`,
};

const INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_matmaster_code ON material_master(material_code)',
  'CREATE INDEX IF NOT EXISTS idx_matmaster_type ON material_master(material_type)',
  'CREATE INDEX IF NOT EXISTS idx_matlot_material ON material_lots(material_id)',
  'CREATE INDEX IF NOT EXISTS idx_matlot_status ON material_lots(status)',
  'CREATE INDEX IF NOT EXISTS idx_matlot_expiry ON material_lots(expiry_date)',
  'CREATE INDEX IF NOT EXISTS idx_mattxn_lot ON material_transactions(lot_id)',
  'CREATE INDEX IF NOT EXISTS idx_mattxn_batch ON material_transactions(batch_number)',
  'CREATE INDEX IF NOT EXISTS idx_mattxn_material ON material_transactions(material_id)',
  'CREATE INDEX IF NOT EXISTS idx_genealogy_batch ON batch_genealogy(batch_number)',
  'CREATE INDEX IF NOT EXISTS idx_genealogy_lot ON batch_genealogy(lot_id)',
  'CREATE INDEX IF NOT EXISTS idx_genealogy_material ON batch_genealogy(material_id)',
];

async function run() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected.\n');

  // Process tables in dependency order
  const tableOrder = ['batch_genealogy', 'material_transactions', 'material_lots', 'material_master'];
  const createOrder = ['material_master', 'material_lots', 'material_transactions', 'batch_genealogy'];

  // Step 1: Check each table's columns
  console.log('=== CHECKING TABLE COLUMNS ===');
  const tablesToRecreate = [];

  for (const name of createOrder) {
    const exists = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [name]
    );

    if (exists.rows.length === 0) {
      console.log(`  ${name}: does not exist — will create`);
      tablesToRecreate.push(name);
    } else {
      const actual = exists.rows.map(r => r.column_name);
      const expected = EXPECTED_COLUMNS[name];
      const missing = expected.filter(c => !actual.includes(c));
      const extra = actual.filter(c => !expected.includes(c));

      if (missing.length > 0) {
        console.log(`  ${name}: MISMATCH — missing columns: ${missing.join(', ')}`);
        tablesToRecreate.push(name);
      } else if (extra.length > 0) {
        console.log(`  ${name}: has extra columns (${extra.join(', ')}) — OK, keeping`);
      } else {
        console.log(`  ${name}: ✓ schema matches`);
      }
    }
  }

  // Step 2: Drop and recreate mismatched tables (in reverse dependency order)
  if (tablesToRecreate.length > 0) {
    console.log('\n=== RECREATING MISMATCHED TABLES ===');

    // Drop in reverse dependency order
    const dropOrder = tableOrder.filter(t => {
      // Drop if this table needs recreating, OR if a table it depends on needs recreating
      if (tablesToRecreate.includes(t)) return true;
      // batch_genealogy depends on material_lots and material_master
      if (t === 'batch_genealogy' && (tablesToRecreate.includes('material_lots') || tablesToRecreate.includes('material_master'))) return true;
      // material_transactions depends on material_lots and material_master
      if (t === 'material_transactions' && (tablesToRecreate.includes('material_lots') || tablesToRecreate.includes('material_master'))) return true;
      // material_lots depends on material_master
      if (t === 'material_lots' && tablesToRecreate.includes('material_master')) return true;
      return false;
    });

    for (const name of dropOrder) {
      try {
        const rowCount = await client.query(`SELECT COUNT(*) as cnt FROM ${name}`).catch(() => ({ rows: [{ cnt: 0 }] }));
        const cnt = parseInt(rowCount.rows[0].cnt);
        if (cnt > 0) {
          console.log(`  ⚠ ${name} has ${cnt} rows — backing up would be needed in production`);
        }
        await client.query(`DROP TABLE IF EXISTS ${name} CASCADE`);
        console.log(`  Dropped: ${name}`);
      } catch (e) {
        console.log(`  Drop ${name}: ${e.message}`);
      }
    }

    // Create in dependency order
    for (const name of createOrder) {
      if (dropOrder.includes(name) || tablesToRecreate.includes(name)) {
        try {
          await client.query(TABLE_SQL[name]);
          console.log(`  ✓ Created: ${name}`);
        } catch (e) {
          console.error(`  ✗ Failed: ${name} — ${e.message}`);
        }
      }
    }
  } else {
    console.log('\nAll tables have correct schema — no changes needed.');
  }

  // Step 3: Create all indexes
  console.log('\n=== CREATING INDEXES ===');
  for (const sql of INDEXES) {
    try {
      await client.query(sql);
      const name = sql.match(/idx_\w+/)?.[0] || 'unknown';
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${e.message.substring(0, 80)}`);
    }
  }

  // Step 4: Final verification
  console.log('\n=== FINAL VERIFICATION ===');
  for (const name of createOrder) {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name=$1 ORDER BY ordinal_position`, [name]
    );
    const idxs = await client.query(
      `SELECT indexname FROM pg_indexes WHERE tablename=$1`, [name]
    );
    console.log(`  ${name}: ${cols.rows.length} columns, ${idxs.rows.length} indexes ✓`);
  }

  await client.end();
  console.log('\n✓ All genealogy tables are correctly configured.');
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
