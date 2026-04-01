// server/__tests__/change-control.test.js
// GAMP5 D6 + D8 | Change Control Workflow
// Validates: CR lifecycle, configurable approval chains, auto MBR versioning, status guards

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken, createTestMBR,
} = require('./helpers/setup');

const app = createTestApp();

let mbrTypeId, sysTypeId, crId;

beforeAll(async () => {
  await setupTestDB();
  // Get type IDs for tests
  const types = await query('SELECT id, type_code FROM change_request_types');
  mbrTypeId = types.rows.find(t => t.type_code === 'MBR-CHANGE')?.id;
  sysTypeId = types.rows.find(t => t.type_code === 'SYS-CONFIG')?.id;
});
afterAll(async () => {
  // Clean up test CRs
  const testIds = Object.values(TEST_USERS).map(u => `'${u.id}'`).join(',');
  await query(`DELETE FROM change_approvals WHERE change_request_id IN (SELECT id FROM change_requests WHERE requested_by IN (${testIds}))`);
  await query(`DELETE FROM change_requests WHERE requested_by IN (${testIds})`);
  await teardownTestDB();
  await closePool();
});

// ════════════════════════════════════════════════════════════════
// CHANGE REQUEST TYPES
// ════════════════════════════════════════════════════════════════

describe('Change request types', () => {
  test('list types returns 4 seeded types', async () => {
    const res = await request(app)
      .get('/api/change-control/types')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(4);
    expect(res.body.data.some(t => t.type_code === 'MBR-CHANGE')).toBe(true);
    expect(res.body.data.some(t => t.type_code === 'SYS-CONFIG')).toBe(true);
    expect(res.body.data.some(t => t.type_code === 'PROC-CHANGE')).toBe(true);
    expect(res.body.data.some(t => t.type_code === 'SW-CHANGE')).toBe(true);
  });

  test('MBR-CHANGE has 2-level approval chain', async () => {
    const res = await request(app)
      .get('/api/change-control/types')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    const mbrType = res.body.data.find(t => t.type_code === 'MBR-CHANGE');
    expect(mbrType.approval_chain).toEqual(['Department Head', 'QA Approver']);
  });

  test('PROC-CHANGE has 3-level approval chain', async () => {
    const res = await request(app)
      .get('/api/change-control/types')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    const procType = res.body.data.find(t => t.type_code === 'PROC-CHANGE');
    expect(procType.approval_chain).toEqual(['Department Head', 'QA Approver', 'Regulatory']);
  });
});

// ════════════════════════════════════════════════════════════════
// CR CREATION
// ════════════════════════════════════════════════════════════════

describe('Change request creation', () => {
  test('create CR with all required fields', async () => {
    const res = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        type_id: sysTypeId,
        title: 'Add new operator role permission',
        description: 'Operators need access to view IPC check results',
        justification: 'Production floor requires real-time IPC visibility for CAPA compliance',
        risk_level: 'Low',
        priority: 'Normal',
      });

    expect(res.status).toBe(201);
    expect(res.body.cr_number).toMatch(/^CR-\d{4}-\d{4}$/);
    expect(res.body.status).toBe('Draft');
    expect(res.body.title).toBe('Add new operator role permission');
    crId = res.body.id;
  });

  test('create CR without required fields returns 400', async () => {
    const res = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ type_id: sysTypeId, title: 'Missing fields' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/);
  });

  test('MBR-CHANGE without impact assessment returns 400', async () => {
    const res = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        type_id: mbrTypeId,
        title: 'Update granulation parameters',
        description: 'Change impeller speed range',
        justification: 'Process optimization',
        // no impact_assessment — MBR-CHANGE requires it
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Impact assessment/i);
  });

  test('CR number auto-increments', async () => {
    const res = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        type_id: sysTypeId,
        title: 'Second CR for numbering test',
        description: 'Testing auto-increment',
        justification: 'Test',
      });

    expect(res.status).toBe(201);
    // Should have a higher number than the first CR
    const firstNum = parseInt(crId ? (await query('SELECT cr_number FROM change_requests WHERE id=$1', [crId])).rows[0]?.cr_number.split('-')[2] : '0');
    const secondNum = parseInt(res.body.cr_number.split('-')[2]);
    expect(secondNum).toBeGreaterThan(firstNum);
  });
});

// ════════════════════════════════════════════════════════════════
// CR UPDATE & STATUS GUARDS
// ════════════════════════════════════════════════════════════════

