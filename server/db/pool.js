// ============================================================================
// PharmaMES.AI — Neon PostgreSQL Connection Pool
// server/db/pool.js
//
// Replaces supabase.js stub.
// - Single pool shared across all route modules
// - Runs 6 schema migrations sequentially on startup
// - query() helper wraps pool.query with error logging
// - transaction() helper wraps BEGIN / COMMIT / ROLLBACK
// ============================================================================

'use strict';

const { Pool } = require('pg');

// ── Connection pool ──────────────────────────────────────────────────────────
// Neon uses a single DATABASE_URL that includes SSL params.
// max:10 is safe for Neon's free tier (10 concurrent connections).
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Neon requires SSL; cert not pinned in dev
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', function (err) {
  console.error('[pool] Unexpected client error:', err.message);
});

// ── Simple query helper ──────────────────────────────────────────────────────
async function query(text, params) {
  const start = Date.now();
  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development' && duration > 200) {
      console.warn('[pool] Slow query (' + duration + 'ms):', text.substring(0, 80));
    }
    return result;
  } catch (err) {
    console.error('[pool] Query error:', err.message, '\nSQL:', text.substring(0, 120));
    throw err;
  }
}

// ── Transaction helper ───────────────────────────────────────────────────────
// Usage:
//   const result = await transaction(async (client) => {
//     await client.query('INSERT ...');
//     await client.query('UPDATE ...');
//     return someValue;
//   });
async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ── Migrations ───────────────────────────────────────────────────────────────
// Each migration is idempotent (uses IF NOT EXISTS / CREATE OR REPLACE).
// They run in order on every server startup — safe to re-run.

