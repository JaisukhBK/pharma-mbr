-- Pharma-MBR | Migration: Features 1-11
-- Run this after the base schema.sql

-- ═══ Feature 7: Batch Type + Feature 9: Mandatory Fields ═══
ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS sl_no SERIAL;
ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS strength VARCHAR(100);
ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS market VARCHAR(100);
ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS batch_type VARCHAR(30) DEFAULT 'Production'
  CHECK (batch_type IN ('Validation','Commercial','Production','Testing','Filing'));

-- ═══ Feature 5: Shelf Life + Feature 6: Material Number ═══
ALTER TABLE mbr_bom_items ADD COLUMN IF NOT EXISTS material_number VARCHAR(50);
ALTER TABLE mbr_bom_items ADD COLUMN IF NOT EXISTS shelf_life_months INT;
ALTER TABLE mbr_bom_items ADD COLUMN IF NOT EXISTS shelf_life_conditions VARCHAR(100);
ALTER TABLE mbr_bom_items ADD COLUMN IF NOT EXISTS retest_interval_months INT;
ALTER TABLE mbr_bom_items ADD COLUMN IF NOT EXISTS storage_conditions VARCHAR(100);
ALTER TABLE mbr_bom_items ADD COLUMN IF NOT EXISTS sap_batch_number VARCHAR(50);

-- ═══ Feature 8: Superseding at Unit Procedure Level ═══
ALTER TABLE mbr_phases ADD COLUMN IF NOT EXISTS superseded_by UUID REFERENCES mbr_phases(id);
ALTER TABLE mbr_phases ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ;
ALTER TABLE mbr_phases ADD COLUMN IF NOT EXISTS supersede_reason TEXT;
ALTER TABLE mbr_phases ADD COLUMN IF NOT EXISTS phase_version INT DEFAULT 1;
ALTER TABLE mbr_phases ADD COLUMN IF NOT EXISTS phase_status VARCHAR(20) DEFAULT 'Active'
  CHECK (phase_status IN ('Active','Superseded','Draft'));

-- ═══ Feature 10: Complex Formula Storage ═══
CREATE TABLE IF NOT EXISTS mbr_formulas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id        UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  step_id       UUID REFERENCES mbr_steps(id) ON DELETE SET NULL,
  formula_name  VARCHAR(255) NOT NULL,
  formula_type  VARCHAR(30) DEFAULT 'simple'
                CHECK (formula_type IN ('simple','complex','calculus','excel_ref','xml_ref')),
  expression    TEXT NOT NULL,
  variables     JSONB DEFAULT '{}',
  result_unit   VARCHAR(50),
  description   TEXT,
  validation_result JSONB,
  last_trial_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_formulas_mbr ON mbr_formulas(mbr_id);

-- ═══ Feature 3: Multi-Document Attachments ═══
CREATE TABLE IF NOT EXISTS mbr_attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id         UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  filename       VARCHAR(255) NOT NULL,
  file_type      VARCHAR(30) NOT NULL
                 CHECK (file_type IN ('pdf','xml','xlsx','docx','png','jpg','jpeg','csv','txt')),
  file_size      INT,
  file_hash      VARCHAR(128),
  file_path      TEXT,
  content_text   TEXT,
  ai_analysis    JSONB,
  uploaded_by    UUID REFERENCES users(id),
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_attachments_mbr ON mbr_attachments(mbr_id);

-- ═══ Feature 4: SAP COOSPI Integration Reference ═══
ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS sap_recipe_id VARCHAR(50);
ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS sap_material_number VARCHAR(50);
ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS coospi_reference JSONB DEFAULT '{}';

SELECT 'Migration complete: Features 1-11' AS result;
