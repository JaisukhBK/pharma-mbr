-- Pharma-MBR | Migration: New Modules
-- DevCAPA, Equipment, Batch Genealogy, KPIs

-- ═══ DEVCAPA: STANDALONE DEVIATIONS ═══
CREATE TABLE IF NOT EXISTS deviations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deviation_number VARCHAR(50) UNIQUE,
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  deviation_type  VARCHAR(50) DEFAULT 'Process'
                  CHECK (deviation_type IN ('Process','Quality','Safety','Equipment','Material','Documentation','Regulatory','Other')),
  severity        VARCHAR(20) DEFAULT 'Minor'
                  CHECK (severity IN ('Minor','Major','Critical')),
  source          VARCHAR(50) DEFAULT 'Manual'
                  CHECK (source IN ('Manual','EBR','IPC','Audit','Customer Complaint','Regulatory','Other')),
  source_ref_id   UUID,
  source_ref_type VARCHAR(50),
  product_name    VARCHAR(255),
  batch_number    VARCHAR(100),
  area            VARCHAR(100),
  root_cause      TEXT,
  immediate_action TEXT,
  status          VARCHAR(30) DEFAULT 'Open'
                  CHECK (status IN ('Open','Investigating','Pending CAPA','Closed','Cancelled')),
  reported_by     UUID NOT NULL REFERENCES users(id),
  assigned_to     UUID REFERENCES users(id),
  closed_by       UUID REFERENCES users(id),
  closed_at       TIMESTAMPTZ,
  due_date        DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dev_status ON deviations(status);
CREATE INDEX IF NOT EXISTS idx_dev_batch ON deviations(batch_number);

-- Auto-generate deviation numbers
CREATE OR REPLACE FUNCTION gen_deviation_number() RETURNS TRIGGER AS $$
BEGIN
  NEW.deviation_number := 'DEV-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(
    (SELECT COALESCE(MAX(CAST(SUBSTRING(deviation_number FROM 10) AS INT)), 0) + 1
     FROM deviations WHERE deviation_number LIKE 'DEV-' || TO_CHAR(NOW(), 'YYYY') || '-%')::TEXT, 4, '0');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_dev_number ON deviations;
CREATE TRIGGER trg_dev_number BEFORE INSERT ON deviations FOR EACH ROW WHEN (NEW.deviation_number IS NULL) EXECUTE FUNCTION gen_deviation_number();

