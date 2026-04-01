-- Pharma-MBR | Migration: Training Management Module
-- 21 CFR Part 11 §11.10(i) — Personnel training documentation
-- GAMP5 §7 — Personnel qualification

-- 1. Training curricula (course definitions)
CREATE TABLE IF NOT EXISTS training_curricula (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  course_code       VARCHAR(50) UNIQUE NOT NULL,
  course_name       VARCHAR(255) NOT NULL,
  description       TEXT,
  required_for_roles TEXT[] DEFAULT '{}',
  validity_months   INT DEFAULT 12,
  is_active         BOOLEAN DEFAULT true,
  created_by        UUID REFERENCES users(id),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_curricula_active ON training_curricula(is_active);

-- 2. Training records (one per user per course per cycle — append-only for audit)
CREATE TABLE IF NOT EXISTS training_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  curriculum_id   UUID NOT NULL REFERENCES training_curricula(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status          VARCHAR(20) DEFAULT 'Pending'
                  CHECK (status IN ('Pending','In Progress','Completed','Expired','Waived')),
  assigned_by     UUID REFERENCES users(id),
  assigned_at     TIMESTAMPTZ DEFAULT NOW(),
  due_date        TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  completed_by    UUID REFERENCES users(id),
  expiry_date     TIMESTAMPTZ,
  score           NUMERIC(5,2),
  evidence_notes  TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_user ON training_records(user_id);
CREATE INDEX IF NOT EXISTS idx_training_status ON training_records(status);
CREATE INDEX IF NOT EXISTS idx_training_expiry ON training_records(expiry_date);

-- 3. Seed default curricula (GMP essentials)
INSERT INTO training_curricula (course_code, course_name, description, required_for_roles, validity_months)
VALUES
  ('GMP-001', 'GMP Fundamentals', 'Current Good Manufacturing Practice fundamentals including documentation, hygiene, and process controls.', '{admin,designer,qa_reviewer,production_operator,viewer}', 12),
  ('ESIG-001', 'Electronic Signature Policy (21 CFR Part 11)', 'Training on electronic signature procedures, legal equivalence, and password security per 21 CFR Part 11 §11.10(i).', '{admin,designer,qa_reviewer,production_operator}', 12),
  ('MBR-001', 'MBR Designer Operations', 'Master Batch Record design using ISA-88 procedural hierarchy, including phase/step/parameter creation and review workflows.', '{admin,designer}', 12),
  ('QA-001', 'QA Review & Approval Procedures', 'Quality Assurance review procedures for MBR approval, signature sequencing, and deviation handling.', '{qa_reviewer,admin}', 12),
  ('MFG-001', 'Manufacturing Execution (EBR)', 'Electronic Batch Record execution procedures, data entry, and verification workflows on the shop floor.', '{production_operator,admin}', 12),
  ('AI-001', 'AI Co-Designer Usage & Governance', 'Responsible use of the AI Co-Designer tool, proposal review procedures, and GAMP5 AI controls.', '{admin,designer}', 24)
ON CONFLICT (course_code) DO NOTHING;
