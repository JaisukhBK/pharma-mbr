// server/__tests__/helpers/setup.js — Test lifecycle management
// GAMP5 D6: Reproducible test environment with known initial state

const bcrypt = require('bcrypt');
const { pool, query, initializeDatabase } = require('../../db/pool');
const { generateToken, PERMS } = require('../../middleware/middleware');

// ════════════════════════════════════════════════════════════════
// TEST USER FIXTURES — valid hex UUIDs for PostgreSQL
// ════════════════════════════════════════════════════════════════

const TEST_PASSWORD = 'TestPass123!';
const TEST_USERS = {
  admin: {
    id: 'aa000001-0000-4000-a000-000000000001',
    email: 'test.admin@pharma-test.com',
    full_name: 'Test Admin',
    role: 'admin',
    department: 'QA',
    employee_id: 'T-001',
  },
  designer: {
    id: 'aa000002-0000-4000-a000-000000000002',
    email: 'test.designer@pharma-test.com',
    full_name: 'Test Designer',
    role: 'designer',
    department: 'Process Dev',
    employee_id: 'T-002',
  },
  qa_reviewer: {
    id: 'aa000003-0000-4000-a000-000000000003',
    email: 'test.qa@pharma-test.com',
    full_name: 'Test QA Reviewer',
    role: 'qa_reviewer',
    department: 'Quality',
    employee_id: 'T-003',
  },
  operator: {
    id: 'aa000004-0000-4000-a000-000000000004',
    email: 'test.operator@pharma-test.com',
    full_name: 'Test Operator',
    role: 'production_operator',
    department: 'Manufacturing',
    employee_id: 'T-004',
  },
  viewer: {
    id: 'aa000005-0000-4000-a000-000000000005',
    email: 'test.viewer@pharma-test.com',
    full_name: 'Test Viewer',
    role: 'viewer',
    department: 'Regulatory',
    employee_id: 'T-005',
  },
};

// ════════════════════════════════════════════════════════════════
// LIFECYCLE HOOKS
// ════════════════════════════════════════════════════════════════

async function setupTestDB() {
  await initializeDatabase();
  const hash = await bcrypt.hash(TEST_PASSWORD, 10);

  for (const u of Object.values(TEST_USERS)) {
    await query(
      `INSERT INTO users (id, email, password_hash, full_name, role, department, employee_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         password_hash=$3, login_attempts=0, locked_until=NULL, is_active=true`,
      [u.id, u.email, hash, u.full_name, u.role, u.department, u.employee_id]
    );

    // Auto-complete all required training for test users (so MBR access gate passes)
    const curricula = await query(
      "SELECT id, validity_months FROM training_curricula WHERE is_active=true AND $1=ANY(required_for_roles)",
      [u.role]
    );
    for (const c of curricula.rows) {
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + (c.validity_months || 12));
      await query(
        `INSERT INTO training_records (curriculum_id, user_id, status, assigned_by, completed_at, completed_by, expiry_date, evidence_notes)
         VALUES ($1,$2,'Completed',$3,NOW(),$3,$4,'Auto-completed for test environment')
         ON CONFLICT DO NOTHING`,
        [c.id, u.id, u.id, expiry.toISOString()]
      );
    }
  }
}

async function teardownTestDB() {
  const testIds = Object.values(TEST_USERS).map(u => `'${u.id}'`).join(',');

  await query(`DELETE FROM co_designer_proposals WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM co_designer_sessions WHERE user_id IN (${testIds})`);
  await query(`DELETE FROM training_records WHERE user_id IN (${testIds})`);
  await query(`DELETE FROM ebr_step_executions WHERE ebr_id IN (SELECT id FROM ebrs WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds})))`);
  await query(`DELETE FROM ebrs WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_signatures WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_formulas WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_attachments WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_ipc_checks WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_step_equipment WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_step_materials WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_step_parameters WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_steps WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_phases WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_versions WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbr_bom_items WHERE mbr_id IN (SELECT id FROM mbrs WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM mbrs WHERE created_by IN (${testIds})`);
  await query(`DELETE FROM mbr_status_transitions WHERE user_id IN (${testIds})`);
  // Change control cleanup
  await query(`DELETE FROM change_approvals WHERE change_request_id IN (SELECT id FROM change_requests WHERE requested_by IN (${testIds}))`);
  await query(`DELETE FROM change_requests WHERE requested_by IN (${testIds})`);
  // Training cleanup — must delete records referencing test-created curricula BEFORE deleting curricula
  await query(`DELETE FROM training_records WHERE curriculum_id IN (SELECT id FROM training_curricula WHERE created_by IN (${testIds}))`);
  await query(`DELETE FROM training_curricula WHERE created_by IN (${testIds})`);
  await query(`DELETE FROM audit_trail WHERE user_id IN (${testIds})`);
  await query(`DELETE FROM users WHERE id IN (${testIds})`);
}

async function closePool() {
  await pool.end();
}

// ════════════════════════════════════════════════════════════════
// AUTH HELPERS
// ════════════════════════════════════════════════════════════════

function getToken(role) {
  const u = TEST_USERS[role];
  if (!u) throw new Error(`Unknown test role: ${role}`);
  return generateToken({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
  });
}

async function createTestMBR(overrides = {}) {
  const code = 'TEST-MBR-' + Date.now().toString(36).toUpperCase();
  const defaults = {
    mbr_code: code,
    product_name: 'Test Product 500mg',
    product_code: 'TEST-500',
    dosage_form: 'Tablet',
    batch_size: 100000,
    batch_size_unit: 'tablets',
    description: 'Automated test MBR',
    status: 'Draft',
    created_by: TEST_USERS.designer.id,
  };
  const d = { ...defaults, ...overrides };
  const r = await query(
    `INSERT INTO mbrs (mbr_code,product_name,product_code,dosage_form,batch_size,batch_size_unit,description,status,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [d.mbr_code, d.product_name, d.product_code, d.dosage_form, d.batch_size, d.batch_size_unit, d.description, d.status, d.created_by]
  );
  return r.rows[0];
}

async function resetLoginState(userId) {
  await query('UPDATE users SET login_attempts=0, locked_until=NULL WHERE id=$1', [userId]);
}

module.exports = {
  TEST_PASSWORD,
  TEST_USERS,
  setupTestDB,
  teardownTestDB,
  closePool,
  getToken,
  createTestMBR,
  resetLoginState,
};
