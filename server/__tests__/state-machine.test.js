// server/__tests__/state-machine.test.js
// GAMP5 D6 | 21 CFR Part 11 §11.10(f) — Operational sequencing enforcement
// Validates: strict signature chain, edit locking after Reviewer, transition logging

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken, createTestMBR,
} = require('./helpers/setup');

const app = createTestApp();

let mbrId;

beforeAll(async () => {
  await setupTestDB();
  const mbr = await createTestMBR();
  mbrId = mbr.id;
});
afterAll(async () => { await teardownTestDB(); await closePool(); });

// Helper: sign as a specific role
async function signAs(role, sigRole, meaning) {
  return request(app)
    .post(`/api/mbr/${mbrId}/sign`)
    .set('Authorization', `Bearer ${getToken(role)}`)
    .send({
      signature_role: sigRole,
      signature_meaning: meaning || `I ${sigRole.toLowerCase()} this MBR`,
      password: TEST_PASSWORD,
    });
}

// ════════════════════════════════════════════════════════════════
// §11.10(f) — STRICT SIGNATURE SEQUENCING
// Author → Reviewer → Approver → QA_Approver
// ════════════════════════════════════════════════════════════════

describe('Strict signature sequencing (Part 11 §11.10(f))', () => {
  test('Reviewer CANNOT sign before Author', async () => {
    const res = await signAs('qa_reviewer', 'Reviewer', 'I have reviewed the content');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Author signature is required first/);
    expect(res.body.missing).toBe('Author');
  });

  test('Approver CANNOT sign before Author and Reviewer', async () => {
    const res = await signAs('admin', 'Approver', 'I approve this MBR');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Author signature is required first/);
    expect(res.body.missing).toBe('Author');
  });

  test('QA_Approver CANNOT sign before full chain', async () => {
    const res = await signAs('qa_reviewer', 'QA_Approver', 'QA final approval');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Author signature is required first/);
  });

  test('Author CAN sign on a fresh Draft MBR', async () => {
    const res = await signAs('designer', 'Author', 'I authored this Master Batch Record');
    expect(res.status).toBe(201);
    expect(res.body.signature.signature_role).toBe('Author');
    expect(res.body.mbr_status).toBe('Draft'); // Author doesn't change status
    expect(res.body.next_signature).toBe('Reviewer');
  });

  test('Author CANNOT sign twice (duplicate blocked)', async () => {
    const res = await signAs('designer', 'Author', 'Duplicate attempt');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Author has already signed/);
  });

  test('Approver still CANNOT sign (Reviewer missing)', async () => {
    const res = await signAs('admin', 'Approver', 'I approve this MBR');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Reviewer signature is required first/);
    expect(res.body.missing).toBe('Reviewer');
  });

  test('Reviewer CAN now sign (Author done)', async () => {
    const res = await signAs('qa_reviewer', 'Reviewer', 'I have reviewed and verified the content');
    expect(res.status).toBe(201);
    expect(res.body.mbr_status).toBe('In Review');
    expect(res.body.next_signature).toBe('Approver');
  });

  test('Approver CAN now sign (Author + Reviewer done)', async () => {
    const res = await signAs('admin', 'Approver', 'I approve this MBR for manufacturing use');
    expect(res.status).toBe(201);
    expect(res.body.mbr_status).toBe('Approved');
    expect(res.body.next_signature).toBe('QA_Approver');
  });

  test('QA_Approver CAN now sign (full chain complete)', async () => {
    const res = await signAs('qa_reviewer', 'QA_Approver', 'QA final approval for production release');
    expect(res.status).toBe(201);
    expect(res.body.mbr_status).toBe('Effective');
    expect(res.body.next_signature).toBeNull(); // All done
  });
});

// ════════════════════════════════════════════════════════════════
// EDIT LOCKING — content edits blocked after Reviewer signs
// ════════════════════════════════════════════════════════════════

