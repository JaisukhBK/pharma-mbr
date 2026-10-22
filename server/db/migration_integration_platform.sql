-- migration_integration_platform.sql — Integration Platform Tables
-- FS-INT-001 v1.1 — ERP, LIMS, Historian, OPC UA

-- 1. INTEGRATION CONNECTIONS (extends env_bms_connections concept)
CREATE TABLE IF NOT EXISTS integration_connections (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_name     VARCHAR(100) NOT NULL,
  system_type         VARCHAR(30) NOT NULL
                      CHECK (system_type IN ('ERP','LIMS','Historian','OPC_UA','BMS','EMS','SCADA','Custom')),
  protocol            VARCHAR(20) DEFAULT 'REST'
                      CHECK (protocol IN ('REST','SOAP','RFC','OPC_UA','SQL','FILE','MQTT')),
  endpoint_url        VARCHAR(500),
  auth_type           VARCHAR(20) DEFAULT 'API_KEY'
                      CHECK (auth_type IN ('API_KEY','Bearer','Basic','OAuth2','Certificate','None')),
  api_key             VARCHAR(500),
  api_version         VARCHAR(20),
  polling_interval_sec INT DEFAULT 300,
  timeout_sec         INT DEFAULT 30,
  retry_max           INT DEFAULT 3,
  is_active           BOOLEAN DEFAULT true,
  health_status       VARCHAR(20) DEFAULT 'Unknown'
                      CHECK (health_status IN ('Healthy','Degraded','Unhealthy','Offline','Unknown')),
  escalation_tier     VARCHAR(10) DEFAULT 'L0',
  last_poll_at        TIMESTAMPTZ,
  last_poll_status    VARCHAR(30),
  last_error          TEXT,
  config              JSONB DEFAULT '{}',
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intconn_type ON integration_connections(system_type);
CREATE INDEX IF NOT EXISTS idx_intconn_health ON integration_connections(health_status);

-- 2. INTEGRATION MESSAGE QUEUE (persistent, with retry and dead letter)
CREATE TABLE IF NOT EXISTS integration_queue (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID REFERENCES integration_connections(id),
  ebr_id              UUID REFERENCES ebrs(id),
  message_type        VARCHAR(50) NOT NULL,
  direction           VARCHAR(10) NOT NULL CHECK (direction IN ('Inbound','Outbound')),
  payload             JSONB NOT NULL,
  response            JSONB,
  status              VARCHAR(20) DEFAULT 'Pending'
                      CHECK (status IN ('Pending','Processing','Completed','Failed','DeadLetter','Cancelled')),
  retry_count         INT DEFAULT 0,
  max_retries         INT DEFAULT 3,
  next_retry_at       TIMESTAMPTZ,
  idempotency_key     VARCHAR(100) UNIQUE,
  error_message       TEXT,
  processing_time_ms  INT,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW(),
  completed_at        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_intq_status ON integration_queue(status);
CREATE INDEX IF NOT EXISTS idx_intq_conn ON integration_queue(connection_id);
CREATE INDEX IF NOT EXISTS idx_intq_ebr ON integration_queue(ebr_id);
CREATE INDEX IF NOT EXISTS idx_intq_type ON integration_queue(message_type);
CREATE INDEX IF NOT EXISTS idx_intq_created ON integration_queue(created_at DESC);

-- 3. FIELD MAPPINGS (configurable source↔target field mapping per connection)
CREATE TABLE IF NOT EXISTS integration_field_mappings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES integration_connections(id) ON DELETE CASCADE,
  source_field        VARCHAR(100) NOT NULL,
  target_field        VARCHAR(100) NOT NULL,
  direction           VARCHAR(10) DEFAULT 'Both' CHECK (direction IN ('Inbound','Outbound','Both')),
  transform           VARCHAR(50),
  default_value       VARCHAR(255),
  is_required         BOOLEAN DEFAULT false,
  mapping_version     INT DEFAULT 1,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intmap_conn ON integration_field_mappings(connection_id);

-- 4. INTEGRATION LOG (detailed event log for audit trail)
CREATE TABLE IF NOT EXISTS integration_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID REFERENCES integration_connections(id),
  queue_id            UUID REFERENCES integration_queue(id),
  event_type          VARCHAR(30) NOT NULL,
  direction           VARCHAR(10),
  message_type        VARCHAR(50),
  status              VARCHAR(20),
  details             TEXT,
  request_payload     JSONB,
  response_payload    JSONB,
  duration_ms         INT,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_intlog_conn ON integration_log(connection_id);
CREATE INDEX IF NOT EXISTS idx_intlog_time ON integration_log(created_at DESC);

-- 5. LIMS SAMPLES (sample lifecycle tracking)
CREATE TABLE IF NOT EXISTS lims_samples (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id              UUID REFERENCES ebrs(id),
  step_id             VARCHAR(100),
  batch_number        VARCHAR(50) NOT NULL,
  sample_id_lims      VARCHAR(50),
  material_code       VARCHAR(50),
  material_name       VARCHAR(255),
  sample_point        VARCHAR(100),
  tests_required      JSONB DEFAULT '[]',
  status              VARCHAR(20) DEFAULT 'Submitted'
                      CHECK (status IN ('Submitted','In Testing','Results Available','Approved','Rejected','Cancelled')),
  results             JSONB DEFAULT '[]',
  coa_reference       VARCHAR(100),
  is_oos              BOOLEAN DEFAULT false,
  submitted_by        UUID REFERENCES users(id),
  submitted_at        TIMESTAMPTZ DEFAULT NOW(),
  results_received_at TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_lims_ebr ON lims_samples(ebr_id);
CREATE INDEX IF NOT EXISTS idx_lims_batch ON lims_samples(batch_number);
CREATE INDEX IF NOT EXISTS idx_lims_status ON lims_samples(status);

-- 6. ERP PRODUCTION ORDERS (downloaded from ERP)
CREATE TABLE IF NOT EXISTS erp_production_orders (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  erp_order_number    VARCHAR(50) UNIQUE NOT NULL,
  erp_system          VARCHAR(50),
  product_code        VARCHAR(50),
  product_name        VARCHAR(255),
  batch_number        VARCHAR(50),
  ordered_quantity    NUMERIC(12,4),
  unit                VARCHAR(20),
  planned_start       DATE,
  planned_end         DATE,
  status              VARCHAR(20) DEFAULT 'Downloaded'
                      CHECK (status IN ('Downloaded','EBR Created','In Progress','Completed','Reported','Cancelled')),
  ebr_id              UUID REFERENCES ebrs(id),
  bom_data            JSONB DEFAULT '[]',
  sync_status         VARCHAR(20) DEFAULT 'Synced',
  last_synced_at      TIMESTAMPTZ DEFAULT NOW(),
  raw_payload         JSONB,
  created_at          TIMESTAMPTZ DEFAULT NOW(),
  updated_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_erp_order ON erp_production_orders(erp_order_number);
CREATE INDEX IF NOT EXISTS idx_erp_status ON erp_production_orders(status);

-- 7. HISTORIAN BATCH CONTEXTS (links time-series windows to EBR steps)
CREATE TABLE IF NOT EXISTS historian_batch_contexts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ebr_id              UUID NOT NULL REFERENCES ebrs(id),
  step_id             VARCHAR(100),
  step_name           VARCHAR(255),
  historian_connection_id UUID REFERENCES integration_connections(id),
  context_tags        JSONB DEFAULT '[]',
  start_time          TIMESTAMPTZ NOT NULL,
  end_time            TIMESTAMPTZ,
  status              VARCHAR(20) DEFAULT 'Open'
                      CHECK (status IN ('Open','Closed','Archived')),
  tag_count           INT DEFAULT 0,
  data_points         INT DEFAULT 0,
  created_at          TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hist_ebr ON historian_batch_contexts(ebr_id);
CREATE INDEX IF NOT EXISTS idx_hist_status ON historian_batch_contexts(status);
