// server/__tests__/training.test.js
// GAMP5 D6 | 21 CFR Part 11 §11.10(i) — Training management
// Validates: curricula CRUD, assignment, completion, expiry, access gating, matrix report

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken,
} = require('./helpers/setup');

const app = createTestApp();

beforeAll(async () => { await setupTestDB(); });
afterAll(async () => { await teardownTestDB(); await closePool(); });

// ════════════════════════════════════════════════════════════════
// CURRICULA CRUD
// ════════════════════════════════════════════════════════════════

describe('Training curricula management', () => {
  test('list curricula returns seeded courses', async () => {
    const res = await request(app)
      .get('/api/training/curricula')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(6); // 6 seeded courses
    expect(res.body.data.some(c => c.course_code === 'GMP-001')).toBe(true);
    expect(res.body.data.some(c => c.course_code === 'ESIG-001')).toBe(true);
  });

  test('admin can create a new curriculum', async () => {
    const res = await request(app)
      .post('/api/training/curricula')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({
        course_code: 'TEST-001',
        course_name: 'Test Course for Automation',
        description: 'Created by automated test',
        required_for_roles: ['designer'],
        validity_months: 6,
      });

    expect(res.status).toBe(201);
    expect(res.body.course_code).toBe('TEST-001');
    expect(res.body.validity_months).toBe(6);
    expect(res.body.required_for_roles).toContain('designer');
  });

  test('duplicate course_code returns 409', async () => {
    const res = await request(app)
      .post('/api/training/curricula')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ course_code: 'GMP-001', course_name: 'Duplicate' });

    expect(res.status).toBe(409);
  });

  test('designer CANNOT create curricula (lacks config:write)', async () => {
    const res = await request(app)
      .post('/api/training/curricula')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ course_code: 'FAIL-001', course_name: 'Should fail' });

    expect(res.status).toBe(403);
  });

  test('admin can update curriculum', async () => {
    const list = await request(app).get('/api/training/curricula').set('Authorization', `Bearer ${getToken('admin')}`);
    const testCourse = list.body.data.find(c => c.course_code === 'TEST-001');

    const res = await request(app)
      .put(`/api/training/curricula/${testCourse.id}`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ validity_months: 18 });

    expect(res.status).toBe(200);
    expect(res.body.validity_months).toBe(18);
  });
});

// ════════════════════════════════════════════════════════════════
// TRAINING STATUS — current user's compliance view
// ════════════════════════════════════════════════════════════════

