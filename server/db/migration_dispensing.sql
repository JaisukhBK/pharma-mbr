-- migration_dispensing.sql — Electronic Weighing & Dispensing
-- 21 CFR 211.101 — Charge-in of components
-- Run via: node run-dispensing-migration.js

-- 1. DISPENSING ORDERS — one per BOM item per batch
CREATE TABLE IF NOT EXISTS dispensing_orders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id            UUID REFERENCES ebrs(id) ON DELETE CASCADE,
  batch_number      VARCHAR(50) NOT NULL,
  material_id       UUID NOT NULL REFERENCES material_master(id),
  material_code     VARCHAR(50),
  material_name     VARCHAR(255) NOT NULL,
  target_quantity   NUMERIC(12,4) NOT NULL,
  tolerance_pct     NUMERIC(5,2) DEFAULT 2.0,
  unit              VARCHAR(20) DEFAULT 'kg',
  dispensing_sequence INT DEFAULT 0,
  status            VARCHAR(20) DEFAULT 'Pending'
                    CHECK (status IN ('Pending','In Progress','Completed','Skipped','On Hold')),
  assigned_lot_id   UUID REFERENCES material_lots(id),
  assigned_lot_number VARCHAR(50),
  dispensed_quantity NUMERIC(12,4),
  dispensed_by      UUID REFERENCES users(id),
  dispensed_at      TIMESTAMPTZ,
  verified_by       UUID REFERENCES users(id),
  verified_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_dispord_ebr ON dispensing_orders(ebr_id);
CREATE INDEX IF NOT EXISTS idx_dispord_batch ON dispensing_orders(batch_number);
CREATE INDEX IF NOT EXISTS idx_dispord_material ON dispensing_orders(material_id);
CREATE INDEX IF NOT EXISTS idx_dispord_status ON dispensing_orders(status);

-- 2. DISPENSING RECORDS — individual weighing events (tare/gross/net)
CREATE TABLE IF NOT EXISTS dispensing_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          UUID NOT NULL REFERENCES dispensing_orders(id) ON DELETE CASCADE,
  lot_id            UUID NOT NULL REFERENCES material_lots(id),
  lot_number        VARCHAR(50) NOT NULL,
  tare_weight       NUMERIC(12,4),
  gross_weight      NUMERIC(12,4),
  net_weight        NUMERIC(12,4),
  unit              VARCHAR(20) DEFAULT 'kg',
  balance_id        VARCHAR(50),
  balance_name      VARCHAR(100),
  tolerance_min     NUMERIC(12,4),
  tolerance_max     NUMERIC(12,4),
  within_tolerance  BOOLEAN,
  operator_id       UUID REFERENCES users(id),
  verifier_id       UUID REFERENCES users(id),
  verified_at       TIMESTAMPTZ,
  environment_temp  NUMERIC(5,1),
  environment_rh    NUMERIC(5,1),
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_disprec_order ON dispensing_records(order_id);
CREATE INDEX IF NOT EXISTS idx_disprec_lot ON dispensing_records(lot_id);
