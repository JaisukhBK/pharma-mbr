-- Pharma-MBR | Migration: EBR Execution Module
-- Shop floor batch execution with full traceability

-- ═══ ENHANCE EXISTING EBR TABLES ═══
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS batch_size_unit VARCHAR(30);
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS mbr_version INT DEFAULT 1;
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS theoretical_yield NUMERIC(12,2);
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS actual_yield NUMERIC(12,2);
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS yield_pct NUMERIC(6,2);
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS release_status VARCHAR(30) DEFAULT 'Pending'
  CHECK (release_status IN ('Pending','Under Review','Released','Rejected'));
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS released_by UUID REFERENCES users(id);
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS released_at TIMESTAMPTZ;
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS release_notes TEXT;
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS qa_reviewer_id UUID REFERENCES users(id);
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS qa_reviewed_at TIMESTAMPTZ;
ALTER TABLE ebrs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE ebr_step_executions ADD COLUMN IF NOT EXISTS phase_name VARCHAR(255);
ALTER TABLE ebr_step_executions ADD COLUMN IF NOT EXISTS instruction TEXT;
ALTER TABLE ebr_step_executions ADD COLUMN IF NOT EXISTS is_critical BOOLEAN DEFAULT false;
ALTER TABLE ebr_step_executions ADD COLUMN IF NOT EXISTS is_gmp_critical BOOLEAN DEFAULT false;
ALTER TABLE ebr_step_executions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;
ALTER TABLE ebr_step_executions ADD COLUMN IF NOT EXISTS duration_min INT;
ALTER TABLE ebr_step_executions ADD COLUMN IF NOT EXISTS actual_duration_min INT;

