-- Pharma-MBR | Migration: Change Control Workflow
-- GAMP5 D8 — Change management
-- 21 CFR Part 11 §11.10(k) — System documentation controls

-- 1. Change request types (configurable approval chains)
CREATE TABLE IF NOT EXISTS change_request_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type_code       VARCHAR(50) UNIQUE NOT NULL,
  type_name       VARCHAR(255) NOT NULL,
  description     TEXT,
  approval_chain  TEXT[] NOT NULL DEFAULT '{}',
  requires_impact_assessment BOOLEAN DEFAULT true,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Change requests
CREATE TABLE IF NOT EXISTS change_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cr_number             VARCHAR(50) UNIQUE NOT NULL,
  type_id               UUID NOT NULL REFERENCES change_request_types(id),
  title                 VARCHAR(500) NOT NULL,
  description           TEXT NOT NULL,
  justification         TEXT NOT NULL,
  impact_assessment     TEXT,
  risk_level            VARCHAR(20) DEFAULT 'Medium'
                        CHECK (risk_level IN ('Low','Medium','High','Critical')),
  priority              VARCHAR(20) DEFAULT 'Normal'
                        CHECK (priority IN ('Low','Normal','High','Urgent')),
  status                VARCHAR(30) DEFAULT 'Draft'
                        CHECK (status IN ('Draft','Submitted','Under Review','Approved','Rejected','Implemented','Verified','Closed','Cancelled')),
  mbr_id                UUID REFERENCES mbrs(id),
  requested_by          UUID NOT NULL REFERENCES users(id),
  current_approver_index INT DEFAULT 0,
  implementation_notes  TEXT,
  verification_notes    TEXT,
  implemented_at        TIMESTAMPTZ,
  implemented_by        UUID REFERENCES users(id),
  verified_at           TIMESTAMPTZ,
  verified_by           UUID REFERENCES users(id),
  closed_at             TIMESTAMPTZ,
  closed_by             UUID REFERENCES users(id),
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cr_status ON change_requests(status);
CREATE INDEX IF NOT EXISTS idx_cr_mbr ON change_requests(mbr_id);
CREATE INDEX IF NOT EXISTS idx_cr_requestor ON change_requests(requested_by);

-- 3. Change approval records (one per step in the chain)
CREATE TABLE IF NOT EXISTS change_approvals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  change_request_id   UUID NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
  approval_step       VARCHAR(100) NOT NULL,
  step_index          INT NOT NULL,
  status              VARCHAR(20) DEFAULT 'Pending'
                      CHECK (status IN ('Pending','Approved','Rejected','Returned')),
  approver_id         UUID REFERENCES users(id),
  comments            TEXT,
  decided_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_approval_cr ON change_approvals(change_request_id);

-- 4. Seed default change types with approval chains
INSERT INTO change_request_types (type_code, type_name, description, approval_chain, requires_impact_assessment)
VALUES
  ('MBR-CHANGE', 'MBR Template Change',
   'Modification to an approved Master Batch Record template, including formula, process parameters, or procedural changes.',
   '{Department Head,QA Approver}', true),
  ('SYS-CONFIG', 'System Configuration Change',
   'Changes to user roles, permissions, training curricula, or system settings.',
   '{QA Approver}', false),
  ('PROC-CHANGE', 'Process Change',
   'Changes to manufacturing processes, equipment types, material specifications, or dosage forms.',
   '{Department Head,QA Approver,Regulatory}', true),
  ('SW-CHANGE', 'Software Change',
   'Code deployments, database migrations, infrastructure updates, or dependency changes.',
   '{Technical Lead,QA Approver}', true)
ON CONFLICT (type_code) DO NOTHING;