describe('CR update and status guards', () => {
  test('can update CR in Draft status', async () => {
    const res = await request(app)
      .put(`/api/change-control/${crId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ priority: 'High' });

    expect(res.status).toBe(200);
    expect(res.body.priority).toBe('High');
  });
});

// ════════════════════════════════════════════════════════════════
// APPROVAL WORKFLOW — SYS-CONFIG (1-level: QA Approver only)
// ════════════════════════════════════════════════════════════════

describe('Approval workflow — SYS-CONFIG (1-level chain)', () => {
  test('submit CR moves to Under Review and creates approval steps', async () => {
    const res = await request(app)
      .post(`/api/change-control/${crId}/submit`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Under Review');
    expect(res.body.approval_chain).toEqual(['QA Approver']);
    expect(res.body.current_step).toBe('QA Approver');
  });

  test('cannot edit CR after submission', async () => {
    const res = await request(app)
      .put(`/api/change-control/${crId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ title: 'Should fail' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot edit/);
  });

  test('cannot submit CR twice', async () => {
    const res = await request(app)
      .post(`/api/change-control/${crId}/submit`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot submit/);
  });

  test('approve CR completes the chain (single approver)', async () => {
    const res = await request(app)
      .post(`/api/change-control/${crId}/approve`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ action: 'Approved', comments: 'Low risk, approved for implementation' });

    expect(res.status).toBe(200);
    expect(res.body.action).toBe('Approved');
    expect(res.body.new_status).toBe('Approved');
    expect(res.body.current_step).toBe('All approved');
  });

  test('CR detail shows approval history', async () => {
    const res = await request(app)
      .get(`/api/change-control/${crId}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Approved');
    expect(res.body.approvals).toBeDefined();
    expect(res.body.approvals.length).toBe(1);
    expect(res.body.approvals[0].status).toBe('Approved');
    expect(res.body.approvals[0].comments).toBe('Low risk, approved for implementation');
  });
});

// ════════════════════════════════════════════════════════════════
// POST-APPROVAL — implement → verify → close
// ════════════════════════════════════════════════════════════════

describe('Post-approval lifecycle', () => {
  test('cannot implement before approval', async () => {
    // Create and submit a new CR but don't approve
    const cr = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ type_id: sysTypeId, title: 'Impl guard test', description: 'Test', justification: 'Test' });

    const res = await request(app)
      .post(`/api/change-control/${cr.body.id}/implement`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ notes: 'Should fail' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot implement/);
  });

  test('implement approved CR', async () => {
    const res = await request(app)
      .post(`/api/change-control/${crId}/implement`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ notes: 'Permission added to operator role config' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Implemented');
  });

  test('verify implemented CR', async () => {
    const res = await request(app)
      .post(`/api/change-control/${crId}/verify`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ notes: 'Verified operator can view IPC checks in staging' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Verified');
  });

  test('close verified CR', async () => {
    const res = await request(app)
      .post(`/api/change-control/${crId}/close`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Closed');
  });

  test('cannot close already-closed CR', async () => {
    const res = await request(app)
      .post(`/api/change-control/${crId}/close`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Cannot close/);
  });
});

// ════════════════════════════════════════════════════════════════
// MULTI-LEVEL APPROVAL — MBR-CHANGE (2 approvers)
// ════════════════════════════════════════════════════════════════

describe('Multi-level approval — MBR-CHANGE (2-level chain)', () => {
  let multiCrId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        type_id: mbrTypeId,
        title: 'Update compression parameters',
        description: 'Increase compression force range from 10-20kN to 12-25kN',
        justification: 'Tablet hardness optimization per stability data',
        impact_assessment: 'Low risk — within validated range. Requires dissolution re-testing.',
        risk_level: 'Medium',
      });
    multiCrId = res.body.id;

    await request(app)
      .post(`/api/change-control/${multiCrId}/submit`)
      .set('Authorization', `Bearer ${getToken('designer')}`);
  });

  test('first approver can approve, moves to second approver', async () => {
    const res = await request(app)
      .post(`/api/change-control/${multiCrId}/approve`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ action: 'Approved', comments: 'Department head approved' });

    expect(res.status).toBe(200);
    expect(res.body.new_status).toBe('Under Review'); // Still under review
    expect(res.body.current_step).toBe('QA Approver');
  });

  test('second approver completes the chain', async () => {
    const res = await request(app)
      .post(`/api/change-control/${multiCrId}/approve`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ action: 'Approved', comments: 'QA approved pending dissolution testing' });

    expect(res.status).toBe(200);
    expect(res.body.new_status).toBe('Approved');
  });

  test('approval history shows both steps', async () => {
    const res = await request(app)
      .get(`/api/change-control/${multiCrId}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.body.approvals.length).toBe(2);
    expect(res.body.approvals[0].approval_step).toBe('Department Head');
    expect(res.body.approvals[0].status).toBe('Approved');
    expect(res.body.approvals[1].approval_step).toBe('QA Approver');
    expect(res.body.approvals[1].status).toBe('Approved');
  });
});

