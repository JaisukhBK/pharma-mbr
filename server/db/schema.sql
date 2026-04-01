-- Pharma-MBR | Neon PostgreSQL Schema (Unified)
-- Merged from: schema.sql + migration_v2.sql
-- ISA-88 Procedural Hierarchy | 21 CFR Part 11 | GAMP5 Cat.5
-- All tables + migration columns in one idempotent DDL

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. USERS (Part 11 §11.10(d))
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(255) NOT NULL,
  role          VARCHAR(50) NOT NULL DEFAULT 'designer'
                CHECK (role IN ('admin','designer','qa_reviewer','production_operator','viewer')),
  department    VARCHAR(100),
  employee_id   VARCHAR(50),
  is_active     BOOLEAN DEFAULT true,
  last_login_at TIMESTAMPTZ,
  login_attempts INT DEFAULT 0,
  locked_until  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 2. MASTER BATCH RECORDS (ISA-88 Procedure | 21 CFR 211.186)
--    Includes Feature 7 (batch_type), Feature 9 (mandatory fields), Feature 4 (SAP/COOSPI)
CREATE TABLE IF NOT EXISTS mbrs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_code            VARCHAR(50) UNIQUE NOT NULL,
  product_name        VARCHAR(255) NOT NULL,
  product_code        VARCHAR(50),
  dosage_form         VARCHAR(50) DEFAULT 'Tablet',
  batch_size          NUMERIC(12,2),
  batch_size_unit     VARCHAR(20) DEFAULT 'kg',
  description         TEXT,
  status              VARCHAR(30) DEFAULT 'Draft'
                      CHECK (status IN ('Draft','In Review','Approved','Effective','Superseded','Obsolete')),
  current_version     INT DEFAULT 1,
  target_yield        NUMERIC(5,2),
  -- Feature 7: Batch Type + Feature 9: Mandatory Fields
  strength            VARCHAR(100),
  market              VARCHAR(100),
  batch_type          VARCHAR(30) DEFAULT 'Production'
                      CHECK (batch_type IN ('Validation','Commercial','Production','Testing','Filing')),
  -- Feature 4: SAP COOSPI Integration Reference
  sap_recipe_id       VARCHAR(50),
  sap_material_number VARCHAR(50),
  coospi_reference    JSONB DEFAULT '{}',
  --
  created_by      UUID REFERENCES users(id),
  approved_by     UUID REFERENCES users(id),
  approved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mbrs_status ON mbrs(status);

-- Auto-incrementing serial number (Feature 9)
-- NOTE: If upgrading from base schema, run: ALTER TABLE mbrs ADD COLUMN IF NOT EXISTS sl_no SERIAL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='mbrs' AND column_name='sl_no') THEN
    ALTER TABLE mbrs ADD COLUMN sl_no SERIAL;
  END IF;
END $$;

-- 3. MBR VERSIONS (Part 11 §11.10(e))
CREATE TABLE IF NOT EXISTS mbr_versions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id        UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  version       INT NOT NULL,
  change_reason TEXT NOT NULL,
  snapshot      JSONB NOT NULL,
  content_hash  VARCHAR(128) NOT NULL,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(mbr_id, version)
);

