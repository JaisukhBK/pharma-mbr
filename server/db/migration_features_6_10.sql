-- Pharma-MBR | Migration: Features 6-10
-- Feature 6: Risk Assessment (FMEA) — GAMP5 §6, ICH Q9
-- Feature 8: Periodic Review — GAMP5 D10, EU Annex 11 §11
-- Feature 9: AI/ML Governance — GAMP5 D11, ISPE AI Guide
-- Feature 10: SBOM / Config Management — GAMP5 D8, FDA CSA

-- ═══ FEATURE 6: RISK ASSESSMENT (FMEA) ═══
CREATE TABLE IF NOT EXISTS risk_assessments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  step_id         UUID REFERENCES mbr_steps(id) ON DELETE SET NULL,
  parameter_id    UUID REFERENCES mbr_step_parameters(id) ON DELETE SET NULL,
  hazard          TEXT NOT NULL,
  hazard_category VARCHAR(50) DEFAULT 'Process'
                  CHECK (hazard_category IN ('Process','Quality','Safety','Equipment','Material','Environmental')),
  severity        INT NOT NULL CHECK (severity BETWEEN 1 AND 10),
  probability     INT NOT NULL CHECK (probability BETWEEN 1 AND 10),
  detectability   INT NOT NULL CHECK (detectability BETWEEN 1 AND 10),
  rpn             INT GENERATED ALWAYS AS (severity * probability * detectability) STORED,
  risk_level      VARCHAR(20) GENERATED ALWAYS AS (
    CASE
      WHEN severity * probability * detectability >= 200 THEN 'Critical'
      WHEN severity * probability * detectability >= 100 THEN 'High'
      WHEN severity * probability * detectability >= 50 THEN 'Medium'
      ELSE 'Low'
    END
  ) STORED,
  mitigation      TEXT,
  residual_rpn    INT,
  status          VARCHAR(20) DEFAULT 'Open'
                  CHECK (status IN ('Open','Mitigated','Accepted','Closed')),
  assessed_by     UUID NOT NULL REFERENCES users(id),
  reviewed_by     UUID REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_risk_mbr ON risk_assessments(mbr_id);
CREATE INDEX IF NOT EXISTS idx_risk_rpn ON risk_assessments(rpn DESC);

-- ═══ FEATURE 8: PERIODIC REVIEW ═══
CREATE TABLE IF NOT EXISTS periodic_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  review_type     VARCHAR(50) NOT NULL
                  CHECK (review_type IN ('System Validation','Access Review','Backup Verification','Audit Trail Review','Training Compliance','Change Control Review')),
  title           VARCHAR(255) NOT NULL,
  description     TEXT,
  frequency_months INT NOT NULL DEFAULT 12,
  last_completed  TIMESTAMPTZ,
  next_due        TIMESTAMPTZ NOT NULL,
  status          VARCHAR(20) DEFAULT 'Scheduled'
                  CHECK (status IN ('Scheduled','In Progress','Completed','Overdue','Cancelled')),
  assigned_to     UUID REFERENCES users(id),
  completed_by    UUID REFERENCES users(id),
  completed_at    TIMESTAMPTZ,
  findings        TEXT,
  corrective_actions TEXT,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_review_due ON periodic_reviews(next_due);
CREATE INDEX IF NOT EXISTS idx_review_status ON periodic_reviews(status);

-- Seed default review schedule
INSERT INTO periodic_reviews (review_type, title, frequency_months, next_due, description)
VALUES
  ('System Validation', 'Annual System Validation Review', 12, NOW() + INTERVAL '12 months', 'Review system validation status, test results, and deviation history per GAMP5 D10.'),
  ('Access Review', 'Quarterly User Access Review', 3, NOW() + INTERVAL '3 months', 'Review active user accounts, role assignments, and terminated employee access removal.'),
  ('Backup Verification', 'Semi-Annual Backup Verification', 6, NOW() + INTERVAL '6 months', 'Verify database backup integrity, restore test, and disaster recovery readiness.'),
  ('Audit Trail Review', 'Quarterly Audit Trail Review', 3, NOW() + INTERVAL '3 months', 'Review audit trail for anomalies, unauthorized access attempts, and data integrity.'),
  ('Training Compliance', 'Quarterly Training Compliance Review', 3, NOW() + INTERVAL '3 months', 'Review training matrix, identify expired/missing training, initiate retraining.'),
  ('Change Control Review', 'Semi-Annual Change Control Review', 6, NOW() + INTERVAL '6 months', 'Review open/closed change requests, assess trend data, verify implementation effectiveness.')
ON CONFLICT DO NOTHING;

-- ═══ FEATURE 9: AI/ML GOVERNANCE ═══
CREATE TABLE IF NOT EXISTS ai_model_registry (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name      VARCHAR(255) NOT NULL,
  model_version   VARCHAR(100) NOT NULL,
  provider        VARCHAR(100) NOT NULL,
  prompt_hash     VARCHAR(128),
  prompt_version  VARCHAR(50),
  description     TEXT,
  risk_level      VARCHAR(20) DEFAULT 'Medium'
                  CHECK (risk_level IN ('Low','Medium','High','Critical')),
  status          VARCHAR(20) DEFAULT 'Active'
                  CHECK (status IN ('Draft','Active','Deprecated','Retired')),
  validated_at    TIMESTAMPTZ,
  validated_by    UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(model_name, model_version)
);

CREATE TABLE IF NOT EXISTS ai_performance_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_id        UUID REFERENCES ai_model_registry(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  total_proposals INT DEFAULT 0,
  accepted        INT DEFAULT 0,
  rejected        INT DEFAULT 0,
  modified        INT DEFAULT 0,
  avg_confidence  NUMERIC(4,3),
  acceptance_rate NUMERIC(4,3),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ai_metrics_model ON ai_performance_metrics(model_id);

-- ═══ FEATURE 10: SBOM / CONFIG MANAGEMENT ═══
CREATE TABLE IF NOT EXISTS system_config_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_type   VARCHAR(50) NOT NULL
                  CHECK (snapshot_type IN ('SBOM','Build','Deployment','Configuration')),
  version_tag     VARCHAR(100),
  git_sha         VARCHAR(64),
  content         JSONB NOT NULL,
  content_hash    VARCHAR(128) NOT NULL,
  created_by      UUID REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_config_type ON system_config_snapshots(snapshot_type);
