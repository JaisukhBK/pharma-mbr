-- migration_env_monitoring.sql — Environmental Monitoring System
-- EU GMP Annex 1 | 21 CFR 211.42 | ISO 14644 Clean Room Classification
-- Integrates with BMS/EMS via REST API ingestion or polling

-- 1. MONITORED ZONES (clean rooms, warehouses, dispensing booths)
CREATE TABLE IF NOT EXISTS env_zones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_code         VARCHAR(50) UNIQUE NOT NULL,
  zone_name         VARCHAR(255) NOT NULL,
  zone_type         VARCHAR(30) DEFAULT 'Production'
                    CHECK (zone_type IN ('Production','Warehouse','QC Lab','Dispensing','Packaging','Utility','Corridor','Airlock')),
  iso_class         VARCHAR(20),
  gmp_grade         VARCHAR(20) CHECK (gmp_grade IN ('A','B','C','D','Unclassified',NULL)),
  parent_zone_id    UUID REFERENCES env_zones(id),
  building          VARCHAR(50),
  floor             VARCHAR(20),
  area_sqm          NUMERIC(8,2),
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- 2. SENSORS (linked to zones, configured with limits)
CREATE TABLE IF NOT EXISTS env_sensors (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id           UUID NOT NULL REFERENCES env_zones(id) ON DELETE CASCADE,
  sensor_code       VARCHAR(50) UNIQUE NOT NULL,
  sensor_name       VARCHAR(255) NOT NULL,
  parameter_type    VARCHAR(30) NOT NULL
                    CHECK (parameter_type IN ('Temperature','Humidity','DiffPressure','ParticleCount_0.5um','ParticleCount_5um','AirVelocity','LuxLevel','CO2','O2')),
  unit              VARCHAR(20) NOT NULL,
  low_limit         NUMERIC(12,4),
  high_limit        NUMERIC(12,4),
  low_alert         NUMERIC(12,4),
  high_alert        NUMERIC(12,4),
  reading_interval_sec INT DEFAULT 300,
  bms_tag           VARCHAR(100),
  bms_source        VARCHAR(50),
  is_critical       BOOLEAN DEFAULT false,
  is_active         BOOLEAN DEFAULT true,
  last_reading      NUMERIC(12,4),
  last_reading_at   TIMESTAMPTZ,
  status            VARCHAR(20) DEFAULT 'Normal'
                    CHECK (status IN ('Normal','Warning','Alarm','Offline','Maintenance')),
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sensor_zone ON env_sensors(zone_id);

-- 3. READINGS (time-series data from BMS/EMS or manual entry)
CREATE TABLE IF NOT EXISTS env_readings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id         UUID NOT NULL REFERENCES env_sensors(id) ON DELETE CASCADE,
  zone_id           UUID NOT NULL REFERENCES env_zones(id),
  value             NUMERIC(12,4) NOT NULL,
  unit              VARCHAR(20),
  source            VARCHAR(20) DEFAULT 'BMS'
                    CHECK (source IN ('BMS','EMS','Manual','Simulation')),
  in_spec           BOOLEAN,
  bms_timestamp     TIMESTAMPTZ,
  recorded_at       TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_reading_sensor ON env_readings(sensor_id);
CREATE INDEX IF NOT EXISTS idx_reading_zone ON env_readings(zone_id);
CREATE INDEX IF NOT EXISTS idx_reading_time ON env_readings(recorded_at DESC);

-- 4. ALERTS (triggered when readings breach limits)
CREATE TABLE IF NOT EXISTS env_alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sensor_id         UUID NOT NULL REFERENCES env_sensors(id),
  zone_id           UUID NOT NULL REFERENCES env_zones(id),
  alert_type        VARCHAR(20) NOT NULL CHECK (alert_type IN ('Warning','Alarm','Recovery')),
  parameter_type    VARCHAR(30) NOT NULL,
  value             NUMERIC(12,4) NOT NULL,
  limit_breached    VARCHAR(20),
  limit_value       NUMERIC(12,4),
  acknowledged_by   UUID REFERENCES users(id),
  acknowledged_at   TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_alert_zone ON env_alerts(zone_id);
CREATE INDEX IF NOT EXISTS idx_alert_time ON env_alerts(created_at DESC);

-- 5. BMS/EMS CONNECTION CONFIGS
CREATE TABLE IF NOT EXISTS env_bms_connections (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_name   VARCHAR(100) NOT NULL,
  system_type       VARCHAR(20) NOT NULL CHECK (system_type IN ('BMS','EMS','SCADA','OPC_UA','Modbus','REST')),
  endpoint_url      VARCHAR(500),
  api_key           VARCHAR(255),
  polling_interval_sec INT DEFAULT 300,
  auth_type         VARCHAR(20) DEFAULT 'API_KEY' CHECK (auth_type IN ('API_KEY','Bearer','Basic','OAuth2','None')),
  is_active         BOOLEAN DEFAULT true,
  last_poll_at      TIMESTAMPTZ,
  last_poll_status  VARCHAR(20) DEFAULT 'Pending',
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);