-- 4. PHASES (ISA-88 Unit Procedure)
--    Includes Feature 8: Superseding at Unit Procedure Level
CREATE TABLE IF NOT EXISTS mbr_phases (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  phase_number    INT NOT NULL,
  phase_name      VARCHAR(255) NOT NULL,
  description     TEXT,
  sort_order      INT NOT NULL DEFAULT 0,
  -- Feature 8: Phase-level versioning & superseding
  phase_version   INT DEFAULT 1,
  phase_status    VARCHAR(20) DEFAULT 'Active'
                  CHECK (phase_status IN ('Active','Superseded','Draft')),
  superseded_by   UUID REFERENCES mbr_phases(id),
  superseded_at   TIMESTAMPTZ,
  supersede_reason TEXT,
  --
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_phases_mbr ON mbr_phases(mbr_id);

-- 5. STEPS (ISA-88 Operation) — JSONB columns for weighing/sampling/yield/hold/env/l2
CREATE TABLE IF NOT EXISTS mbr_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phase_id        UUID NOT NULL REFERENCES mbr_phases(id) ON DELETE CASCADE,
  mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  step_number     INT NOT NULL,
  step_name       VARCHAR(255) NOT NULL,
  instruction     TEXT,
  step_type       VARCHAR(30) DEFAULT 'Processing',
  duration_min    INT,
  is_critical     BOOLEAN DEFAULT false,
  is_gmp_critical BOOLEAN DEFAULT false,
  sort_order      INT NOT NULL DEFAULT 0,
  weighing_config JSONB DEFAULT '{"instructions":[]}',
  sampling_plan   JSONB DEFAULT '{"samples":[]}',
  yield_config    JSONB DEFAULT '{}',
  hold_config     JSONB DEFAULT '{}',
  env_config      JSONB DEFAULT '{}',
  l2_config       JSONB DEFAULT '{"opc_tags":[],"control_modules":[],"alarms":[],"historian_tags":[],"setpoints":[]}',
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_steps_phase ON mbr_steps(phase_id);
CREATE INDEX IF NOT EXISTS idx_steps_mbr ON mbr_steps(mbr_id);

-- 6. STEP PARAMETERS (CPP/CQA)
CREATE TABLE IF NOT EXISTS mbr_step_parameters (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id      UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
  mbr_id       UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  param_name   VARCHAR(255) NOT NULL,
  param_type   VARCHAR(30) DEFAULT 'numeric',
  target_value VARCHAR(100),
  unit         VARCHAR(50),
  lower_limit  NUMERIC(12,4),
  upper_limit  NUMERIC(12,4),
  is_cpp       BOOLEAN DEFAULT false,
  is_cqa       BOOLEAN DEFAULT false,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_params_step ON mbr_step_parameters(step_id);

-- 7. STEP MATERIALS
CREATE TABLE IF NOT EXISTS mbr_step_materials (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id        UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
  mbr_id         UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  material_code  VARCHAR(50),
  material_name  VARCHAR(255) NOT NULL,
  material_type  VARCHAR(30) DEFAULT 'Raw Material',
  quantity       NUMERIC(12,4),
  unit           VARCHAR(20) DEFAULT 'kg',
  is_active      BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 8. STEP EQUIPMENT
CREATE TABLE IF NOT EXISTS mbr_step_equipment (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id         UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
  mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  equipment_code  VARCHAR(50),
  equipment_name  VARCHAR(255) NOT NULL,
  equipment_type  VARCHAR(50) DEFAULT 'Reactor',
  capacity        VARCHAR(50),
  is_primary      BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 9. IPC CHECKS
CREATE TABLE IF NOT EXISTS mbr_ipc_checks (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  step_id       UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
  mbr_id        UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  check_name    VARCHAR(255) NOT NULL,
  check_type    VARCHAR(50) DEFAULT 'Visual',
  specification VARCHAR(255),
  frequency     VARCHAR(100),
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- 10. BOM (MBR-level)
--     Includes Feature 5 (shelf life) + Feature 6 (material number)
CREATE TABLE IF NOT EXISTS mbr_bom_items (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id                UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  material_code         VARCHAR(50),
  material_name         VARCHAR(255) NOT NULL,
  quantity_per_batch    NUMERIC(12,4),
  unit                  VARCHAR(20) DEFAULT 'kg',
  tolerance_pct         NUMERIC(5,2),
  tolerance_type        VARCHAR(10) DEFAULT '±',
  overage_pct           NUMERIC(5,2) DEFAULT 0,
  supplier              VARCHAR(255),
  grade                 VARCHAR(50),
  is_active_ingredient  BOOLEAN DEFAULT false,
  dispensing_sequence    INT,
  phase_used            VARCHAR(255),
  sort_order            INT DEFAULT 0,
  -- Feature 5: Shelf Life + Feature 6: Material Number
  material_number       VARCHAR(50),
  shelf_life_months     INT,
  shelf_life_conditions VARCHAR(100),
  retest_interval_months INT,
  storage_conditions    VARCHAR(100),
  sap_batch_number      VARCHAR(50),
  --
  created_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_bom_mbr ON mbr_bom_items(mbr_id);

-- 11. ELECTRONIC SIGNATURES (Part 11 §11.50/§11.70/§11.200)
CREATE TABLE IF NOT EXISTS mbr_signatures (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id            UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  signer_id         UUID NOT NULL REFERENCES users(id),
  signer_email      VARCHAR(255) NOT NULL,
  signature_role    VARCHAR(30) NOT NULL
                    CHECK (signature_role IN ('Author','Reviewer','Approver','QA_Approver')),
  signature_meaning TEXT NOT NULL,
  content_hash      VARCHAR(128) NOT NULL,
  password_verified BOOLEAN DEFAULT false,
  signed_at         TIMESTAMPTZ DEFAULT NOW(),
  ip_address        VARCHAR(45)
);

-- 12. AUDIT TRAIL (Part 11 §11.10(e) — append-only)
CREATE TABLE IF NOT EXISTS audit_trail (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id),
  user_email    VARCHAR(255),
  action        VARCHAR(30) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_id   UUID,
  details       TEXT,
  old_value     JSONB,
  new_value     JSONB,
  change_reason TEXT,
  ip_address    VARCHAR(45),
  user_agent    TEXT,
  ai_generated  BOOLEAN DEFAULT false,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_trail(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_trail(created_at DESC);

-- 13. CO-DESIGNER SESSIONS (GAMP5 Cat.5)
CREATE TABLE IF NOT EXISTS co_designer_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  mode            VARCHAR(20) DEFAULT 'off' CHECK (mode IN ('off','assist','co_design')),
  source_pdf_name TEXT,
  source_pdf_hash VARCHAR(128),
  status          VARCHAR(30) DEFAULT 'idle'
                  CHECK (status IN ('idle','parsing','decomposing','proposing','awaiting_review','completed','error')),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 14. CO-DESIGNER PROPOSALS
CREATE TABLE IF NOT EXISTS co_designer_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES co_designer_sessions(id) ON DELETE CASCADE,
  mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  proposal_type   VARCHAR(30) NOT NULL,
  proposed_data   JSONB NOT NULL,
  confidence      NUMERIC(3,2),
  reasoning       TEXT,
  status          VARCHAR(20) DEFAULT 'pending'
                  CHECK (status IN ('pending','accepted','modified','rejected')),
  reviewed_by     UUID REFERENCES users(id),
  review_notes    TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_proposals_session ON co_designer_proposals(session_id);

-- 15. EBR (21 CFR 211.188)
CREATE TABLE IF NOT EXISTS ebrs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_code       VARCHAR(50) UNIQUE NOT NULL,
  mbr_id         UUID NOT NULL REFERENCES mbrs(id),
  batch_number   VARCHAR(50) NOT NULL,
  product_name   VARCHAR(255),
  batch_size     NUMERIC(12,2),
  status         VARCHAR(30) DEFAULT 'Ready'
                 CHECK (status IN ('Ready','In Progress','On Hold','Complete','Released','Rejected')),
  line           VARCHAR(50),
  operator_id    UUID REFERENCES users(id),
  started_at     TIMESTAMPTZ,
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- 16. EBR STEP EXECUTIONS
CREATE TABLE IF NOT EXISTS ebr_step_executions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  mbr_step_id     UUID REFERENCES mbr_steps(id),
  step_number     INT NOT NULL,
  step_name       VARCHAR(255),
  status          VARCHAR(20) DEFAULT 'Pending',
  operator_id     UUID REFERENCES users(id),
  verifier_id     UUID REFERENCES users(id),
  actual_values   JSONB DEFAULT '{}',
  deviation_notes TEXT,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  verified_at     TIMESTAMPTZ
);

-- 17. FORMULAS (Feature 10: Complex Formula Storage)
CREATE TABLE IF NOT EXISTS mbr_formulas (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id            UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  step_id           UUID REFERENCES mbr_steps(id) ON DELETE SET NULL,
  formula_name      VARCHAR(255) NOT NULL,
  formula_type      VARCHAR(30) DEFAULT 'simple'
                    CHECK (formula_type IN ('simple','complex','calculus','excel_ref','xml_ref')),
  expression        TEXT NOT NULL,
  variables         JSONB DEFAULT '{}',
  result_unit       VARCHAR(50),
  description       TEXT,
  validation_result JSONB,
  last_trial_at     TIMESTAMPTZ,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_formulas_mbr ON mbr_formulas(mbr_id);

-- 18. ATTACHMENTS (Feature 3: Multi-Document Upload)
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
