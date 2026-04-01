// server/__tests__/mbr-crud.test.js
// GAMP5 D6 | ISA-88 procedural model | 21 CFR Part 11 §11.10(e) versioning
// Validates: MBR CRUD, phase/step/parameter hierarchy, versioning, status guards

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken,
} = require('./helpers/setup');

const app = createTestApp();
const auth = () => ({ Authorization: `Bearer ${getToken('designer')}` });

let mbrId, phaseId, stepId;

beforeAll(async () => { await setupTestDB(); });
afterAll(async () => { await teardownTestDB(); await closePool(); });

// ════════════════════════════════════════════════════════════════
// MBR CRUD — ISA-88 Procedure level
// ════════════════════════════════════════════════════════════════

describe('MBR lifecycle (ISA-88 Procedure)', () => {
  test('create MBR with required fields', async () => {
    const res = await request(app)
      .post('/api/mbr')
      .set(auth())
      .send({
        product_name: 'CRUD Test Metformin 500mg',
        product_code: 'CRUD-MET-500',
        dosage_form: 'Tablet',
        batch_size: 150000,
        batch_size_unit: 'tablets',
        description: 'Test MBR for CRUD validation',
      });

    expect(res.status).toBe(201);
    expect(res.body.id).toBeDefined();
    expect(res.body.mbr_code).toMatch(/^MBR-/);
    expect(res.body.status).toBe('Draft');
    expect(res.body.current_version).toBe(1);
    expect(res.body.product_name).toBe('CRUD Test Metformin 500mg');
    mbrId = res.body.id;
  });

  test('create MBR without product_name returns 400', async () => {
    const res = await request(app)
      .post('/api/mbr')
      .set(auth())
      .send({ dosage_form: 'Tablet' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/product_name required/);
  });

  test('get MBR returns full nested hierarchy', async () => {
    const res = await request(app)
      .get(`/api/mbr/${mbrId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(mbrId);
    expect(res.body.phases).toBeDefined();
    expect(Array.isArray(res.body.phases)).toBe(true);
    expect(res.body.bom).toBeDefined();
    expect(res.body.signatures).toBeDefined();
  });

  test('update MBR in Draft status succeeds', async () => {
    const res = await request(app)
      .put(`/api/mbr/${mbrId}`)
      .set(auth())
      .send({ description: 'Updated description' });

    expect(res.status).toBe(200);
    expect(res.body.description).toBe('Updated description');
  });

  test('list MBRs returns paginated results', async () => {
    const res = await request(app)
      .get('/api/mbr?page=1&limit=10')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('list MBRs with search filter works', async () => {
    const res = await request(app)
      .get('/api/mbr?search=CRUD Test')
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data.some(m => m.product_name.includes('CRUD Test'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// ISA-88 Unit Procedure (Phase)
// ════════════════════════════════════════════════════════════════

describe('Phase CRUD (ISA-88 Unit Procedure)', () => {
  test('create phase with name and description', async () => {
    const res = await request(app)
      .post(`/api/mbr/${mbrId}/phases`)
      .set(auth())
      .send({ phase_name: 'Dispensing', description: 'Weigh and dispense raw materials' });

    expect(res.status).toBe(201);
    expect(res.body.phase_name).toBe('Dispensing');
    expect(res.body.phase_number).toBe(1);
    expect(res.body.mbr_id).toBe(mbrId);
    phaseId = res.body.id;
  });

  test('create second phase auto-increments phase_number', async () => {
    const res = await request(app)
      .post(`/api/mbr/${mbrId}/phases`)
      .set(auth())
      .send({ phase_name: 'Granulation' });

    expect(res.status).toBe(201);
    expect(res.body.phase_number).toBe(2);
  });

  test('update phase name', async () => {
    const res = await request(app)
      .put(`/api/mbr/${mbrId}/phases/${phaseId}`)
      .set(auth())
      .send({ phase_name: 'Dispensing & Weighing' });

    expect(res.status).toBe(200);
    expect(res.body.phase_name).toBe('Dispensing & Weighing');
  });
});

// ════════════════════════════════════════════════════════════════
// ISA-88 Operation (Step)
// ════════════════════════════════════════════════════════════════

describe('Step CRUD (ISA-88 Operation)', () => {
  test('create step within phase', async () => {
    const res = await request(app)
      .post(`/api/mbr/${mbrId}/phases/${phaseId}/steps`)
      .set(auth())
      .send({
        step_name: 'Line Clearance',
        instruction: 'Verify dispensing area is clean',
        step_type: 'Verification',
        duration_min: 15,
        is_critical: false,
        is_gmp_critical: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.step_name).toBe('Line Clearance');
    expect(res.body.step_type).toBe('Verification');
    expect(res.body.phase_id).toBe(phaseId);
    stepId = res.body.id;
  });

  test('update step marks it as critical', async () => {
    const res = await request(app)
      .put(`/api/mbr/${mbrId}/steps/${stepId}`)
      .set(auth())
      .send({ is_critical: true });

    expect(res.status).toBe(200);
    expect(res.body.is_critical).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// ISA-88 Parameters (CPP/CQA)
// ════════════════════════════════════════════════════════════════

describe('Parameter CRUD (CPP/CQA)', () => {
  let paramId;

  test('create CPP parameter with limits', async () => {
    const res = await request(app)
      .post(`/api/mbr/${mbrId}/steps/${stepId}/parameters`)
      .set(auth())
      .send({
        param_name: 'Temperature',
        param_type: 'numeric',
        target_value: '25',
        unit: '°C',
        lower_limit: 20,
        upper_limit: 30,
        is_cpp: true,
        is_cqa: false,
      });

    expect(res.status).toBe(201);
    expect(res.body.param_name).toBe('Temperature');
    expect(res.body.is_cpp).toBe(true);
    expect(parseFloat(res.body.lower_limit)).toBe(20);
    expect(parseFloat(res.body.upper_limit)).toBe(30);
    paramId = res.body.id;
  });

  test('update parameter target value', async () => {
    const res = await request(app)
      .put(`/api/mbr/${mbrId}/parameters/${paramId}`)
      .set(auth())
      .send({ target_value: '22' });

    expect(res.status).toBe(200);
    expect(res.body.target_value).toBe('22');
  });

  test('delete parameter returns success', async () => {
    const res = await request(app)
      .delete(`/api/mbr/${mbrId}/parameters/${paramId}`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════
// Versioning (Part 11 §11.10(e))
// ════════════════════════════════════════════════════════════════

describe('MBR versioning (Part 11 §11.10(e))', () => {
  test('create new version requires change_reason', async () => {
    const res = await request(app)
      .post(`/api/mbr/${mbrId}/new-version`)
      .set(auth())
      .send({}); // no change_reason

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/change_reason required/);
  });

  test('create new version snapshots current state and increments version', async () => {
    const res = await request(app)
      .post(`/api/mbr/${mbrId}/new-version`)
      .set(auth())
      .send({ change_reason: 'Updated dispensing instructions per QA feedback' });

    expect(res.status).toBe(200);
    expect(res.body.new_version).toBe(2);
    expect(res.body.previous).toBe(1);

    // Verify snapshot was stored
    const versions = await query(
      'SELECT * FROM mbr_versions WHERE mbr_id=$1 ORDER BY version',
      [mbrId]
    );
    expect(versions.rows.length).toBe(1);
    expect(versions.rows[0].version).toBe(1);
    expect(versions.rows[0].change_reason).toBe('Updated dispensing instructions per QA feedback');
    expect(versions.rows[0].content_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(versions.rows[0].snapshot).toBeDefined();
  });

  test('new version resets MBR status to Draft', async () => {
    const mbr = await query('SELECT status, current_version FROM mbrs WHERE id=$1', [mbrId]);
    expect(mbr.rows[0].status).toBe('Draft');
    expect(mbr.rows[0].current_version).toBe(2);
  });
});

// ════════════════════════════════════════════════════════════════
// Status guard — prevent edits on approved MBRs
// ════════════════════════════════════════════════════════════════

describe('Status-based edit guard', () => {
  test('cannot edit MBR in Approved/Effective status', async () => {
    // Force status to Approved
    await query("UPDATE mbrs SET status='Approved' WHERE id=$1", [mbrId]);

    const res = await request(app)
      .put(`/api/mbr/${mbrId}`)
      .set(auth())
      .send({ product_name: 'Should not work' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/locked/);

    // Reset to Draft for cleanup
    await query("UPDATE mbrs SET status='Draft' WHERE id=$1", [mbrId]);
  });
});

// ════════════════════════════════════════════════════════════════
// MBR audit trail retrieval
// ════════════════════════════════════════════════════════════════

describe('MBR-specific audit trail', () => {
  test('audit endpoint returns entries for this MBR', async () => {
    const res = await request(app)
      .get(`/api/mbr/${mbrId}/audit`)
      .set(auth());

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    // Every audit record should reference this MBR
    for (const entry of res.body.data) {
      expect(entry.resource_id).toBe(mbrId);
    }
  });
});