// ════════════════════════════════════════════════════════════════
// REJECT & RETURN FLOWS
// ════════════════════════════════════════════════════════════════

describe('Reject and return flows', () => {
  let rejectCrId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ type_id: sysTypeId, title: 'Reject test CR', description: 'Test', justification: 'Test' });
    rejectCrId = res.body.id;
    await request(app).post(`/api/change-control/${rejectCrId}/submit`).set('Authorization', `Bearer ${getToken('designer')}`);
  });

  test('reject CR sets status to Rejected', async () => {
    const res = await request(app)
      .post(`/api/change-control/${rejectCrId}/approve`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ action: 'Rejected', comments: 'Out of scope for current release' });

    expect(res.status).toBe(200);
    expect(res.body.new_status).toBe('Rejected');
  });

  test('return CR resets to Draft for revision', async () => {
    // Create and submit another CR
    const cr = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ type_id: sysTypeId, title: 'Return test CR', description: 'Test', justification: 'Test' });
    const returnId = cr.body.id;
    await request(app).post(`/api/change-control/${returnId}/submit`).set('Authorization', `Bearer ${getToken('designer')}`);

    const res = await request(app)
      .post(`/api/change-control/${returnId}/approve`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ action: 'Returned', comments: 'Needs more detail in justification' });

    expect(res.status).toBe(200);
    expect(res.body.new_status).toBe('Draft');

    // Verify it can be re-edited
    const editRes = await request(app)
      .put(`/api/change-control/${returnId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ justification: 'Updated justification with more detail' });
    expect(editRes.status).toBe(200);
  });
});

// ════════════════════════════════════════════════════════════════
// AUTO MBR VERSIONING — approved CR triggers new MBR version
// ════════════════════════════════════════════════════════════════

describe('Auto MBR versioning on CR approval', () => {
  let mbrId, mbrCrId;

  beforeAll(async () => {
    const mbr = await createTestMBR();
    mbrId = mbr.id;
  });

  test('create MBR-linked CR with impact assessment', async () => {
    const res = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        type_id: mbrTypeId,
        title: 'Modify blending time',
        description: 'Increase blending time from 15 to 20 minutes',
        justification: 'Content uniformity improvement',
        impact_assessment: 'Low risk. Within validated range. No revalidation needed.',
        mbr_id: mbrId,
      });

    expect(res.status).toBe(201);
    expect(res.body.mbr_id).toBe(mbrId);
    mbrCrId = res.body.id;
  });

  test('approve MBR-linked CR auto-creates new MBR version', async () => {
    // Submit
    await request(app).post(`/api/change-control/${mbrCrId}/submit`).set('Authorization', `Bearer ${getToken('designer')}`);

    // First approver (Department Head)
    await request(app).post(`/api/change-control/${mbrCrId}/approve`).set('Authorization', `Bearer ${getToken('admin')}`).send({ action: 'Approved', comments: 'Approved' });

    // Second approver (QA) — triggers auto version
    const res = await request(app)
      .post(`/api/change-control/${mbrCrId}/approve`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ action: 'Approved', comments: 'Approved — new version auto-created' });

    expect(res.status).toBe(200);
    expect(res.body.new_status).toBe('Approved');
    expect(res.body.mbr_version_created).toBeDefined();
    expect(res.body.mbr_version_created.new_version).toBe(2);
    expect(res.body.mbr_version_created.previous_version).toBe(1);

    // Verify MBR is now Draft v2
    const mbr = await query('SELECT status, current_version FROM mbrs WHERE id=$1', [mbrId]);
    expect(mbr.rows[0].status).toBe('Draft');
    expect(mbr.rows[0].current_version).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// CANCEL FLOW
// ════════════════════════════════════════════════════════════════

describe('Cancel flow', () => {
  test('cancel a Draft CR', async () => {
    const cr = await request(app)
      .post('/api/change-control')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ type_id: sysTypeId, title: 'Cancel test', description: 'Test', justification: 'Test' });

    const res = await request(app)
      .post(`/api/change-control/${cr.body.id}/cancel`)
      .set('Authorization', `Bearer ${getToken('designer')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Cancelled');
  });
});

// ════════════════════════════════════════════════════════════════
// AUDIT TRAIL
// ════════════════════════════════════════════════════════════════

describe('Change control audit trail', () => {
  test('CR creation is audited', async () => {
    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_type='CHANGE_REQUEST' AND action='CREATE' LIMIT 1"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });

  test('CR approval is audited', async () => {
    const audit = await query(
      "SELECT * FROM audit_trail WHERE resource_type='CHANGE_REQUEST' AND action='APPROVE' LIMIT 1"
    );
    expect(audit.rows.length).toBeGreaterThanOrEqual(1);
  });
});
