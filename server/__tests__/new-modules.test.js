// server/__tests__/new-modules.test.js
// DevCAPA, Equipment, Genealogy, KPI modules

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const { TEST_PASSWORD, TEST_USERS, setupTestDB, teardownTestDB, closePool, getToken } = require('./helpers/setup');

const app = createTestApp();
let devId, capaId, equipId, lotId;

beforeAll(async () => { await setupTestDB(); });
afterAll(async () => {
  const testIds = Object.values(TEST_USERS).map(u => `'${u.id}'`).join(',');
  await query(`DELETE FROM batch_genealogy WHERE batch_number LIKE 'TEST-%'`).catch(() => {});
  await query(`DELETE FROM material_lots WHERE lot_number LIKE 'TEST-%'`).catch(() => {});
  await query(`DELETE FROM equipment_calibrations WHERE equipment_id IN (SELECT id FROM equipment WHERE equipment_code LIKE 'TEST-%')`).catch(() => {});
  await query(`DELETE FROM equipment WHERE equipment_code LIKE 'TEST-%'`).catch(() => {});
  await query(`DELETE FROM capas WHERE created_by IN (${testIds})`).catch(() => {});
  await query(`DELETE FROM deviations WHERE reported_by IN (${testIds})`).catch(() => {});
  await teardownTestDB();
  await closePool();
});

// ════════════════════════════════════════════════════════════════
// DEVCAPA
// ════════════════════════════════════════════════════════════════

describe('Deviation Management', () => {
  test('create deviation', async () => {
    const res = await request(app).post('/api/devcapa/deviations')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ title: 'Temperature excursion in Room 204', deviation_type: 'Process', severity: 'Major', batch_number: 'B-2026-0099', area: 'Granulation' });
    expect(res.status).toBe(201);
    expect(res.body.deviation_number).toMatch(/^DEV-/);
    expect(res.body.severity).toBe('Major');
    devId = res.body.id;
  });

  test('list deviations', async () => {
    const res = await request(app).get('/api/devcapa/deviations')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('get deviation detail', async () => {
    const res = await request(app).get(`/api/devcapa/deviations/${devId}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.capas).toBeDefined();
  });

  test('update deviation with root cause', async () => {
    const res = await request(app).put(`/api/devcapa/deviations/${devId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ root_cause: 'HVAC failure', status: 'Investigating' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Investigating');
  });
});

describe('CAPA Management', () => {
  test('create CAPA linked to deviation', async () => {
    const res = await request(app).post('/api/devcapa/capas')
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ deviation_id: devId, title: 'HVAC qualification and monitoring upgrade', capa_type: 'Corrective', priority: 'High', action_plan: 'Install redundant HVAC sensors with alarming' });
    expect(res.status).toBe(201);
    expect(res.body.capa_number).toMatch(/^CAPA-/);
    capaId = res.body.id;
  });

  test('list CAPAs', async () => {
    const res = await request(app).get('/api/devcapa/capas')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('verify CAPA effectiveness', async () => {
    await request(app).put(`/api/devcapa/capas/${capaId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ status: 'Pending Verification' });
    const res = await request(app).post(`/api/devcapa/capas/${capaId}/verify`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Effective');
    expect(res.body.verified_by).toBe(TEST_USERS.qa_reviewer.id);
  });

  test('DevCAPA stats', async () => {
    const res = await request(app).get('/api/devcapa/stats/overview')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.deviations.total).toBeGreaterThanOrEqual(1);
    expect(res.body.capas.total).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════
// EQUIPMENT
// ════════════════════════════════════════════════════════════════

describe('Equipment Management', () => {
  test('create equipment', async () => {
    const res = await request(app).post('/api/equipment')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ equipment_code: 'TEST-BAL-001', equipment_name: 'Test Balance XPE205', equipment_type: 'Balance', manufacturer: 'Mettler Toledo', gmp_critical: true, location: 'Room 201' });
    expect(res.status).toBe(201);
    expect(res.body.equipment_code).toBe('TEST-BAL-001');
    expect(res.body.gmp_critical).toBe(true);
    equipId = res.body.id;
  });

  test('duplicate code returns 409', async () => {
    const res = await request(app).post('/api/equipment')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ equipment_code: 'TEST-BAL-001', equipment_name: 'Duplicate' });
    expect(res.status).toBe(409);
  });

  test('list equipment', async () => {
    const res = await request(app).get('/api/equipment')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('record calibration', async () => {
    const res = await request(app).post(`/api/equipment/${equipId}/calibration`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ calibration_date: '2026-03-31', next_due: '2027-03-31', performed_by: 'Cal Lab Inc', certificate_ref: 'CAL-2026-1234', result: 'Pass' });
    expect(res.status).toBe(201);
    expect(res.body.result).toBe('Pass');
  });

  test('get equipment with calibrations', async () => {
    const res = await request(app).get(`/api/equipment/${equipId}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.calibrations.length).toBe(1);
    expect(res.body.qualification_status).toBe('Qualified');
  });

  test('equipment stats', async () => {
    const res = await request(app).get('/api/equipment/stats/overview')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════
// GENEALOGY
// ════════════════════════════════════════════════════════════════

describe('Batch Genealogy', () => {
  test('create material lot', async () => {
    const res = await request(app).post('/api/genealogy/materials')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ material_code: 'API-001', material_name: 'Test Metformin HCl', lot_number: 'TEST-LOT-001', supplier: 'Test Supplier', received_date: '2026-03-01', expiry_date: '2028-03-01', quantity_received: 5000, unit: 'kg' });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('Quarantine');
    lotId = res.body.id;
  });

  test('release material lot', async () => {
    const res = await request(app).post(`/api/genealogy/materials/${lotId}/release`)
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Released');
  });

  test('link material to batch', async () => {
    const res = await request(app).post('/api/genealogy/link')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ batch_number: 'TEST-BATCH-GEN', material_lot_id: lotId, lot_number: 'TEST-LOT-001', material_name: 'Test Metformin HCl', quantity_used: 500, unit: 'kg', link_type: 'Input' });
    expect(res.status).toBe(201);
  });

  test('trace forward (lot → batches)', async () => {
    const res = await request(app).get('/api/genealogy/trace/forward/TEST-LOT-001')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.lot_number).toBe('TEST-LOT-001');
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  test('trace backward (batch → lots)', async () => {
    const res = await request(app).get('/api/genealogy/trace/backward/TEST-BATCH-GEN')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.batch_number).toBe('TEST-BATCH-GEN');
    expect(res.body.count).toBeGreaterThanOrEqual(1);
  });

  test('list materials', async () => {
    const res = await request(app).get('/api/genealogy/materials')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('genealogy stats', async () => {
    const res = await request(app).get('/api/genealogy/stats/overview')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.genealogy_links).toBeGreaterThanOrEqual(1);
  });
});

// ════════════════════════════════════════════════════════════════
// KPIs
// ════════════════════════════════════════════════════════════════

describe('Dashboard KPIs', () => {
  test('get KPIs', async () => {
    const res = await request(app).get('/api/kpis')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.batches).toBeDefined();
    expect(res.body.mbrs).toBeDefined();
    expect(res.body.deviations).toBeDefined();
    expect(res.body.oee).toBeDefined();
  });

  test('get batch summary', async () => {
    const res = await request(app).get('/api/batches')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  test('get products', async () => {
    const res = await request(app).get('/api/products')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });

  test('get quality trend', async () => {
    const res = await request(app).get('/api/quality/trend')
      .set('Authorization', `Bearer ${getToken('admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});
