-- migration_ebr_env_records.sql — EBR Environmental Records
-- Links environmental readings to batch execution steps
-- Captures start snapshot, periodic readings, and end snapshot per BO

CREATE TABLE IF NOT EXISTS ebr_env_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
  step_id         VARCHAR(100) NOT NULL,
  step_name       VARCHAR(255),
  zone_id         UUID NOT NULL REFERENCES env_zones(id),
  zone_code       VARCHAR(50),
  event_type      VARCHAR(20) NOT NULL
                  CHECK (event_type IN ('start_snapshot','periodic','end_snapshot')),
  sensor_id       UUID REFERENCES env_sensors(id),
  sensor_code     VARCHAR(50),
  parameter_type  VARCHAR(30) NOT NULL,
  value           NUMERIC(12,4) NOT NULL,
  unit            VARCHAR(20),
  low_limit       NUMERIC(12,4),
  high_limit      NUMERIC(12,4),
  in_spec         BOOLEAN,
  recorded_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ebr_env_ebr ON ebr_env_records(ebr_id);
CREATE INDEX IF NOT EXISTS idx_ebr_env_step ON ebr_env_records(step_id);
CREATE INDEX IF NOT EXISTS idx_ebr_env_zone ON ebr_env_records(zone_id);
CREATE INDEX IF NOT EXISTS idx_ebr_env_time ON ebr_env_records(recorded_at DESC);