-- ═══ PARAMETER EXECUTION VALUES ═══
CREATE TABLE IF NOT EXISTS ebr_parameter_values (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  step_execution_id UUID NOT NULL REFERENCES ebr_step_executions(id) ON DELETE CASCADE,
  parameter_id    UUID REFERENCES mbr_step_parameters(id),
  param_name      VARCHAR(255) NOT NULL,
  target_value    VARCHAR(100),
  unit            VARCHAR(50),
  lower_limit     NUMERIC(12,4),
  upper_limit     NUMERIC(12,4),
  actual_value    VARCHAR(100),
  is_cpp          BOOLEAN DEFAULT false,
  is_cqa          BOOLEAN DEFAULT false,
  in_spec         BOOLEAN,
  recorded_by     UUID REFERENCES users(id),
  recorded_at     TIMESTAMPTZ DEFAULT NOW(),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ebr_params_exec ON ebr_parameter_values(step_execution_id);
CREATE INDEX IF NOT EXISTS idx_ebr_params_spec ON ebr_parameter_values(in_spec);

-- ═══ DEVIATIONS ═══
CREATE TABLE IF NOT EXISTS ebr_deviations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  step_execution_id UUID REFERENCES ebr_step_executions(id),
  parameter_value_id UUID REFERENCES ebr_parameter_values(id),
  deviation_type  VARCHAR(30) DEFAULT 'Out of Spec'
                  CHECK (deviation_type IN ('Out of Spec','Process Deviation','Equipment Failure','Material Issue','Operator Error','Other')),
  severity        VARCHAR(20) DEFAULT 'Minor'
                  CHECK (severity IN ('Minor','Major','Critical')),
  description     TEXT NOT NULL,
  expected_value  VARCHAR(100),
  actual_value    VARCHAR(100),
  immediate_action TEXT,
  root_cause      TEXT,
  corrective_action TEXT,
  status          VARCHAR(20) DEFAULT 'Open'
                  CHECK (status IN ('Open','Investigating','Resolved','Closed')),
  reported_by     UUID NOT NULL REFERENCES users(id),
  resolved_by     UUID REFERENCES users(id),
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_deviation_ebr ON ebr_deviations(ebr_id);
CREATE INDEX IF NOT EXISTS idx_deviation_status ON ebr_deviations(status);

-- ═══ MATERIAL CONSUMPTION ═══
CREATE TABLE IF NOT EXISTS ebr_material_consumptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  step_execution_id UUID REFERENCES ebr_step_executions(id),
  material_code   VARCHAR(100),
  material_name   VARCHAR(255) NOT NULL,
  lot_number      VARCHAR(100) NOT NULL,
  quantity_required NUMERIC(12,4),
  quantity_dispensed NUMERIC(12,4) NOT NULL,
  unit            VARCHAR(50) NOT NULL,
  tare_weight     NUMERIC(12,4),
  gross_weight    NUMERIC(12,4),
  net_weight      NUMERIC(12,4),
  expiry_date     DATE,
  dispensed_by    UUID NOT NULL REFERENCES users(id),
  verified_by     UUID REFERENCES users(id),
  verified_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mat_consumption_ebr ON ebr_material_consumptions(ebr_id);

-- ═══ EQUIPMENT USAGE ═══
CREATE TABLE IF NOT EXISTS ebr_equipment_usage (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  step_execution_id UUID REFERENCES ebr_step_executions(id),
  equipment_code  VARCHAR(100),
  equipment_name  VARCHAR(255) NOT NULL,
  equipment_type  VARCHAR(100),
  calibration_status VARCHAR(30) DEFAULT 'Verified'
                  CHECK (calibration_status IN ('Verified','Expired','Not Required','Pending')),
  calibration_due DATE,
  clean_status    VARCHAR(30) DEFAULT 'Clean'
                  CHECK (clean_status IN ('Clean','Dirty','Not Applicable')),
  usage_start     TIMESTAMPTZ,
  usage_end       TIMESTAMPTZ,
  logged_by       UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equip_usage_ebr ON ebr_equipment_usage(ebr_id);

-- ═══ IPC RESULTS ═══
CREATE TABLE IF NOT EXISTS ebr_ipc_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  step_execution_id UUID REFERENCES ebr_step_executions(id),
  ipc_check_id    UUID REFERENCES mbr_ipc_checks(id),
  check_name      VARCHAR(255) NOT NULL,
  check_type      VARCHAR(50),
  specification   VARCHAR(255),
  actual_result   VARCHAR(255) NOT NULL,
  unit            VARCHAR(50),
  pass_fail       VARCHAR(10) NOT NULL CHECK (pass_fail IN ('Pass','Fail','N/A')),
  tested_by       UUID NOT NULL REFERENCES users(id),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ipc_results_ebr ON ebr_ipc_results(ebr_id);

-- ═══ YIELD RECORDS ═══
CREATE TABLE IF NOT EXISTS ebr_yield_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  phase_name      VARCHAR(255) NOT NULL,
  stage           VARCHAR(50) DEFAULT 'In Process'
                  CHECK (stage IN ('In Process','Post Process','Final')),
  theoretical_qty NUMERIC(12,4) NOT NULL,
  actual_qty      NUMERIC(12,4) NOT NULL,
  unit            VARCHAR(50) NOT NULL,
  yield_pct       NUMERIC(6,2) GENERATED ALWAYS AS (
    CASE WHEN theoretical_qty > 0 THEN ROUND((actual_qty / theoretical_qty) * 100, 2) ELSE 0 END
  ) STORED,
  acceptable_range_low NUMERIC(6,2) DEFAULT 95.0,
  acceptable_range_high NUMERIC(6,2) DEFAULT 105.0,
  in_range        BOOLEAN GENERATED ALWAYS AS (
    CASE WHEN theoretical_qty > 0
      THEN ROUND((actual_qty / theoretical_qty) * 100, 2) BETWEEN 95.0 AND 105.0
      ELSE false END
  ) STORED,
  recorded_by     UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_yield_ebr ON ebr_yield_records(ebr_id);

-- ═══ BATCH RELEASE SIGNATURES ═══
CREATE TABLE IF NOT EXISTS ebr_release_signatures (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  signature_role  VARCHAR(30) NOT NULL
                  CHECK (signature_role IN ('Production Supervisor','QA Reviewer','QA Approver','Authorized Person')),
  signer_id       UUID NOT NULL REFERENCES users(id),
  signer_email    VARCHAR(255) NOT NULL,
  signature_meaning TEXT NOT NULL,
  password_verified BOOLEAN DEFAULT false,
  signed_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_release_sig_ebr ON ebr_release_signatures(ebr_id);
