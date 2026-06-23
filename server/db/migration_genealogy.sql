-- migration_genealogy.sql — Material Genealogy & Traceability
-- Run: node -e "require('dotenv').config();const pg=require('pg');const fs=require('fs');const c=new pg.Client({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false}});c.connect().then(()=>c.query(fs.readFileSync('db/migration_genealogy.sql','utf8'))).then(()=>{console.log('Done');c.end()}).catch(e=>{console.error(e.message);c.end()})"

-- 1. MATERIAL MASTER — all raw materials, APIs, excipients, packaging
CREATE TABLE IF NOT EXISTS material_master (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code       VARCHAR(50) UNIQUE NOT NULL,
  material_name       VARCHAR(255) NOT NULL,
  material_type       VARCHAR(30) DEFAULT 'Raw Material'
                      CHECK (material_type IN ('API','Excipient','Raw Material','Packaging','Solvent','Intermediate','Finished Good')),
  cas_number          VARCHAR(30),
  grade               VARCHAR(50),
  supplier            VARCHAR(255),
  supplier_code       VARCHAR(50),
  unit                VARCHAR(20) DEFAULT 'kg',
  retest_interval_days INT,
  shelf_life_months   INT,
  storage_conditions  VARCHAR(100),
  min_stock           NUMERIC(12,4),
  is_controlled       BOOLEAN DEFAULT false,
  is_active           BOOLEAN DEFAULT true,
  created_by          UUID REFERENCES users(id),
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_matmaster_code ON material_master(material_code);
CREATE INDEX IF NOT EXISTS idx_matmaster_type ON material_master(material_type);

-- 2. MATERIAL LOTS — individual lot/batch tracking
CREATE TABLE IF NOT EXISTS material_lots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id         UUID NOT NULL REFERENCES material_master(id) ON DELETE CASCADE,
  lot_number          VARCHAR(50) NOT NULL,
  supplier_lot        VARCHAR(50),
  quantity_received   NUMERIC(12,4) NOT NULL,
  quantity_available  NUMERIC(12,4) NOT NULL,
  unit                VARCHAR(20) DEFAULT 'kg',
  received_date       DATE NOT NULL,
  manufacture_date    DATE,
  expiry_date         DATE,
  retest_date         DATE,
  coa_reference       VARCHAR(100),
  coa_status          VARCHAR(20) DEFAULT 'Pending'
                      CHECK (coa_status IN ('Pending','Approved','Rejected','Expired')),
  status              VARCHAR(20) DEFAULT 'Quarantine'
                      CHECK (status IN ('Quarantine','Released','Rejected','Expired','Consumed','Returned')),
  warehouse_location  VARCHAR(100),
  received_by         UUID REFERENCES users(id),
  released_by         UUID REFERENCES users(id),
  released_at         TIMESTAMPTZ,
  notes               TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(material_id, lot_number)
);
CREATE INDEX IF NOT EXISTS idx_matlot_material ON material_lots(material_id);
CREATE INDEX IF NOT EXISTS idx_matlot_status ON material_lots(status);
CREATE INDEX IF NOT EXISTS idx_matlot_expiry ON material_lots(expiry_date);

-- 3. MATERIAL TRANSACTIONS — every movement (dispensing, consumption, returns)
CREATE TABLE IF NOT EXISTS material_transactions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lot_id              UUID NOT NULL REFERENCES material_lots(id),
  material_id         UUID NOT NULL REFERENCES material_master(id),
  transaction_type    VARCHAR(20) NOT NULL
                      CHECK (transaction_type IN ('Receive','Dispense','Consume','Return','Adjust','Dispose','Sample')),
  quantity            NUMERIC(12,4) NOT NULL,
  unit                VARCHAR(20) DEFAULT 'kg',
  batch_number        VARCHAR(50),
  ebr_id              UUID REFERENCES ebrs(id),
  mbr_step_id         UUID REFERENCES mbr_steps(id),
  performed_by        UUID REFERENCES users(id),
  reason              TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mattxn_lot ON material_transactions(lot_id);
CREATE INDEX IF NOT EXISTS idx_mattxn_batch ON material_transactions(batch_number);
CREATE INDEX IF NOT EXISTS idx_mattxn_ebr ON material_transactions(ebr_id);

-- 4. BATCH GENEALOGY — links finished batches to material lots consumed
CREATE TABLE IF NOT EXISTS batch_genealogy (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id              UUID REFERENCES ebrs(id),
  batch_number        VARCHAR(50) NOT NULL,
  product_name        VARCHAR(255),
  material_id         UUID NOT NULL REFERENCES material_master(id),
  lot_id              UUID NOT NULL REFERENCES material_lots(id),
  quantity_used       NUMERIC(12,4),
  unit                VARCHAR(20),
  step_name           VARCHAR(255),
  consumed_at         TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_genealogy_batch ON batch_genealogy(batch_number);
CREATE INDEX IF NOT EXISTS idx_genealogy_lot ON batch_genealogy(lot_id);
CREATE INDEX IF NOT EXISTS idx_genealogy_material ON batch_genealogy(material_id);