const MIGRATIONS = [

  // ──────────────────────────────────────────────────────────────────────────
  // M-001: Core tables — users, sessions, audit_trail
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: 'M-001 core tables',
    sql: `
      CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      -- ── Users ─────────────────────────────────────────────────────────────
      -- email = unique auth identity, username = display name (non-unique)
      CREATE TABLE IF NOT EXISTS users (
        id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        username             VARCHAR(100),
        email                VARCHAR(200),
        password_hash        VARCHAR(200) NOT NULL,
        full_name            VARCHAR(200) NOT NULL,
        title                VARCHAR(100),
        group_id             VARCHAR(50),
        status               VARCHAR(20)  NOT NULL DEFAULT 'Active',
        must_change_password BOOLEAN      NOT NULL DEFAULT TRUE,
        failed_attempts      INTEGER      NOT NULL DEFAULT 0,
        locked_until         TIMESTAMPTZ,
        last_login           TIMESTAMPTZ,
        password_expires_at  TIMESTAMPTZ,
        session_timeout_min  INTEGER      NOT NULL DEFAULT 20,
        training_status      VARCHAR(30)  NOT NULL DEFAULT 'Pending',
        created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      -- ── Patch: safely add/fix columns on existing tables ─────────────────
      -- All statements are idempotent — safe to run on every startup.
      DO $$
      BEGIN
        -- Add username if missing (old schema may not have it)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='username') THEN
          ALTER TABLE users ADD COLUMN username VARCHAR(100);
        END IF;

        -- Add email if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='email') THEN
          ALTER TABLE users ADD COLUMN email VARCHAR(200);
        END IF;

        -- Add group_id if missing (old schema used 'role')
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='group_id') THEN
          ALTER TABLE users ADD COLUMN group_id VARCHAR(50);
          -- Copy role → group_id if role column exists
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='role') THEN
            UPDATE users SET group_id = role WHERE group_id IS NULL;
          END IF;
        END IF;

        -- Add failed_attempts if missing (old schema used login_attempts)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='failed_attempts') THEN
          ALTER TABLE users ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='login_attempts') THEN
            UPDATE users SET failed_attempts = login_attempts WHERE login_attempts IS NOT NULL;
          END IF;
        END IF;

        -- Add status if missing (old schema used is_active boolean)
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='status') THEN
          ALTER TABLE users ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'Active';
          IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='is_active') THEN
            UPDATE users SET status = CASE WHEN is_active = false THEN 'Inactive' ELSE 'Active' END;
          END IF;
        END IF;

        -- Add must_change_password if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='must_change_password') THEN
          ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT TRUE;
        END IF;

        -- Add training_status if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='training_status') THEN
          ALTER TABLE users ADD COLUMN training_status VARCHAR(30) NOT NULL DEFAULT 'Pending';
        END IF;

        -- Add password_expires_at if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='password_expires_at') THEN
          ALTER TABLE users ADD COLUMN password_expires_at TIMESTAMPTZ;
        END IF;

        -- Backfill username from email prefix for any NULLs
        UPDATE users SET username = split_part(email, '@', 1) WHERE username IS NULL AND email IS NOT NULL;

        -- Add UNIQUE constraint on email if not already there
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_email_key' AND conrelid='users'::regclass) THEN
          -- Only add if all emails are non-null and unique
          IF NOT EXISTS (SELECT email FROM users WHERE email IS NULL)
             AND (SELECT COUNT(*) FROM users) = (SELECT COUNT(DISTINCT email) FROM users) THEN
            ALTER TABLE users ADD CONSTRAINT users_email_key UNIQUE (email);
          END IF;
        END IF;

        -- Add indexes
        CREATE INDEX IF NOT EXISTS idx_users_email    ON users(email);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        CREATE INDEX IF NOT EXISTS idx_users_status   ON users(status);
      END $$;

      -- ── Refresh tokens ────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS refresh_tokens (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash  VARCHAR(200) NOT NULL UNIQUE,              -- SHA-256 of raw token
        issued_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ  NOT NULL,
        revoked_at  TIMESTAMPTZ,
        ip_address  INET,
        user_agent  TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user  ON refresh_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_refresh_tokens_hash  ON refresh_tokens(token_hash);

      -- ── Audit trail ───────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS audit_trail (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        sequence_number   BIGSERIAL UNIQUE NOT NULL,
        timestamp         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        user_id           VARCHAR(100) NOT NULL,
        user_name         VARCHAR(200),
        action            VARCHAR(50)  NOT NULL,
        resource          VARCHAR(100),
        resource_id       VARCHAR(200),
        details           TEXT,
        old_value         JSONB,
        new_value         JSONB,
        ip_address        INET,
        reason            TEXT,
        previous_checksum VARCHAR(128),
        checksum          VARCHAR(128) NOT NULL,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Patch: fix audit_trail columns on existing Neon DB ─────────────────
      DO $$
      BEGIN
        -- Old schema used 'resource_type' — rename to 'resource' to match middleware.js INSERT
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='resource_type')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='resource') THEN
          ALTER TABLE audit_trail RENAME COLUMN resource_type TO resource;
        END IF;

        -- Old schema used 'change_reason' — rename to 'reason'
        IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='change_reason')
           AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='reason') THEN
          ALTER TABLE audit_trail RENAME COLUMN change_reason TO reason;
        END IF;

        -- Add resource column if still missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='resource') THEN
          ALTER TABLE audit_trail ADD COLUMN resource VARCHAR(100);
        END IF;

        -- Add previous_checksum if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='previous_checksum') THEN
          ALTER TABLE audit_trail ADD COLUMN previous_checksum VARCHAR(128);
        END IF;

        -- Add user_name if missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='user_name') THEN
          ALTER TABLE audit_trail ADD COLUMN user_name VARCHAR(200);
        END IF;

        -- Add reason if still missing
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='reason') THEN
          ALTER TABLE audit_trail ADD COLUMN reason TEXT;
        END IF;

        -- Indexes
        CREATE INDEX IF NOT EXISTS idx_audit_resource  ON audit_trail(resource, resource_id);
        CREATE INDEX IF NOT EXISTS idx_audit_user      ON audit_trail(user_id);
        CREATE INDEX IF NOT EXISTS idx_audit_action    ON audit_trail(action);
        CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_trail(timestamp DESC);
      END $$;
    `,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // M-002: MBR tables (from 001_mbr_schema.sql, adapted for pool.js)
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: 'M-002 MBR schema',
    sql: `
      CREATE TABLE IF NOT EXISTS master_batch_records (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_code        VARCHAR(50)  NOT NULL UNIQUE,
        product_name    VARCHAR(200) NOT NULL,
        product_code    VARCHAR(50),
        dosage_form     VARCHAR(100),
        batch_size      DECIMAL(12,3),
        batch_size_unit VARCHAR(20)  DEFAULT 'kg',
        description     TEXT,
        status          VARCHAR(30)  NOT NULL DEFAULT 'Draft',
        current_version INTEGER      NOT NULL DEFAULT 1,
        created_by      UUID         NOT NULL REFERENCES users(id),
        created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mbr_versions (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id          UUID    NOT NULL REFERENCES master_batch_records(id) ON DELETE CASCADE,
        version_number  INTEGER NOT NULL,
        change_reason   TEXT    NOT NULL,
        version_status  VARCHAR(30) NOT NULL DEFAULT 'Draft',
        snapshot_data   JSONB,
        created_by      UUID    NOT NULL REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(mbr_id, version_number)
      );

      CREATE TABLE IF NOT EXISTS mbr_phases (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id       UUID    NOT NULL REFERENCES master_batch_records(id) ON DELETE CASCADE,
        phase_number INTEGER NOT NULL,
        phase_name   VARCHAR(200) NOT NULL,
        description  TEXT,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(mbr_id, phase_number)
      );

      CREATE TABLE IF NOT EXISTS mbr_steps (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        phase_id     UUID    NOT NULL REFERENCES mbr_phases(id) ON DELETE CASCADE,
        mbr_id       UUID    NOT NULL REFERENCES master_batch_records(id) ON DELETE CASCADE,
        step_number  INTEGER NOT NULL,
        step_name    VARCHAR(200) NOT NULL,
        instruction  TEXT,
        step_type    VARCHAR(50)  DEFAULT 'Processing',
        duration_min DECIMAL(8,2),
        is_critical  BOOLEAN DEFAULT FALSE,
        is_gmp_critical BOOLEAN DEFAULT FALSE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS step_parameters (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        step_id      UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
        param_name   VARCHAR(200) NOT NULL,
        param_type   VARCHAR(50)  DEFAULT 'numeric',
        target_value VARCHAR(100),
        unit         VARCHAR(50),
        lower_limit  DECIMAL(12,4),
        upper_limit  DECIMAL(12,4),
        is_cpp       BOOLEAN DEFAULT FALSE,
        is_cqa       BOOLEAN DEFAULT FALSE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS step_materials (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        step_id       UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
        material_code VARCHAR(100) NOT NULL,
        material_name VARCHAR(200) NOT NULL,
        material_type VARCHAR(50)  DEFAULT 'Raw Material',
        quantity      DECIMAL(12,4) NOT NULL,
        unit          VARCHAR(30)   NOT NULL,
        is_active     BOOLEAN DEFAULT FALSE,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS step_equipment (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        step_id        UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
        equipment_code VARCHAR(100) NOT NULL,
        equipment_name VARCHAR(200) NOT NULL,
        equipment_type VARCHAR(100),
        capacity       VARCHAR(100),
        is_primary     BOOLEAN DEFAULT TRUE,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS mbr_signatures (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id           UUID NOT NULL REFERENCES master_batch_records(id) ON DELETE CASCADE,
        version_id       UUID NOT NULL REFERENCES mbr_versions(id) ON DELETE CASCADE,
        signer_id        UUID NOT NULL REFERENCES users(id),
        signature_role   VARCHAR(50)  NOT NULL,
        signature_meaning VARCHAR(100) NOT NULL,
        signature_hash   VARCHAR(128) NOT NULL,
        password_verified BOOLEAN NOT NULL DEFAULT FALSE,
        signed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip_address       INET,
        user_agent       TEXT,
        content_hash     VARCHAR(128) NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_mbr_code    ON master_batch_records(mbr_code);
      CREATE INDEX IF NOT EXISTS idx_mbr_status  ON master_batch_records(status);
      CREATE INDEX IF NOT EXISTS idx_mbr_sig_mbr ON mbr_signatures(mbr_id, version_id);
    `,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // M-003: Equipment tables (from 002_equipment_schema.sql)
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: 'M-003 equipment schema',
    sql: `
      CREATE TABLE IF NOT EXISTS equipment_master (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        equipment_code   VARCHAR(50)  NOT NULL UNIQUE,
        equipment_name   VARCHAR(200) NOT NULL,
        equipment_type   VARCHAR(100) NOT NULL,
        manufacturer     VARCHAR(200),
        model_number     VARCHAR(100),
        serial_number    VARCHAR(100),
        location         VARCHAR(200),
        department       VARCHAR(100),
        criticality      VARCHAR(30)  DEFAULT 'Standard',
        gmp_impact       VARCHAR(30)  DEFAULT 'Direct',
        capacity         VARCHAR(100),
        installation_date DATE,
        warranty_expiry  DATE,
        asset_tag        VARCHAR(50),
        status           VARCHAR(30)  NOT NULL DEFAULT 'New',
        current_qual     VARCHAR(30)  DEFAULT 'None',
        cal_status       VARCHAR(30)  DEFAULT 'Not Calibrated',
        next_cal_date    DATE,
        next_pm_date     DATE,
        description      TEXT,
        created_by       UUID NOT NULL REFERENCES users(id),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS qualification_records (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        equipment_id     UUID NOT NULL REFERENCES equipment_master(id) ON DELETE CASCADE,
        qual_type        VARCHAR(30)  NOT NULL,
        protocol_number  VARCHAR(100) NOT NULL,
        protocol_title   VARCHAR(300),
        status           VARCHAR(30)  NOT NULL DEFAULT 'Draft',
        scheduled_date   DATE,
        started_at       TIMESTAMPTZ,
        completed_at     TIMESTAMPTZ,
        total_tests      INTEGER DEFAULT 0,
        tests_passed     INTEGER DEFAULT 0,
        tests_failed     INTEGER DEFAULT 0,
        tests_na         INTEGER DEFAULT 0,
        acceptance_criteria TEXT,
        results_summary  TEXT,
        deviations_noted TEXT,
        executed_by      UUID REFERENCES users(id),
        reviewed_by      UUID REFERENCES users(id),
        approved_by      UUID REFERENCES users(id),
        executed_at      TIMESTAMPTZ,
        reviewed_at      TIMESTAMPTZ,
        approved_at      TIMESTAMPTZ,
        execute_sig_hash VARCHAR(128),
        review_sig_hash  VARCHAR(128),
        approve_sig_hash VARCHAR(128),
        created_by       UUID NOT NULL REFERENCES users(id),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS calibration_records (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        equipment_id  UUID NOT NULL REFERENCES equipment_master(id) ON DELETE CASCADE,
        cal_type      VARCHAR(50)  DEFAULT 'Routine',
        instrument    VARCHAR(200),
        standard_used VARCHAR(200),
        as_found      VARCHAR(200),
        as_left       VARCHAR(200),
        tolerance     VARCHAR(100),
        status        VARCHAR(30)  NOT NULL DEFAULT 'Pass',
        cal_date      DATE NOT NULL,
        next_due_date DATE,
        performed_by  UUID REFERENCES users(id),
        reviewed_by   UUID REFERENCES users(id),
        sig_hash      VARCHAR(128),
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS maintenance_records (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        equipment_id  UUID NOT NULL REFERENCES equipment_master(id) ON DELETE CASCADE,
        maint_type    VARCHAR(50)  NOT NULL DEFAULT 'Preventive',
        description   TEXT,
        frequency     VARCHAR(100),
        scheduled_date DATE,
        completed_at  TIMESTAMPTZ,
        status        VARCHAR(30)  NOT NULL DEFAULT 'Scheduled',
        assigned_to   UUID REFERENCES users(id),
        completed_by  UUID REFERENCES users(id),
        notes         TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_equip_status   ON equipment_master(status);
      CREATE INDEX IF NOT EXISTS idx_equip_type     ON equipment_master(equipment_type);
      CREATE INDEX IF NOT EXISTS idx_equip_cal_date ON equipment_master(next_cal_date);
      CREATE INDEX IF NOT EXISTS idx_equip_pm_date  ON equipment_master(next_pm_date);
    `,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // M-004: EBR + Genealogy tables (004_ebr_schema + 003_genealogy_schema)
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: 'M-004 EBR and genealogy schema',
    sql: `
      -- Material lots (genealogy)
      CREATE TABLE IF NOT EXISTS material_lots (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        lot_number   VARCHAR(100) NOT NULL UNIQUE,
        material_code VARCHAR(100) NOT NULL,
        material_name VARCHAR(200) NOT NULL,
        category     VARCHAR(50)  DEFAULT 'Raw Material',
        supplier     VARCHAR(200),
        quantity     DECIMAL(12,4) NOT NULL,
        unit         VARCHAR(30)  NOT NULL,
        status       VARCHAR(30)  NOT NULL DEFAULT 'Quarantine',
        received_date DATE,
        expiry_date  DATE,
        coa_number   VARCHAR(100),
        created_by   UUID NOT NULL REFERENCES users(id),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Electronic Batch Records
      CREATE TABLE IF NOT EXISTS ebrs (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_code        VARCHAR(100) NOT NULL UNIQUE,
        batch_number    VARCHAR(100) NOT NULL,
        mbr_id          UUID         REFERENCES master_batch_records(id),
        mbr_code        VARCHAR(50),
        product_name    VARCHAR(200) NOT NULL,
        product_code    VARCHAR(50),
        batch_size      VARCHAR(100),
        status          VARCHAR(30)  NOT NULL DEFAULT 'Ready',
        line            VARCHAR(100),
        operator_id     UUID REFERENCES users(id),
        started_at      TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        phases_data     JSONB,                                 -- full phase/step/param tree
        material_consumption JSONB DEFAULT '[]',
        outputs         JSONB DEFAULT '[]',
        created_by      UUID NOT NULL REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- EBR parameter values (individual param recordings)
      CREATE TABLE IF NOT EXISTS ebr_parameter_values (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id       UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        phase_id     VARCHAR(50),
        step_id      VARCHAR(50),
        param_id     VARCHAR(50),
        param_name   VARCHAR(200),
        target_value DECIMAL(15,4),
        lower_limit  DECIMAL(15,4),
        upper_limit  DECIMAL(15,4),
        actual_value DECIMAL(15,4),
        unit         VARCHAR(50),
        is_oos       BOOLEAN DEFAULT FALSE,
        is_cpp       BOOLEAN DEFAULT FALSE,
        recorded_by  UUID REFERENCES users(id),
        recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Batch genealogy links (material lot → EBR)
      CREATE TABLE IF NOT EXISTS batch_genealogy (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id         UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        material_lot_id UUID REFERENCES material_lots(id),
        lot_number     VARCHAR(100) NOT NULL,
        material_name  VARCHAR(200),
        qty_required   DECIMAL(12,4),
        qty_dispensed  DECIMAL(12,4),
        unit           VARCHAR(30),
        step_name      VARCHAR(200),
        dispensed_by   UUID REFERENCES users(id),
        dispensed_at   TIMESTAMPTZ
      );

      -- Recall management
      CREATE TABLE IF NOT EXISTS recall_events (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        recall_number    VARCHAR(100) NOT NULL UNIQUE,
        product_name     VARCHAR(200) NOT NULL,
        recall_class     VARCHAR(20)  NOT NULL DEFAULT 'Class II',
        reason           TEXT NOT NULL,
        status           VARCHAR(30)  NOT NULL DEFAULT 'Under Investigation',
        initiated_at     DATE NOT NULL DEFAULT CURRENT_DATE,
        closed_at        DATE,
        fda_notified     BOOLEAN DEFAULT FALSE,
        affected_batches INTEGER DEFAULT 0,
        affected_units   BIGINT DEFAULT 0,
        created_by       UUID NOT NULL REFERENCES users(id),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS recall_lots (
        id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        recall_id   UUID NOT NULL REFERENCES recall_events(id) ON DELETE CASCADE,
        lot_number  VARCHAR(100) NOT NULL,
        ebr_id      UUID REFERENCES ebrs(id)
      );

      CREATE INDEX IF NOT EXISTS idx_ebr_status    ON ebrs(status);
      CREATE INDEX IF NOT EXISTS idx_ebr_mbr       ON ebrs(mbr_id);
      CREATE INDEX IF NOT EXISTS idx_ebr_batch_num ON ebrs(batch_number);
      CREATE INDEX IF NOT EXISTS idx_genealogy_lot ON batch_genealogy(lot_number);
      CREATE INDEX IF NOT EXISTS idx_genealogy_ebr ON batch_genealogy(ebr_id);
    `,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // M-005: Deviation + CAPA tables (from 005_devcapa_schema.sql)
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: 'M-005 deviation and CAPA schema',
    sql: `
      -- Auto-number sequence for deviation numbers
      CREATE SEQUENCE IF NOT EXISTS deviation_seq START 1;
      CREATE SEQUENCE IF NOT EXISTS capa_seq START 1;

      CREATE TABLE IF NOT EXISTS deviations (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        dev_number      VARCHAR(30) NOT NULL UNIQUE
                          DEFAULT ('DEV-' || TO_CHAR(NOW(),'YYYY') || '-' || LPAD(NEXTVAL('deviation_seq')::TEXT,4,'0')),
        title           VARCHAR(300) NOT NULL,
        description     TEXT,
        severity        VARCHAR(20)  NOT NULL DEFAULT 'Major',
        category        VARCHAR(50)  DEFAULT 'Process',
        status          VARCHAR(30)  NOT NULL DEFAULT 'Open',
        classification_6m VARCHAR(20) DEFAULT 'Method',
        root_cause      TEXT,
        area            VARCHAR(100),
        batch_id        UUID REFERENCES ebrs(id),
        batch_number    VARCHAR(100),
        equipment_id    UUID REFERENCES equipment_master(id),
        material_lot    VARCHAR(100),
        detected_by     VARCHAR(100),
        detected_at     DATE NOT NULL DEFAULT CURRENT_DATE,
        closed_at       DATE,
        assigned_to     UUID REFERENCES users(id),
        created_by      UUID NOT NULL REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS capas (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        capa_number     VARCHAR(30) NOT NULL UNIQUE
                          DEFAULT ('CAPA-' || TO_CHAR(NOW(),'YYYY') || '-' || LPAD(NEXTVAL('capa_seq')::TEXT,4,'0')),
        title           VARCHAR(300) NOT NULL,
        description     TEXT,
        capa_type       VARCHAR(20)  NOT NULL DEFAULT 'Corrective',
        status          VARCHAR(30)  NOT NULL DEFAULT 'Open',
        priority        VARCHAR(20)  NOT NULL DEFAULT 'High',
        effectiveness   VARCHAR(50),
        due_date        DATE,
        completed_at    DATE,
        effectiveness_check_date DATE,
        assigned_to     UUID REFERENCES users(id),
        verified_by     UUID REFERENCES users(id),
        created_by      UUID NOT NULL REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- Many-to-many: deviation ↔ CAPA
      CREATE TABLE IF NOT EXISTS deviation_capas (
        deviation_id UUID NOT NULL REFERENCES deviations(id) ON DELETE CASCADE,
        capa_id      UUID NOT NULL REFERENCES capas(id)      ON DELETE CASCADE,
        linked_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (deviation_id, capa_id)
      );

      -- CAPA tasks
      CREATE TABLE IF NOT EXISTS capa_tasks (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        capa_id      UUID NOT NULL REFERENCES capas(id) ON DELETE CASCADE,
        task_name    VARCHAR(200) NOT NULL,
        description  TEXT,
        status       VARCHAR(20)  NOT NULL DEFAULT 'Pending',
        assigned_to  UUID REFERENCES users(id),
        due_date     DATE,
        completed_at DATE,
        notes        TEXT,
        sort_order   INTEGER DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_dev_status     ON deviations(status);
      CREATE INDEX IF NOT EXISTS idx_dev_severity   ON deviations(severity);
      CREATE INDEX IF NOT EXISTS idx_dev_batch      ON deviations(batch_id);
      CREATE INDEX IF NOT EXISTS idx_dev_equipment  ON deviations(equipment_id);
      CREATE INDEX IF NOT EXISTS idx_capa_status    ON capas(status);
    `,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // M-006: Integration platform tables (from 006_integration_platform_schema.sql)
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: 'M-006 integration platform schema',
    sql: `
      CREATE TABLE IF NOT EXISTS integration_connectors (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        connector_code      VARCHAR(100) NOT NULL UNIQUE,
        connector_name      VARCHAR(200) NOT NULL,
        connector_type      VARCHAR(50)  NOT NULL,
        system_category     VARCHAR(50)  NOT NULL,
        isa95_level         INTEGER,
        host                VARCHAR(500),
        port                INTEGER,
        endpoint_url        VARCHAR(1000),
        protocol            VARCHAR(50),
        authentication      VARCHAR(50)  DEFAULT 'None',
        username            VARCHAR(200),
        password_encrypted  VARCHAR(500),
        certificate_path    VARCHAR(500),
        api_key_encrypted   VARCHAR(500),
        client_id           VARCHAR(200),
        sap_system_id       VARCHAR(10),
        sap_client          VARCHAR(10),
        sap_language        VARCHAR(5)   DEFAULT 'EN',
        opc_security_mode   VARCHAR(50),
        opc_security_policy VARCHAR(100),
        opc_namespace_uri   VARCHAR(500),
        status              VARCHAR(30)  NOT NULL DEFAULT 'Configured',
        last_connected      TIMESTAMPTZ,
        last_error          TEXT,
        health_score        INTEGER DEFAULT 0,
        vendor              VARCHAR(200),
        version             VARCHAR(50),
        description         TEXT,
        tags                JSONB,
        ai_auto_discovered  BOOLEAN DEFAULT FALSE,
        ai_confidence_score DECIMAL(5,2),
        ai_suggested_mappings INTEGER DEFAULT 0,
        created_by          UUID NOT NULL REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS connector_endpoints (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        connector_id     UUID NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
        endpoint_code    VARCHAR(200) NOT NULL,
        endpoint_name    VARCHAR(300) NOT NULL,
        endpoint_type    VARCHAR(50)  NOT NULL,
        opc_node_id      VARCHAR(500),
        opc_browse_name  VARCHAR(200),
        opc_data_type    VARCHAR(50),
        opc_access_level VARCHAR(20),
        sap_bapi_name    VARCHAR(200),
        sap_rfc_name     VARCHAR(200),
        sap_table_name   VARCHAR(200),
        sap_field_mapping JSONB,
        historian_tag_path VARCHAR(500),
        sample_rate_ms   INTEGER,
        last_value       JSONB,
        last_read_at     TIMESTAMPTZ,
        is_active        BOOLEAN DEFAULT TRUE,
        description      TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tag_mappings (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        connector_id     UUID NOT NULL REFERENCES integration_connectors(id) ON DELETE CASCADE,
        endpoint_id      UUID REFERENCES connector_endpoints(id),
        target_type      VARCHAR(50)  DEFAULT 'MBR_PARAMETER',
        target_id        VARCHAR(200),
        target_field     VARCHAR(200),
        direction        VARCHAR(20)  DEFAULT 'Read',
        transform_expr   TEXT,
        scale_factor     DECIMAL(15,6),
        offset_value     DECIMAL(15,6),
        unit_conversion  VARCHAR(100),
        ai_suggested     BOOLEAN DEFAULT FALSE,
        ai_confidence    DECIMAL(5,2),
        ai_suggestion_reason TEXT,
        is_active        BOOLEAN DEFAULT TRUE,
        sync_status      VARCHAR(30)  DEFAULT 'Pending',
        last_synced_at   TIMESTAMPTZ,
        created_by       UUID NOT NULL REFERENCES users(id),
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS data_flows (
        id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        flow_code             VARCHAR(100) NOT NULL UNIQUE,
        flow_name             VARCHAR(200) NOT NULL,
        flow_type             VARCHAR(30)  DEFAULT 'Scheduled',
        direction             VARCHAR(20)  DEFAULT 'Inbound',
        source_connector_id   UUID REFERENCES integration_connectors(id),
        target_connector_id   UUID REFERENCES integration_connectors(id),
        schedule_cron         VARCHAR(100),
        trigger_event         VARCHAR(200),
        field_mappings        JSONB,
        status                VARCHAR(20)  NOT NULL DEFAULT 'Active',
        execution_count       BIGINT DEFAULT 0,
        error_count           BIGINT DEFAULT 0,
        last_executed         TIMESTAMPTZ,
        last_status           VARCHAR(20),
        last_error            TEXT,
        created_by            UUID NOT NULL REFERENCES users(id),
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS integration_messages (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        connector_id   UUID REFERENCES integration_connectors(id),
        flow_id        UUID REFERENCES data_flows(id),
        message_type   VARCHAR(50),
        direction      VARCHAR(20),
        payload        JSONB,
        status         VARCHAR(20)  DEFAULT 'Delivered',
        latency_ms     INTEGER,
        error_message  TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        processed_at   TIMESTAMPTZ
      );

      CREATE TABLE IF NOT EXISTS ai_suggestions (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        connector_id        UUID REFERENCES integration_connectors(id),
        endpoint_id         UUID REFERENCES connector_endpoints(id),
        suggestion_type     VARCHAR(50)  NOT NULL,
        source_description  TEXT,
        suggestion          JSONB,
        reasoning           TEXT,
        confidence          DECIMAL(5,2),
        status              VARCHAR(20)  NOT NULL DEFAULT 'Pending',
        accepted_by         UUID REFERENCES users(id),
        accepted_at         TIMESTAMPTZ,
        model_used          VARCHAR(100),
        prompt_tokens       INTEGER,
        completion_tokens   INTEGER,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_conn_status    ON integration_connectors(status);
      CREATE INDEX IF NOT EXISTS idx_conn_type      ON integration_connectors(connector_type);
      CREATE INDEX IF NOT EXISTS idx_msgs_connector ON integration_messages(connector_id);
      CREATE INDEX IF NOT EXISTS idx_msgs_created   ON integration_messages(created_at DESC);
    `,
  },
  // ──────────────────────────────────────────────────────────────────────────
  // M-007: Service-layer tables
  // All tables that routes/services reference by their exact names.
  // Idempotent — all use IF NOT EXISTS.
  // ──────────────────────────────────────────────────────────────────────────
  {
    name: 'M-007 service tables',
    sql: `
      -- ── Patch: drop old check constraints on equipment if they exist ────────
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_qualification_status_check') THEN
          ALTER TABLE equipment DROP CONSTRAINT equipment_qualification_status_check;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'equipment_status_check') THEN
          ALTER TABLE equipment DROP CONSTRAINT equipment_status_check;
        END IF;
      END $$;

      -- ── mbrs (services use 'mbrs', not 'master_batch_records') ─────────────
      CREATE TABLE IF NOT EXISTS mbrs (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_code          VARCHAR(50)  NOT NULL UNIQUE,
        product_name      VARCHAR(200) NOT NULL,
        product_code      VARCHAR(50),
        strength          VARCHAR(100),
        dosage_form       VARCHAR(100),
        batch_size        DECIMAL(12,3),
        batch_size_unit   VARCHAR(20)  DEFAULT 'kg',
        batch_type        VARCHAR(50)  DEFAULT 'Production',
        market            VARCHAR(100),
        description       TEXT,
        status            VARCHAR(30)  NOT NULL DEFAULT 'Draft',
        current_version   INTEGER      NOT NULL DEFAULT 1,
        target_yield      DECIMAL(5,2),
        sap_recipe_id     VARCHAR(100),
        sap_material_number VARCHAR(100),
        sl_no             VARCHAR(50),
        approved_by       UUID REFERENCES users(id),
        approved_at       TIMESTAMPTZ,
        effective_date    DATE,
        superseded_date   DATE,
        created_by        UUID NOT NULL REFERENCES users(id),
        created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_mbrs_status ON mbrs(status);
      CREATE INDEX IF NOT EXISTS idx_mbrs_code   ON mbrs(mbr_code);

      -- ── mbr_phases ────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_phases (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        phase_number    INTEGER NOT NULL,
        phase_name      VARCHAR(200) NOT NULL,
        description     TEXT,
        phase_version   INTEGER DEFAULT 1,
        phase_status    VARCHAR(30) DEFAULT 'Active',
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(mbr_id, phase_number)
      );

      -- ── mbr_steps ─────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_steps (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        phase_id        UUID NOT NULL REFERENCES mbr_phases(id) ON DELETE CASCADE,
        mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        step_number     INTEGER NOT NULL,
        step_name       VARCHAR(200) NOT NULL,
        instruction     TEXT,
        step_type       VARCHAR(50) DEFAULT 'Processing',
        duration_min    DECIMAL(8,2),
        is_critical     BOOLEAN DEFAULT FALSE,
        is_gmp_critical BOOLEAN DEFAULT FALSE,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── mbr_step_parameters ───────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_step_parameters (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        step_id      UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
        mbr_id       UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        param_name   VARCHAR(200) NOT NULL,
        param_type   VARCHAR(50) DEFAULT 'numeric',
        target_value VARCHAR(100),
        unit         VARCHAR(50),
        lower_limit  DECIMAL(12,4),
        upper_limit  DECIMAL(12,4),
        is_cpp       BOOLEAN DEFAULT FALSE,
        is_cqa       BOOLEAN DEFAULT FALSE,
        sort_order   INTEGER NOT NULL DEFAULT 0,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── mbr_step_materials ────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_step_materials (
        id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        step_id       UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
        mbr_id        UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        material_code VARCHAR(100) NOT NULL,
        material_name VARCHAR(200) NOT NULL,
        material_type VARCHAR(50) DEFAULT 'Raw Material',
        quantity      DECIMAL(12,4) NOT NULL,
        unit          VARCHAR(30)   NOT NULL,
        is_active     BOOLEAN DEFAULT FALSE,
        sort_order    INTEGER NOT NULL DEFAULT 0,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── mbr_step_equipment ────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_step_equipment (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        step_id        UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
        mbr_id         UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        equipment_code VARCHAR(100) NOT NULL,
        equipment_name VARCHAR(200) NOT NULL,
        equipment_type VARCHAR(100),
        capacity       VARCHAR(100),
        is_primary     BOOLEAN DEFAULT TRUE,
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── mbr_bom_items ─────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_bom_items (
        id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id                UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        material_number       VARCHAR(100),
        material_code         VARCHAR(100) NOT NULL,
        material_name         VARCHAR(200) NOT NULL,
        quantity_per_batch    DECIMAL(12,4),
        unit                  VARCHAR(30),
        tolerance_pct         DECIMAL(5,2),
        tolerance_type        VARCHAR(10) DEFAULT '±',
        supplier              VARCHAR(200),
        grade                 VARCHAR(50),
        is_active_ingredient  BOOLEAN DEFAULT FALSE,
        dispensing_sequence   INTEGER DEFAULT 0,
        shelf_life_months     INTEGER,
        storage_conditions    TEXT,
        retest_interval_months INTEGER,
        sort_order            INTEGER NOT NULL DEFAULT 0,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── mbr_ipc_checks ────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_ipc_checks (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        step_id        UUID NOT NULL REFERENCES mbr_steps(id) ON DELETE CASCADE,
        mbr_id         UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        check_name     VARCHAR(200) NOT NULL,
        check_type     VARCHAR(100),
        specification  VARCHAR(300),
        frequency      VARCHAR(100),
        sort_order     INTEGER NOT NULL DEFAULT 0,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── mbr_formulas ──────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_formulas (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id           UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        formula_name     VARCHAR(200) NOT NULL,
        formula_type     VARCHAR(100) DEFAULT 'Yield',
        expression       TEXT NOT NULL,
        variables        JSONB DEFAULT '{}',
        result_unit      VARCHAR(50),
        validation_result JSONB,
        last_trial_at    TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── mbr_signatures ────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_signatures (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id            UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        signer_id         UUID NOT NULL REFERENCES users(id),
        signer_email      VARCHAR(200),
        signature_role    VARCHAR(50)  NOT NULL,
        signature_meaning VARCHAR(200) NOT NULL,
        content_hash      VARCHAR(128) NOT NULL,
        password_verified BOOLEAN NOT NULL DEFAULT FALSE,
        signed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ip_address        INET,
        user_agent        TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_mbr_sigs_mbr ON mbr_signatures(mbr_id);

      -- ── mbr_versions ──────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_versions (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id         UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        version        INTEGER NOT NULL,
        change_reason  TEXT,
        snapshot       JSONB,
        content_hash   VARCHAR(128),
        created_by     UUID REFERENCES users(id),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(mbr_id, version)
      );

      -- ── mbr_status_transitions ────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS mbr_status_transitions (
        id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id       UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        from_status  VARCHAR(30),
        to_status    VARCHAR(30) NOT NULL,
        triggered_by VARCHAR(50),
        user_id      UUID REFERENCES users(id),
        reason       TEXT,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── co_designer_sessions ──────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS co_designer_sessions (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id            UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        user_id           UUID NOT NULL REFERENCES users(id),
        mode              VARCHAR(20) NOT NULL DEFAULT 'off',
        status            VARCHAR(30) DEFAULT 'idle',
        source_pdf_name   VARCHAR(300),
        source_pdf_hash   VARCHAR(128),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── co_designer_proposals ─────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS co_designer_proposals (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        session_id     UUID REFERENCES co_designer_sessions(id) ON DELETE CASCADE,
        mbr_id         UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        proposal_type  VARCHAR(50),
        proposed_data  JSONB,
        confidence     DECIMAL(5,2),
        status         VARCHAR(20) NOT NULL DEFAULT 'pending',
        reviewed_by    UUID REFERENCES users(id),
        review_notes   TEXT,
        reviewed_at    TIMESTAMPTZ,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── ebr tables ────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS ebrs (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_code         VARCHAR(100) NOT NULL UNIQUE,
        mbr_id           UUID NOT NULL REFERENCES mbrs(id),
        batch_number     VARCHAR(100) NOT NULL UNIQUE,
        product_name     VARCHAR(200),
        batch_size       DECIMAL(12,3),
        batch_size_unit  VARCHAR(20) DEFAULT 'units',
        mbr_version      INTEGER,
        theoretical_yield DECIMAL(12,3),
        actual_yield     DECIMAL(12,3),
        yield_pct        DECIMAL(5,2),
        operator_id      UUID REFERENCES users(id),
        status           VARCHAR(30) NOT NULL DEFAULT 'Ready',
        release_status   VARCHAR(30),
        released_by      UUID REFERENCES users(id),
        released_at      TIMESTAMPTZ,
        release_notes    TEXT,
        started_at       TIMESTAMPTZ,
        completed_at     TIMESTAMPTZ,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ebrs_status ON ebrs(status);
      CREATE INDEX IF NOT EXISTS idx_ebrs_mbr    ON ebrs(mbr_id);

      CREATE TABLE IF NOT EXISTS ebr_step_executions (
        id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id             UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        mbr_step_id        UUID REFERENCES mbr_steps(id),
        step_number        INTEGER NOT NULL,
        step_name          VARCHAR(200) NOT NULL,
        phase_name         VARCHAR(200),
        instruction        TEXT,
        is_critical        BOOLEAN DEFAULT FALSE,
        is_gmp_critical    BOOLEAN DEFAULT FALSE,
        duration_min       DECIMAL(8,2),
        actual_duration_min DECIMAL(8,2),
        status             VARCHAR(30) NOT NULL DEFAULT 'Pending',
        operator_id        UUID REFERENCES users(id),
        verifier_id        UUID REFERENCES users(id),
        started_at         TIMESTAMPTZ,
        completed_at       TIMESTAMPTZ,
        verified_at        TIMESTAMPTZ,
        deviation_notes    TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ebr_parameter_values (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id            UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        step_execution_id UUID REFERENCES ebr_step_executions(id),
        parameter_id      UUID REFERENCES mbr_step_parameters(id),
        param_name        VARCHAR(200),
        target_value      VARCHAR(100),
        unit              VARCHAR(50),
        lower_limit       DECIMAL(12,4),
        upper_limit       DECIMAL(12,4),
        actual_value      VARCHAR(100),
        in_spec           BOOLEAN,
        is_cpp            BOOLEAN DEFAULT FALSE,
        is_cqa            BOOLEAN DEFAULT FALSE,
        recorded_by       UUID REFERENCES users(id),
        recorded_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ebr_deviations (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id            UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        step_execution_id UUID REFERENCES ebr_step_executions(id),
        parameter_value_id UUID REFERENCES ebr_parameter_values(id),
        deviation_type    VARCHAR(100) DEFAULT 'Process Deviation',
        severity          VARCHAR(20) DEFAULT 'Minor',
        description       TEXT NOT NULL,
        expected_value    VARCHAR(200),
        actual_value      VARCHAR(200),
        immediate_action  TEXT,
        root_cause        TEXT,
        corrective_action TEXT,
        status            VARCHAR(30) NOT NULL DEFAULT 'Open',
        reported_by       UUID REFERENCES users(id),
        resolved_by       UUID REFERENCES users(id),
        resolved_at       TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ebr_material_consumptions (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id            UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        step_execution_id UUID REFERENCES ebr_step_executions(id),
        material_code     VARCHAR(100),
        material_name     VARCHAR(200) NOT NULL,
        lot_number        VARCHAR(100),
        quantity_required DECIMAL(12,4),
        quantity_dispensed DECIMAL(12,4),
        unit              VARCHAR(30),
        tare_weight       DECIMAL(12,4),
        gross_weight      DECIMAL(12,4),
        net_weight        DECIMAL(12,4),
        expiry_date       DATE,
        verified_by       UUID REFERENCES users(id),
        verified_at       TIMESTAMPTZ,
        dispensed_by      UUID REFERENCES users(id),
        dispensed_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ebr_equipment_usage (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id            UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        step_execution_id UUID REFERENCES ebr_step_executions(id),
        equipment_code    VARCHAR(100),
        equipment_name    VARCHAR(200) NOT NULL,
        equipment_id      UUID,
        clean_status      VARCHAR(50),
        qualification_status VARCHAR(50),
        usage_start       TIMESTAMPTZ,
        usage_end         TIMESTAMPTZ,
        notes             TEXT,
        logged_by         UUID REFERENCES users(id),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ebr_ipc_results (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id            UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        step_execution_id UUID REFERENCES ebr_step_executions(id),
        ipc_check_id      UUID,
        check_name        VARCHAR(200) NOT NULL,
        check_type        VARCHAR(100),
        specification     VARCHAR(300),
        actual_result     VARCHAR(300),
        unit              VARCHAR(50),
        pass_fail         VARCHAR(10) NOT NULL DEFAULT 'Pass',
        tested_by         UUID REFERENCES users(id),
        tested_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ebr_yield_records (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id          UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        phase_name      VARCHAR(200),
        stage           VARCHAR(50) DEFAULT 'In Process',
        theoretical_qty DECIMAL(12,4),
        actual_qty      DECIMAL(12,4),
        yield_pct       DECIMAL(5,2) GENERATED ALWAYS AS
                          (CASE WHEN theoretical_qty > 0
                                THEN ROUND((actual_qty / theoretical_qty * 100)::numeric, 2)
                                ELSE NULL END) STORED,
        unit            VARCHAR(30),
        recorded_by     UUID REFERENCES users(id),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ebr_release_signatures (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        ebr_id            UUID NOT NULL REFERENCES ebrs(id) ON DELETE CASCADE,
        signature_role    VARCHAR(50) NOT NULL,
        signer_id         UUID NOT NULL REFERENCES users(id),
        signer_email      VARCHAR(200),
        signature_meaning TEXT,
        password_verified BOOLEAN NOT NULL DEFAULT FALSE,
        signed_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── equipment (services use 'equipment', not 'equipment_master') ────────
      CREATE TABLE IF NOT EXISTS equipment (
        id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        equipment_code           VARCHAR(50) NOT NULL UNIQUE,
        equipment_name           VARCHAR(200) NOT NULL,
        equipment_type           VARCHAR(100) NOT NULL,
        manufacturer             VARCHAR(200),
        model                    VARCHAR(100),
        serial_number            VARCHAR(100),
        location                 VARCHAR(200),
        area                     VARCHAR(100),
        gmp_critical             BOOLEAN DEFAULT FALSE,
        calibration_interval_days INTEGER DEFAULT 365,
        last_calibration         DATE,
        calibration_due          DATE,
        clean_status             VARCHAR(50) DEFAULT 'Clean',
        qualification_status     VARCHAR(30) DEFAULT 'Not Qualified',
        status                   VARCHAR(30) NOT NULL DEFAULT 'Available',
        created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS equipment_calibrations (
        id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        equipment_id     UUID NOT NULL REFERENCES equipment(id) ON DELETE CASCADE,
        calibration_date DATE NOT NULL,
        next_due         DATE,
        performed_by     VARCHAR(200),
        certificate_ref  VARCHAR(200),
        result           VARCHAR(30) DEFAULT 'Pass',
        notes            TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── training ──────────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS training_curricula (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        course_code         VARCHAR(50) NOT NULL UNIQUE,
        course_name         VARCHAR(200) NOT NULL,
        description         TEXT,
        required_for_roles  TEXT[] DEFAULT '{}',
        validity_months     INTEGER DEFAULT 12,
        is_active           BOOLEAN NOT NULL DEFAULT TRUE,
        created_by          UUID REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS training_records (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        curriculum_id  UUID NOT NULL REFERENCES training_curricula(id),
        user_id        UUID NOT NULL REFERENCES users(id),
        assigned_by    UUID REFERENCES users(id),
        status         VARCHAR(30) NOT NULL DEFAULT 'Pending',
        due_date       DATE,
        completed_at   TIMESTAMPTZ,
        completed_by   UUID REFERENCES users(id),
        expiry_date    TIMESTAMPTZ,
        score          DECIMAL(5,2),
        evidence_notes TEXT,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── change control ────────────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS change_request_types (
        id                        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        type_code                 VARCHAR(50) NOT NULL UNIQUE,
        type_name                 VARCHAR(200) NOT NULL,
        description               TEXT,
        approval_chain            TEXT[] DEFAULT '{}',
        requires_impact_assessment BOOLEAN DEFAULT FALSE,
        is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
        created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS change_requests (
        id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        cr_number              VARCHAR(30) NOT NULL UNIQUE,
        type_id                UUID NOT NULL REFERENCES change_request_types(id),
        title                  VARCHAR(300) NOT NULL,
        description            TEXT,
        justification          TEXT,
        impact_assessment      TEXT,
        risk_level             VARCHAR(20) DEFAULT 'Medium',
        priority               VARCHAR(20) DEFAULT 'Normal',
        status                 VARCHAR(30) NOT NULL DEFAULT 'Draft',
        mbr_id                 UUID REFERENCES mbrs(id),
        requested_by           UUID NOT NULL REFERENCES users(id),
        current_approver_index INTEGER DEFAULT 0,
        implementation_notes   TEXT,
        implemented_by         UUID REFERENCES users(id),
        implemented_at         TIMESTAMPTZ,
        verification_notes     TEXT,
        verified_by            UUID REFERENCES users(id),
        verified_at            TIMESTAMPTZ,
        closed_by              UUID REFERENCES users(id),
        closed_at              TIMESTAMPTZ,
        created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS change_approvals (
        id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        change_request_id UUID NOT NULL REFERENCES change_requests(id) ON DELETE CASCADE,
        approval_step     VARCHAR(100),
        step_index        INTEGER NOT NULL DEFAULT 0,
        status            VARCHAR(30) NOT NULL DEFAULT 'Pending',
        approver_id       UUID REFERENCES users(id),
        comments          TEXT,
        decided_at        TIMESTAMPTZ,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── compliance features ───────────────────────────────────────────────
      CREATE TABLE IF NOT EXISTS risk_assessments (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        mbr_id          UUID NOT NULL REFERENCES mbrs(id) ON DELETE CASCADE,
        step_id         UUID REFERENCES mbr_steps(id),
        parameter_id    UUID REFERENCES mbr_step_parameters(id),
        hazard          VARCHAR(300) NOT NULL,
        hazard_category VARCHAR(100) DEFAULT 'Process',
        severity        INTEGER NOT NULL CHECK (severity BETWEEN 1 AND 10),
        probability     INTEGER NOT NULL CHECK (probability BETWEEN 1 AND 10),
        detectability   INTEGER NOT NULL CHECK (detectability BETWEEN 1 AND 10),
        rpn             INTEGER GENERATED ALWAYS AS (severity * probability * detectability) STORED,
        risk_level      VARCHAR(20) GENERATED ALWAYS AS (
                          CASE
                            WHEN severity * probability * detectability >= 200 THEN 'Critical'
                            WHEN severity * probability * detectability >= 100 THEN 'High'
                            WHEN severity * probability * detectability >= 50  THEN 'Medium'
                            ELSE 'Low'
                          END
                        ) STORED,
        mitigation      TEXT,
        residual_rpn    INTEGER,
        status          VARCHAR(30) DEFAULT 'Open',
        assessed_by     UUID REFERENCES users(id),
        reviewed_by     UUID REFERENCES users(id),
        reviewed_at     TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS periodic_reviews (
        id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        review_type         VARCHAR(100) NOT NULL,
        title               VARCHAR(300) NOT NULL,
        description         TEXT,
        frequency_months    INTEGER DEFAULT 12,
        status              VARCHAR(30) NOT NULL DEFAULT 'Scheduled',
        next_due            DATE,
        last_completed      TIMESTAMPTZ,
        completed_at        TIMESTAMPTZ,
        completed_by        UUID REFERENCES users(id),
        findings            TEXT,
        corrective_actions  TEXT,
        assigned_to         UUID REFERENCES users(id),
        created_by          UUID REFERENCES users(id),
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS ai_model_registry (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        model_name      VARCHAR(200) NOT NULL,
        model_version   VARCHAR(50) NOT NULL,
        provider        VARCHAR(100) NOT NULL,
        prompt_hash     VARCHAR(128),
        prompt_version  TEXT,
        description     TEXT,
        risk_level      VARCHAR(20) DEFAULT 'Medium',
        status          VARCHAR(30) DEFAULT 'Active',
        validated_by    UUID REFERENCES users(id),
        validated_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(model_name, model_version)
      );

      CREATE TABLE IF NOT EXISTS ai_performance_metrics (
        id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        model_id        UUID NOT NULL REFERENCES ai_model_registry(id),
        period_start    TIMESTAMPTZ NOT NULL,
        period_end      TIMESTAMPTZ NOT NULL,
        total_proposals INTEGER DEFAULT 0,
        accepted        INTEGER DEFAULT 0,
        rejected        INTEGER DEFAULT 0,
        modified        INTEGER DEFAULT 0,
        avg_confidence  DECIMAL(5,2),
        acceptance_rate DECIMAL(5,4),
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS system_config_snapshots (
        id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        snapshot_type  VARCHAR(50) NOT NULL,
        version_tag    VARCHAR(100),
        git_sha        VARCHAR(40),
        content        JSONB,
        content_hash   VARCHAR(128),
        created_by     UUID REFERENCES users(id),
        created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      -- ── Seed change request types (idempotent) ────────────────────────────
      INSERT INTO change_request_types (type_code, type_name, description, approval_chain, requires_impact_assessment)
      VALUES
        ('MBR-CHANGE',   'MBR Change',              'Changes to master batch record content',         ARRAY['qa_reviewer','admin'],              true),
        ('PROC-CHANGE',  'Process Change',           'Changes to manufacturing process parameters',   ARRAY['designer','qa_reviewer','admin'],   true),
        ('EQUIP-CHANGE', 'Equipment Change',         'Equipment modifications or replacements',       ARRAY['designer','qa_reviewer'],           false),
        ('DOC-CHANGE',   'Document Change',          'Documentation and SOP updates',                 ARRAY['qa_reviewer'],                      false),
        ('SW-CHANGE',    'Software/System Change',   'System configuration or software updates',      ARRAY['admin','qa_reviewer'],              true)
      ON CONFLICT (type_code) DO NOTHING;
    `,
  },
];
async function runMigrations() {
  console.log('  -> Running ' + MIGRATIONS.length + ' migrations...');
  for (var i = 0; i < MIGRATIONS.length; i++) {
    var m = MIGRATIONS[i];
    try {
      await pool.query(m.sql);
      console.log('     ✓ ' + m.name);
    } catch (err) {
      console.error('     ✗ ' + m.name + ' FAILED:', err.message);
      throw err;
    }
  }
  console.log('  -> All migrations complete.\n');
}

module.exports = { pool, query, transaction, runMigrations };
