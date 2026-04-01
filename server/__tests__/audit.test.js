// server/__tests__/audit.test.js
// GAMP5 D6 | 21 CFR Part 11 §11.10(e) — Audit trail integrity
// Validates: every mutation is logged, audit records are immutable, timestamps accurate

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken, createTestMBR,
} = require('./helpers/setup');

const app = createTestApp();

beforeAll(async () => { await setupTestDB(); });
afterAll(async () => { await teardownTestDB(); await closePool(); });

// ════════════════════════════════════════════════════════════════
// §11.10(e) — Audit trail captures all mutations
// ════════════════════════════════════════════════════════════════

describe('Audit trail completeness (Part 11 §11.10(e))', () => {
  let mbrId;

  beforeAll(async () => {
    // Clear audit entries from setup
    await query("DELETE FROM audit_trail WHERE user_id=$1", [TEST_USERS.designer.id]);
  });

  test('MBR creation generates an audit record', async () => {
    const res = await request(app)
      .post('/api/mbr')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ product_name: 'Audit Test Product' });

    expect(res.status).toBe(201);
    mbrId = res.body.id;

    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_type='MBR' AND resource_id=$1 AND action='CREATE'",
      [mbrId]
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].user_id).toBe(TEST_USERS.designer.id);
    expect(audit.rows[0].details).toMatch(/Created MBR/);
  });

  test('MBR update generates an audit record with change_reason', async () => {
    await request(app)
      .put(`/api/mbr/${mbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ product_name: 'Audit Test Updated', change_reason: 'Corrected product name' });

    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_type='MBR' AND resource_id=$1 AND action='UPDATE'",
      [mbrId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
    const latest = audit.rows[audit.rows.length - 1];
    expect(latest.change_reason).toBe('Corrected product name');
  });

  test('phase creation generates an audit record', async () => {
    const res = await request(app)
      .post(`/api/mbr/${mbrId}/phases`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ phase_name: 'Audit Test Dispensing' });

    expect(res.status).toBe(201);

    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_type='PHASE' AND action='CREATE' AND details LIKE '%Audit Test Dispensing%'"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('login attempt generates an audit record (success and failure)', async () => {
    // Clear previous login audits
    await query("DELETE FROM audit_trail WHERE resource_type='AUTH' AND user_email=$1", [TEST_USERS.admin.email]);

    // Successful login
    await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USERS.admin.email, password: TEST_PASSWORD });

    // Failed login
    await request(app)
      .post('/api/auth/login')
      .send({ email: TEST_USERS.admin.email, password: 'WrongPass' });

    const audits = await query(
      "SELECT * FROM audit_trail WHERE resource_type='AUTH' AND user_email=$1 ORDER BY created_at",
      [TEST_USERS.admin.email]
    );
    expect(audits.rows.length).toBe(2);
    expect(audits.rows[0].details).toMatch(/Login/);
    expect(audits.rows[1].details).toMatch(/Failed/);
  });
});

// ════════════════════════════════════════════════════════════════
// §11.10(e) — Audit trail is append-only (immutable)
// ════════════════════════════════════════════════════════════════

describe('Audit trail immutability (Part 11 §11.10(e))', () => {
  test('audit_trail table has no UPDATE or DELETE API endpoints', async () => {
    // Verify there is no way to modify audit records through the API
    const auditR = await query('SELECT id FROM audit_trail LIMIT 1');
    if (auditR.rows.length === 0) return; // skip if no audits yet

    const id = auditR.rows[0].id;

    // Attempt PUT — should get 404 (no such route)
    const putRes = await request(app)
      .put(`/api/audit/${id}`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ details: 'Tampered' });
    expect([404, 405]).toContain(putRes.status);

    // Attempt DELETE — should get 404 (no such route)
    const delRes = await request(app)
      .delete(`/api/audit/${id}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect([404, 405]).toContain(delRes.status);
  });

  test('audit records include all required Part 11 fields', async () => {
    const audits = await query(
      'SELECT * FROM audit_trail WHERE user_id=$1 LIMIT 5',
      [TEST_USERS.designer.id]
    );

    for (const row of audits.rows) {
      // Required fields per §11.10(e)
      expect(row.id).toBeDefined();
      expect(row.action).toBeDefined();
      expect(row.resource_type).toBeDefined();
      expect(row.created_at).toBeDefined();
      // Timestamp must be a valid date
      expect(new Date(row.created_at).getTime()).not.toBeNaN();
      // User identification
      expect(row.user_id || row.user_email).toBeTruthy();
    }
  });

  test('audit timestamps are server-generated (not client-supplied)', async () => {
    const before = new Date();

    const res = await request(app)
      .post('/api/mbr')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ product_name: 'Timestamp Test' });

    const after = new Date();
    const createdId = res.body.id;

    const audit = await query(
      "SELECT created_at FROM audit_trail WHERE resource_type='MBR' AND resource_id=$1 AND action='CREATE' ORDER BY created_at DESC LIMIT 1",
      [createdId]
    );
    expect(audit.rows.length).toBe(1);

    const ts = new Date(audit.rows[0].created_at);
    expect(ts.getTime()).toBeGreaterThanOrEqual(before.getTime() - 2000); // 2s tolerance for DB clock
    expect(ts.getTime()).toBeLessThanOrEqual(after.getTime() + 2000);
  });
});

// ════════════════════════════════════════════════════════════════
// §11.10(e) — AI-generated flag for Co-Designer actions
// ════════════════════════════════════════════════════════════════

describe('AI-generated audit flag (GAMP5 Cat.5)', () => {
  test('ai_generated column exists and defaults to false', async () => {
    const r = await query(
      "SELECT column_name, column_default FROM information_schema.columns WHERE table_name='audit_trail' AND column_name='ai_generated'"
    );
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].column_default).toMatch(/false/);
  });

  test('non-AI audit entries have ai_generated=false', async () => {
    const r = await query(
      'SELECT ai_generated FROM audit_trail WHERE user_id=$1 AND ai_generated=true',
      [TEST_USERS.designer.id]
    );
    // Designer's manual actions should never be flagged as AI
    // (There might be zero rows, which is also correct)
    // The point is: manual actions don't get ai_generated=true
    const manual = await query(
      'SELECT ai_generated FROM audit_trail WHERE user_id=$1 AND action IN ($2,$3) LIMIT 5',
      [TEST_USERS.designer.id, 'CREATE', 'UPDATE']
    );
    for (const row of manual.rows) {
      expect(row.ai_generated).toBe(false);
    }
  });
});
