// server/__tests__/codesigner.test.js
// GAMP5 D6 + D11 | Co-Designer AI workflow — human-in-the-loop enforcement
// Validates: mode toggle auth, proposal lifecycle, ai_generated flag, Part 11 §11.200

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

// ════════════════════════════════════════════════════════════════
// Co-Designer mode toggle — Part 11 §11.200 password for co_design
// ════════════════════════════════════════════════════════════════

describe('Co-Designer mode toggle (Part 11 §11.200)', () => {
  test('initial status is off/idle', async () => {
    const res = await request(app)
      .get(`/api/co-designer/${mbrId}/status`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('off');
  });

  test('toggle to assist mode without password succeeds', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mode: 'assist' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('assist');
  });

  test('toggle to co_design mode WITHOUT password returns 400', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mode: 'co_design' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Password required.*Part 11.*§11.200/i);
  });

  test('toggle to co_design mode with WRONG password returns 401', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mode: 'co_design', password: 'WrongPassword' });

    expect(res.status).toBe(401);

    // Verify failed toggle was audited
    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_id=$1 AND action='CO_DESIGNER_TOGGLE' AND details LIKE '%FAILED%'",
      [mbrId]
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('toggle to co_design mode with correct password succeeds', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mode: 'co_design', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('co_design');
  });

  test('toggle back to off succeeds without password', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mode: 'off' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('off');
  });

  test('invalid mode value returns 400', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mode: 'turbo' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid mode/);
  });
});

// ════════════════════════════════════════════════════════════════
// Co-Designer RBAC — only authorized roles can toggle
// ════════════════════════════════════════════════════════════════

describe('Co-Designer RBAC (GAMP5 Cat.5)', () => {
  test('operator CANNOT toggle co-designer (lacks co_designer:toggle)', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ mode: 'assist' });

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/Insufficient permissions/);
  });

  test('viewer CANNOT toggle co-designer', async () => {
    const res = await request(app)
      .post(`/api/co-designer/${mbrId}/toggle`)
      .set('Authorization', `Bearer ${getToken('viewer')}`)
      .send({ mode: 'assist' });

    expect(res.status).toBe(403);
  });
});

// ════════════════════════════════════════════════════════════════
// Proposal review workflow — human-in-the-loop enforcement
// ════════════════════════════════════════════════════════════════

