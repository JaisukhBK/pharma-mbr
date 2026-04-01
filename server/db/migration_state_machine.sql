-- Pharma-MBR | Migration: MBR Lifecycle State Machine
-- 21 CFR Part 11 §11.10(f) — Operational sequencing
-- Run once: node -e "require('./db/pool').pool.query(require('fs').readFileSync('./db/migration_state_machine.sql','utf8')).then(()=>{console.log('Done');process.exit()})"

-- Status transition log — every status change recorded with who/when/why
CREATE TABLE IF NOT EXISTS mbr_status_transitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mbr_id        UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
  from_status   VARCHAR(30) NOT NULL,
  to_status     VARCHAR(30) NOT NULL,
  triggered_by  VARCHAR(30) NOT NULL,
  user_id       UUID NOT NULL REFERENCES users(id),
  reason        TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_transitions_mbr ON mbr_status_transitions(mbr_id);
CREATE INDEX IF NOT EXISTS idx_transitions_time ON mbr_status_transitions(created_at DESC);