-- ═══ DEVCAPA: CAPAs ═══
CREATE TABLE IF NOT EXISTS capas (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  capa_number     VARCHAR(50) UNIQUE,
  deviation_id    UUID REFERENCES deviations(id),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  capa_type       VARCHAR(20) DEFAULT 'Corrective'
                  CHECK (capa_type IN ('Corrective','Preventive')),
  priority        VARCHAR(20) DEFAULT 'Medium'
                  CHECK (priority IN ('Low','Medium','High','Critical')),
  root_cause      TEXT,
  action_plan     TEXT,
  effectiveness_criteria TEXT,
  status          VARCHAR(30) DEFAULT 'Open'
                  CHECK (status IN ('Open','In Progress','Pending Verification','Effective','Closed','Cancelled')),
  assigned_to     UUID REFERENCES users(id),
  verified_by     UUID REFERENCES users(id),
  verified_at     TIMESTAMPTZ,
  due_date        DATE,
  closed_at       TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_capa_status ON capas(status);

CREATE OR REPLACE FUNCTION gen_capa_number() RETURNS TRIGGER AS $$
BEGIN
  NEW.capa_number := 'CAPA-' || TO_CHAR(NOW(), 'YYYY') || '-' || LPAD(
    (SELECT COALESCE(MAX(CAST(SUBSTRING(capa_number FROM 11) AS INT)), 0) + 1
     FROM capas WHERE capa_number LIKE 'CAPA-' || TO_CHAR(NOW(), 'YYYY') || '-%')::TEXT, 4, '0');
  RETURN NEW;
END; $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_capa_number ON capas;
CREATE TRIGGER trg_capa_number BEFORE INSERT ON capas FOR EACH ROW WHEN (NEW.capa_number IS NULL) EXECUTE FUNCTION gen_capa_number();

-- ═══ EQUIPMENT REGISTRY ═══
CREATE TABLE IF NOT EXISTS equipment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_code  VARCHAR(100) UNIQUE NOT NULL,
  equipment_name  VARCHAR(255) NOT NULL,
  equipment_type  VARCHAR(100),
  manufacturer    VARCHAR(255),
  model           VARCHAR(255),
  serial_number   VARCHAR(100),
  location        VARCHAR(255),
  area            VARCHAR(100),
  status          VARCHAR(30) DEFAULT 'Available'
                  CHECK (status IN ('Available','In Use','Maintenance','Calibration Due','Out of Service','Retired')),
  qualification_status VARCHAR(30) DEFAULT 'Qualified'
                  CHECK (qualification_status IN ('Qualified','Pending','Expired','Not Required')),
  calibration_due DATE,
  last_calibration DATE,
  calibration_interval_days INT DEFAULT 365,
  clean_status    VARCHAR(20) DEFAULT 'Clean'
                  CHECK (clean_status IN ('Clean','Dirty','Not Applicable')),
  gmp_critical    BOOLEAN DEFAULT false,
  installed_at    DATE,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equip_status ON equipment(status);
CREATE INDEX IF NOT EXISTS idx_equip_cal ON equipment(calibration_due);

-- ═══ EQUIPMENT CALIBRATIONS ═══
CREATE TABLE IF NOT EXISTS equipment_calibrations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  equipment_id    UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
  calibration_date DATE NOT NULL,
  next_due        DATE NOT NULL,
  performed_by    VARCHAR(255),
  certificate_ref VARCHAR(100),
  result          VARCHAR(20) DEFAULT 'Pass' CHECK (result IN ('Pass','Fail','Adjusted')),
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ═══ MATERIAL LOTS (for genealogy) ═══
CREATE TABLE IF NOT EXISTS material_lots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_code   VARCHAR(100) NOT NULL,
  material_name   VARCHAR(255) NOT NULL,
  lot_number      VARCHAR(100) UNIQUE NOT NULL,
  supplier        VARCHAR(255),
  received_date   DATE,
  expiry_date     DATE,
  quantity_received NUMERIC(12,4),
  quantity_remaining NUMERIC(12,4),
  unit            VARCHAR(50),
  status          VARCHAR(30) DEFAULT 'Quarantine'
                  CHECK (status IN ('Quarantine','Released','Rejected','Expired','Consumed')),
  coa_reference   VARCHAR(100),
  storage_conditions VARCHAR(100),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lot_number ON material_lots(lot_number);
CREATE INDEX IF NOT EXISTS idx_lot_status ON material_lots(status);

-- ═══ BATCH GENEALOGY LINKS ═══
CREATE TABLE IF NOT EXISTS batch_genealogy (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_number    VARCHAR(100) NOT NULL,
  ebr_id          UUID REFERENCES ebrs(id),
  material_lot_id UUID REFERENCES material_lots(id),
  lot_number      VARCHAR(100) NOT NULL,
  material_name   VARCHAR(255),
  quantity_used   NUMERIC(12,4),
  unit            VARCHAR(50),
  link_type       VARCHAR(30) DEFAULT 'Input'
                  CHECK (link_type IN ('Input','Output','Intermediate','Rework')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_genealogy_batch ON batch_genealogy(batch_number);
CREATE INDEX IF NOT EXISTS idx_genealogy_lot ON batch_genealogy(lot_number);

-- ═══ PRODUCT REGISTRY (for KPIs) ═══
CREATE TABLE IF NOT EXISTS products (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_code    VARCHAR(100) UNIQUE NOT NULL,
  product_name    VARCHAR(255) NOT NULL,
  dosage_form     VARCHAR(100),
  strength        VARCHAR(100),
  active_mbr_id   UUID REFERENCES mbrs(id),
  status          VARCHAR(20) DEFAULT 'Active' CHECK (status IN ('Active','Discontinued','Development')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