describe('Edit locking (locked after Reviewer signature)', () => {
  let editableMbrId;

  beforeAll(async () => {
    // Create a fresh MBR for edit lock testing
    const mbr = await createTestMBR({ created_by: TEST_USERS.designer.id });
    editableMbrId = mbr.id;
  });

  test('MBR in Draft is editable (no signatures yet)', async () => {
    const res = await request(app)
      .put(`/api/mbr/${editableMbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ description: 'Edit before any signature' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Edit before any signature');
  });

  test('MBR is still editable after Author signs (status still Draft)', async () => {
    // Author signs
    await request(app)
      .post(`/api/mbr/${editableMbrId}/sign`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ signature_role: 'Author', signature_meaning: 'I authored this MBR', password: TEST_PASSWORD });

    // Edit should still work
    const res = await request(app)
      .put(`/api/mbr/${editableMbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ description: 'Author correction — still editable' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Author correction — still editable');
  });

  test('Phase creation still works in Draft after Author signs', async () => {
    const res = await request(app)
      .post(`/api/mbr/${editableMbrId}/phases`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ phase_name: 'Post-Author Dispensing' });

    expect(res.status).toBe(201);
    expect(res.body.phase_name).toBe('Post-Author Dispensing');
  });

  test('After Reviewer signs, MBR update is BLOCKED', async () => {
    // Reviewer signs → status moves to In Review → edits locked
    await request(app)
      .post(`/api/mbr/${editableMbrId}/sign`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ signature_role: 'Reviewer', signature_meaning: 'I have reviewed the content', password: TEST_PASSWORD });

    const res = await request(app)
      .put(`/api/mbr/${editableMbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ description: 'Should be blocked' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked/i);
    expect(res.body.error).toMatch(/Reviewer signature/);
  });

  test('After Reviewer signs, phase creation is BLOCKED', async () => {
    const res = await request(app)
      .post(`/api/mbr/${editableMbrId}/phases`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ phase_name: 'Should fail' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked/i);
  });

  test('After Reviewer signs, BOM update is BLOCKED', async () => {
    const res = await request(app)
      .put(`/api/mbr/${editableMbrId}/bom`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked/i);
  });

  test('After Reviewer signs, batch-save is BLOCKED', async () => {
    const res = await request(app)
      .post(`/api/mbr/${editableMbrId}/batch-save`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mbr: { product_name: 'Blocked' }, phases: [], bom: [] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked/i);
  });
});

// ════════════════════════════════════════════════════════════════
// TRANSITION HISTORY — every status change recorded
// ════════════════════════════════════════════════════════════════

describe('Status transition log (Part 11 §11.10(f) evidence)', () => {
  test('transitions endpoint returns history for the fully-signed MBR', async () => {
    const res = await request(app)
      .get(`/api/mbr/${mbrId}/transitions`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    // Should have 3 transitions: Draft→In Review, In Review→Approved, Approved→Effective
    expect(res.body.data.length).toBe(3);

    const [t1, t2, t3] = res.body.data;
    expect(t1.from_status).toBe('Draft');
    expect(t1.to_status).toBe('In Review');
    expect(t1.triggered_by).toBe('Reviewer');

    expect(t2.from_status).toBe('In Review');
    expect(t2.to_status).toBe('Approved');
    expect(t2.triggered_by).toBe('Approver');

    expect(t3.from_status).toBe('Approved');
    expect(t3.to_status).toBe('Effective');
    expect(t3.triggered_by).toBe('QA_Approver');
  });

  test('next_signature is null when all signatures complete', async () => {
    const res = await request(app)
      .get(`/api/mbr/${mbrId}/transitions`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.body.next_signature).toBeNull();
  });

  test('Author signature does NOT create a transition (status unchanged)', async () => {
    // The fully-signed MBR should have exactly 3 transitions (no Author transition)
    const res = await request(app)
      .get(`/api/mbr/${mbrId}/transitions`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    const authorTransitions = res.body.data.filter(t => t.triggered_by === 'Author');
    expect(authorTransitions.length).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
// NEW VERSION — resets to Draft, clears signatures
// ════════════════════════════════════════════════════════════════

describe('New version resets lifecycle', () => {
  let versionMbrId;

  beforeAll(async () => {
    const mbr = await createTestMBR();
    versionMbrId = mbr.id;
    // Sign the full chain
    await request(app).post(`/api/mbr/${versionMbrId}/sign`).set('Authorization', `Bearer ${getToken('designer')}`).send({ signature_role: 'Author', signature_meaning: 'Author', password: TEST_PASSWORD });
    await request(app).post(`/api/mbr/${versionMbrId}/sign`).set('Authorization', `Bearer ${getToken('qa_reviewer')}`).send({ signature_role: 'Reviewer', signature_meaning: 'Reviewer', password: TEST_PASSWORD });
    await request(app).post(`/api/mbr/${versionMbrId}/sign`).set('Authorization', `Bearer ${getToken('admin')}`).send({ signature_role: 'Approver', signature_meaning: 'Approver', password: TEST_PASSWORD });
    await request(app).post(`/api/mbr/${versionMbrId}/sign`).set('Authorization', `Bearer ${getToken('qa_reviewer')}`).send({ signature_role: 'QA_Approver', signature_meaning: 'QA', password: TEST_PASSWORD });
  });

  test('creating new version resets status to Draft', async () => {
    const res = await request(app)
      .post(`/api/mbr/${versionMbrId}/new-version`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ change_reason: 'Post-approval amendment per CAPA-001' });

    expect(res.status).toBe(200);
    expect(res.body.new_version).toBe(2);

    const mbr = await query('SELECT status FROM mbrs WHERE id=$1', [versionMbrId]);
    expect(mbr.rows[0].status).toBe('Draft');
  });

  test('new Draft version is editable again', async () => {
    const res = await request(app)
      .put(`/api/mbr/${versionMbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ description: 'Version 2 edits' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Version 2 edits');
  });
});