describe('Proposal review workflow (GAMP5 human-in-the-loop)', () => {
  let sessionId, proposalId;

  beforeAll(async () => {
    // Create a co-designer session and a fake proposal for testing
    const sessR = await query(
      "INSERT INTO co_designer_sessions (mbr_id, user_id, mode, status) VALUES ($1,$2,'co_design','awaiting_review') RETURNING id",
      [mbrId, TEST_USERS.designer.id]
    );
    sessionId = sessR.rows[0].id;

    const propR = await query(
      `INSERT INTO co_designer_proposals (session_id, mbr_id, proposal_type, proposed_data, confidence, reasoning, status)
       VALUES ($1,$2,'phase',$3,0.85,'AI extracted: Test Dispensing phase','pending') RETURNING id`,
      [sessionId, mbrId, JSON.stringify({ phase_name: 'AI Dispensing', description: 'Auto-extracted', sequence: 1 })]
    );
    proposalId = propR.rows[0].id;
  });

  test('list proposals returns pending proposals', async () => {
    const res = await request(app)
      .get(`/api/co-designer/${mbrId}/proposals`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);

    const pending = res.body.data.find(p => p.id === proposalId);
    expect(pending).toBeDefined();
    expect(pending.status).toBe('pending');
    expect(pending.proposal_type).toBe('phase');
    expect(pending.confidence).toBeDefined();
  });

  test('list proposals with status filter works', async () => {
    const res = await request(app)
      .get(`/api/co-designer/${mbrId}/proposals?status=pending`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    for (const p of res.body.data) {
      expect(p.status).toBe('pending');
    }
  });

  test('reject proposal with review notes', async () => {
    // Create another proposal to reject (keep the first one for accept test)
    const propR = await query(
      `INSERT INTO co_designer_proposals (session_id, mbr_id, proposal_type, proposed_data, confidence, reasoning, status)
       VALUES ($1,$2,'step',$3,0.60,'Low confidence step','pending') RETURNING id`,
      [sessionId, mbrId, JSON.stringify({ step_name: 'Bad Step', phase_name: 'AI Dispensing' })]
    );
    const rejectId = propR.rows[0].id;

    const res = await request(app)
      .put(`/api/co-designer/${mbrId}/proposals/${rejectId}/review`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ action: 'rejected', review_notes: 'Confidence too low, step not in source document' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('rejected');
    expect(res.body.review_notes).toBe('Confidence too low, step not in source document');
    expect(res.body.reviewed_by).toBe(TEST_USERS.designer.id);
  });

  test('accept proposal creates actual MBR phase', async () => {
    const res = await request(app)
      .put(`/api/co-designer/${mbrId}/proposals/${proposalId}/review`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ action: 'accepted', review_notes: 'Matches source document' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('accepted');

    // Verify the phase was actually created in the MBR
    const phases = await query(
      "SELECT * FROM mbr_phases WHERE mbr_id=$1 AND phase_name='AI Dispensing'",
      [mbrId]
    );
    expect(phases.rows.length).toBe(1);
  });

  test('invalid review action returns 400', async () => {
    const propR = await query(
      `INSERT INTO co_designer_proposals (session_id, mbr_id, proposal_type, proposed_data, confidence, reasoning, status)
       VALUES ($1,$2,'phase',$3,0.70,'Test','pending') RETURNING id`,
      [sessionId, mbrId, JSON.stringify({ phase_name: 'X' })]
    );

    const res = await request(app)
      .put(`/api/co-designer/${mbrId}/proposals/${propR.rows[0].id}/review`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ action: 'invalid_action' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/accepted, modified, or rejected/);
  });
});

// ════════════════════════════════════════════════════════════════
// Metrics endpoint
// ════════════════════════════════════════════════════════════════

describe('Co-Designer metrics', () => {
  test('metrics endpoint returns proposal counts', async () => {
    const res = await request(app)
      .get(`/api/co-designer/${mbrId}/metrics`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    expect(parseInt(res.body.total)).toBeGreaterThanOrEqual(1);
    expect(res.body.accepted).toBeDefined();
    expect(res.body.rejected).toBeDefined();
    expect(res.body.pending).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// Co-Designer session schema validation
// ════════════════════════════════════════════════════════════════

describe('Co-Designer schema integrity (GAMP5 Cat.5)', () => {
  test('co_designer_proposals table has ai-traceability columns', async () => {
    const cols = await query(
      "SELECT column_name FROM information_schema.columns WHERE table_name='co_designer_proposals' ORDER BY ordinal_position"
    );
    const colNames = cols.rows.map(r => r.column_name);

    expect(colNames).toContain('proposal_type');
    expect(colNames).toContain('proposed_data');
    expect(colNames).toContain('confidence');
    expect(colNames).toContain('reasoning');
    expect(colNames).toContain('status');
    expect(colNames).toContain('reviewed_by');
    expect(colNames).toContain('review_notes');
    expect(colNames).toContain('reviewed_at');
  });

  test('proposal status CHECK constraint allows only valid values', async () => {
    try {
      await query(
        `INSERT INTO co_designer_proposals (session_id, mbr_id, proposal_type, proposed_data, status)
         VALUES ($1,$2,'test','{}','invalid_status')`,
        [
          (await query('SELECT id FROM co_designer_sessions LIMIT 1')).rows[0]?.id || '00000000-0000-0000-0000-000000000000',
          mbrId,
        ]
      );
      // Should not reach here
      expect(true).toBe(false);
    } catch (err) {
      expect(err.message).toMatch(/violates check constraint/);
    }
  });
});