describe('My training status (Part 11 §11.10(i))', () => {
  test('trained user shows as compliant', async () => {
    const res = await request(app)
      .get('/api/training/my-status')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.compliant).toBe(true);
    expect(res.body.completed).toBe(res.body.total_required);
    expect(res.body.details).toBeDefined();
    expect(Array.isArray(res.body.details)).toBe(true);
  });

  test('status details include curriculum info and record', async () => {
    const res = await request(app)
      .get('/api/training/my-status')
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    for (const detail of res.body.details) {
      expect(detail.curriculum).toBeDefined();
      expect(detail.curriculum.course_code).toBeDefined();
      expect(['complete','missing','pending']).toContain(detail.status);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// ASSIGNMENT & COMPLETION WORKFLOW
// ════════════════════════════════════════════════════════════════

describe('Training assignment and completion workflow', () => {
  let newUserId = 'aa000099-0000-4000-a000-000000000099';
  let assignedRecordId;

  beforeAll(async () => {
    // Create a fresh user WITHOUT auto-completed training
    const bcrypt = require('bcrypt');
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    await query(
      `INSERT INTO users (id, email, password_hash, full_name, role, department)
       VALUES ($1,'untrained@test.com',$2,'Untrained User','designer','Test')
       ON CONFLICT (id) DO UPDATE SET password_hash=$2, is_active=true`,
      [newUserId, hash]
    );
  });

  afterAll(async () => {
    await query('DELETE FROM training_records WHERE user_id=$1', [newUserId]);
    await query('DELETE FROM users WHERE id=$1', [newUserId]);
  });

  test('bulk assign all required training for a user', async () => {
    const res = await request(app)
      .post('/api/training/assign-required')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ user_id: newUserId });

    expect(res.status).toBe(201);
    expect(res.body.assigned.length).toBeGreaterThanOrEqual(1);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  test('list records for the new user shows pending', async () => {
    const res = await request(app)
      .get(`/api/training/records?user_id=${newUserId}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].status).toBe('Pending');
    assignedRecordId = res.body.data[0].id;
  });

  test('duplicate assignment returns 409', async () => {
    const curricula = await request(app).get('/api/training/curricula').set('Authorization', `Bearer ${getToken('admin')}`);
    const gmp = curricula.body.data.find(c => c.course_code === 'GMP-001');

    const res = await request(app)
      .post('/api/training/assign')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ curriculum_id: gmp.id, user_id: newUserId });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already assigned/);
  });

  test('complete a training record with score and evidence', async () => {
    const res = await request(app)
      .put(`/api/training/records/${assignedRecordId}/complete`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ score: 92.5, evidence_notes: 'Passed assessment on 2026-03-31, trainer: J. Patel' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Completed');
    expect(parseFloat(res.body.score)).toBe(92.5);
    expect(res.body.expiry_date).toBeDefined();
    expect(res.body.evidence_notes).toMatch(/J. Patel/);
  });

  test('completing already-completed record returns 400', async () => {
    const res = await request(app)
      .put(`/api/training/records/${assignedRecordId}/complete`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ score: 95 });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already completed/);
  });
});

// ════════════════════════════════════════════════════════════════
// ACCESS GATING — untrained users blocked from MBR features
// ════════════════════════════════════════════════════════════════

describe('Access gating (Part 11 §11.10(i) enforcement)', () => {
  let untrainedUserId = 'aa000088-0000-4000-a000-000000000088';
  let untrainedToken;

  beforeAll(async () => {
    const bcrypt = require('bcrypt');
    const { generateToken } = require('../middleware/middleware');
    const hash = await bcrypt.hash(TEST_PASSWORD, 10);
    await query(
      `INSERT INTO users (id, email, password_hash, full_name, role, department)
       VALUES ($1,'gated@test.com',$2,'Gated User','designer','Test')
       ON CONFLICT (id) DO UPDATE SET password_hash=$2, is_active=true`,
      [untrainedUserId, hash]
    );
    untrainedToken = generateToken({
      id: untrainedUserId, email: 'gated@test.com', full_name: 'Gated User', role: 'designer',
    });
  });

  afterAll(async () => {
    await query('DELETE FROM training_records WHERE user_id=$1', [untrainedUserId]);
    await query('DELETE FROM users WHERE id=$1', [untrainedUserId]);
  });

  test('untrained user is BLOCKED from listing MBRs', async () => {
    const res = await request(app)
      .get('/api/mbr')
      .set('Authorization', `Bearer ${untrainedToken}`);

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Training requirement/);
    expect(res.body.missing_training).toBeDefined();
    expect(res.body.missing_training.length).toBeGreaterThanOrEqual(1);
    expect(res.body.training_status.completed).toBe(0);
  });

  test('untrained user is BLOCKED from creating MBR', async () => {
    const res = await request(app)
      .post('/api/mbr')
      .set('Authorization', `Bearer ${untrainedToken}`)
      .send({ product_name: 'Should be blocked' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Training requirement/);
  });

  test('untrained user CAN still access training status', async () => {
    const res = await request(app)
      .get('/api/training/my-status')
      .set('Authorization', `Bearer ${untrainedToken}`);

    expect(res.status).toBe(200);
    expect(res.body.compliant).toBe(false);
  });

  test('trained user CAN access MBR features', async () => {
    // Use admin — designer is non-compliant due to TEST-001 created earlier in this file
    const res = await request(app)
      .get('/api/mbr')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// EXPIRY & REMINDERS
// ════════════════════════════════════════════════════════════════

describe('Training expiry management', () => {
  test('expiring endpoint returns upcoming expirations', async () => {
    const res = await request(app)
      .get('/api/training/expiring?days=400')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.days_ahead).toBe(400);
  });

  test('expire-check endpoint runs without error', async () => {
    const res = await request(app)
      .post('/api/training/expire-check')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.expired_count).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// TRAINING MATRIX — full compliance report
// ════════════════════════════════════════════════════════════════

describe('Training matrix report', () => {
  test('matrix endpoint returns full user × course grid', async () => {
    const res = await request(app)
      .get('/api/training/matrix')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.generated_at).toBeDefined();
    expect(res.body.total_users).toBeGreaterThanOrEqual(1);
    expect(res.body.total_courses).toBeGreaterThanOrEqual(6);
    expect(res.body.matrix).toBeDefined();
    expect(Array.isArray(res.body.matrix)).toBe(true);

    // Each matrix row has user info + courses array
    const firstRow = res.body.matrix[0];
    expect(firstRow.full_name).toBeDefined();
    expect(firstRow.role).toBeDefined();
    expect(firstRow.courses).toBeDefined();
    expect(firstRow.courses.length).toBeGreaterThanOrEqual(1);

    // Each course entry has status
    const firstCourse = firstRow.courses[0];
    expect(firstCourse.course_code).toBeDefined();
    expect(firstCourse.status).toBeDefined();
    expect(['Complete', 'Missing', 'Pending', 'Expired', 'N/A']).toContain(firstCourse.status);
  });

  test('user-specific training status endpoint works', async () => {
    const res = await request(app)
      .get(`/api/training/user/${TEST_USERS.designer.id}/status`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.details).toBeDefined();
    expect(res.body.total_required).toBeGreaterThanOrEqual(1);
    expect(res.body.completed).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════
// AUDIT TRAIL — training actions are logged
// ════════════════════════════════════════════════════════════════

describe('Training audit trail', () => {
  test('curriculum creation generates audit record', async () => {
    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_type='TRAINING_CURRICULUM' AND action='CREATE' LIMIT 1"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('training completion generates audit record', async () => {
    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_type='TRAINING_RECORD' AND action='UPDATE' AND details LIKE '%completed%' LIMIT 1"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});
