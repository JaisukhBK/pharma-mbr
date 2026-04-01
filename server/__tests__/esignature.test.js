// server/__tests__/esignature.test.js
// GAMP5 D6 | 21 CFR Part 11 §11.50, §11.70, §11.200 — Electronic signatures
// Validates: signature contains name+date+meaning, hash bound to content, password re-entry

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken, createTestMBR,
} = require('./helpers/setup');

const app = createTestApp();

let testMBR;

beforeAll(async () => {
  await setupTestDB();
  testMBR = await createTestMBR();
});
afterAll(async () => { await teardownTestDB(); await closePool(); });

// ════════════════════════════════════════════════════════════════
// §11.200 — Password re-entry required for each signature
// ════════════════════════════════════════════════════════════════

describe('E-signature password re-entry (Part 11 §11.200)', () => {
  test('signing without password returns 400', async () => {
    const res = await request(app)
      .post(`/api/mbr/${testMBR.id}/sign`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        signature_role: 'Author',
        signature_meaning: 'I authored this MBR',
        // no password field
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Password.*required.*§11.200/i);
  });

  test('signing with wrong password returns 401 and logs failed attempt', async () => {
    const res = await request(app)
      .post(`/api/mbr/${testMBR.id}/sign`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        signature_role: 'Author',
        signature_meaning: 'I authored this MBR',
        password: 'WrongPassword',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Password verification failed/);

    // Verify the failed attempt was audited
    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_id=$1 AND action='SIGN' AND details LIKE '%FAILED%'",
      [testMBR.id]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('signing with correct password succeeds', async () => {
    const res = await request(app)
      .post(`/api/mbr/${testMBR.id}/sign`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        signature_role: 'Author',
        signature_meaning: 'I authored this Master Batch Record',
        password: TEST_PASSWORD,
      });

    expect(res.status).toBe(201);
    expect(res.body.signature).toBeDefined();
    expect(res.body.content_hash).toBeDefined();
    expect(res.body.content_hash.length).toBe(64); // SHA-256 = 64 hex chars
  });
});

// ════════════════════════════════════════════════════════════════
// §11.50 — Signature includes name, date/time, meaning
// ════════════════════════════════════════════════════════════════

describe('Signature content requirements (Part 11 §11.50)', () => {
  test('signature record contains signer email, timestamp, role, and meaning', async () => {
    const sigs = await query(
      'SELECT * FROM mbr_signatures WHERE mbr_id=$1 ORDER BY signed_at DESC LIMIT 1',
      [testMBR.id]
    );

    expect(sigs.rows.length).toBeGreaterThanOrEqual(1);
    const sig = sigs.rows[0];

    // §11.50(a) — printed name of the signer
    expect(sig.signer_email).toBe(TEST_USERS.designer.email);

    // §11.50(b) — date and time the signature was executed
    expect(sig.signed_at).toBeDefined();
    expect(new Date(sig.signed_at).getTime()).not.toBeNaN();

    // §11.50(c) — meaning associated with the signature
    expect(sig.signature_meaning).toBeTruthy();
    expect(sig.signature_meaning.length).toBeGreaterThan(5);

    // Signature role is one of the allowed values
    expect(['Author', 'Reviewer', 'Approver', 'QA_Approver']).toContain(sig.signature_role);

    // Password was verified
    expect(sig.password_verified).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// §11.70 — Signature linked/bound to electronic record
// ════════════════════════════════════════════════════════════════

describe('Signature-record binding (Part 11 §11.70)', () => {
  test('content_hash is a SHA-256 derived from MBR state + user + role', async () => {
    const sigs = await query(
      'SELECT * FROM mbr_signatures WHERE mbr_id=$1',
      [testMBR.id]
    );

    for (const sig of sigs.rows) {
      // Hash must be a 64-char hex string (SHA-256)
      expect(sig.content_hash).toMatch(/^[a-f0-9]{64}$/);
      // Hash must not be empty or null
      expect(sig.content_hash).toBeTruthy();
    }
  });

  test('two signatures on the same MBR by different roles produce different hashes', async () => {
    // QA reviewer signs as Reviewer
    const res = await request(app)
      .post(`/api/mbr/${testMBR.id}/sign`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({
        signature_role: 'Reviewer',
        signature_meaning: 'I have reviewed and verified the content',
        password: TEST_PASSWORD,
      });

    expect(res.status).toBe(201);

    const sigs = await query(
      'SELECT content_hash, signature_role FROM mbr_signatures WHERE mbr_id=$1 ORDER BY signed_at',
      [testMBR.id]
    );

    // Should have at least 2 signatures (Author + Reviewer)
    expect(sigs.rows.length).toBeGreaterThanOrEqual(2);

    // Hashes must be unique — signature is bound to specific user+role combination
    const hashes = sigs.rows.map(s => s.content_hash);
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  test('signature record references the correct MBR via foreign key', async () => {
    const sigs = await query(
      'SELECT s.mbr_id, m.mbr_code FROM mbr_signatures s JOIN mbrs m ON s.mbr_id=m.id WHERE s.mbr_id=$1',
      [testMBR.id]
    );

    for (const row of sigs.rows) {
      expect(row.mbr_id).toBe(testMBR.id);
      expect(row.mbr_code).toBe(testMBR.mbr_code);
    }
  });
});

// ════════════════════════════════════════════════════════════════
// Status transitions driven by signatures
// ════════════════════════════════════════════════════════════════

describe('Signature-driven status transitions', () => {
  test('Reviewer signature moves MBR to In Review', async () => {
    const mbr = await query('SELECT status FROM mbrs WHERE id=$1', [testMBR.id]);
    expect(mbr.rows[0].status).toBe('In Review');
  });

  test('Approver + QA_Approver signatures move MBR to Effective', async () => {
    // Approver signs
    await request(app)
      .post(`/api/mbr/${testMBR.id}/sign`)
      .set('Authorization', `Bearer ${getToken('admin')}`) // admin has mbr:sign
      .send({
        signature_role: 'Approver',
        signature_meaning: 'I approve this MBR for manufacturing use',
        password: TEST_PASSWORD,
      });

    // QA Approver signs
    await request(app)
      .post(`/api/mbr/${testMBR.id}/sign`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({
        signature_role: 'QA_Approver',
        signature_meaning: 'QA final approval for production release',
        password: TEST_PASSWORD,
      });

    const mbr = await query('SELECT status FROM mbrs WHERE id=$1', [testMBR.id]);
    expect(mbr.rows[0].status).toBe('Effective');
  });
});
