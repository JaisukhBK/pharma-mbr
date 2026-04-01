// server/__tests__/ebr-execution.test.js
// EBR Execution Module — shop floor batch execution tests

const request = require('supertest');
const { createTestApp } = require('./helpers/testApp');
const { query } = require('../db/pool');
const {
  TEST_PASSWORD, TEST_USERS,
  setupTestDB, teardownTestDB, closePool,
  getToken, createTestMBR,
} = require('./helpers/setup');

const app = createTestApp();
let mbrId, ebrId, stepExecId, paramValueId;

beforeAll(async () => {
  await setupTestDB();
  // Create MBR and sign to Effective (required for EBR creation)
  const mbr = await createTestMBR();
  mbrId = mbr.id;
  // Add a phase + step + parameter for execution testing
  const phase = await query("INSERT INTO mbr_phases (mbr_id, phase_name, phase_number) VALUES ($1,'Test Dispensing',1) RETURNING id", [mbrId]);
  const step = await query(
    "INSERT INTO mbr_steps (mbr_id, phase_id, step_name, step_number, step_type, instruction, is_critical, is_gmp_critical, duration_min) VALUES ($1,$2,'Weigh API',1,'Process','Weigh active ingredient',true,true,15) RETURNING id",
    [mbrId, phase.rows[0].id]
  );
  await query(
    "INSERT INTO mbr_step_parameters (mbr_id, step_id, param_name, param_type, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa) VALUES ($1,$2,'Temperature','numeric','25','°C',20,30,true,false)",
    [mbrId, step.rows[0].id]
  );
  await query(
    "INSERT INTO mbr_step_parameters (mbr_id, step_id, param_name, param_type, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa) VALUES ($1,$2,'Weight','numeric','500','g',495,505,true,true)",
    [mbrId, step.rows[0].id]
  );
  // Sign MBR to Effective
  for (const [role, sigRole] of [['designer','Author'],['qa_reviewer','Reviewer'],['admin','Approver'],['qa_reviewer','QA_Approver']]) {
    await request(app).post(`/api/mbr/${mbrId}/sign`).set('Authorization', `Bearer ${getToken(role)}`).send({ signature_role: sigRole, signature_meaning: sigRole, password: TEST_PASSWORD });
  }
  // Verify Effective
  const mbrCheck = await query('SELECT status FROM mbrs WHERE id=$1', [mbrId]);
  if (mbrCheck.rows[0].status !== 'Effective') throw new Error('MBR not Effective: ' + mbrCheck.rows[0].status);
});

afterAll(async () => {
  const testIds = Object.values(TEST_USERS).map(u => `'${u.id}'`).join(',');
  // EBR cleanup
  if (ebrId) {
    await query(`DELETE FROM ebr_release_signatures WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebr_yield_records WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebr_ipc_results WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebr_equipment_usage WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebr_deviations WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebr_material_consumptions WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebr_parameter_values WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebr_step_executions WHERE ebr_id='${ebrId}'`);
    await query(`DELETE FROM ebrs WHERE id='${ebrId}'`);
  }
  await teardownTestDB();
  await closePool();
});

// ════════════════════════════════════════════════════════════════
// EBR CREATION
// ════════════════════════════════════════════════════════════════

describe('EBR creation from Effective MBR', () => {
  test('create EBR from Effective MBR', async () => {
    const res = await request(app)
      .post('/api/ebr')
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ mbr_id: mbrId, batch_number: 'BATCH-TEST-001' });

    expect(res.status).toBe(201);
    expect(res.body.ebr_code).toMatch(/^EBR-/);
    expect(res.body.batch_number).toBe('BATCH-TEST-001');
    expect(res.body.status).toBe('Ready');
    expect(res.body.mbr_version).toBe(1);
    ebrId = res.body.id;
  });

  test('cannot create EBR from non-Effective MBR', async () => {
    const draft = await createTestMBR();
    const res = await request(app)
      .post('/api/ebr')
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ mbr_id: draft.id, batch_number: 'BATCH-FAIL' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Effective/);
  });

  test('duplicate batch number returns 400', async () => {
    const res = await request(app)
      .post('/api/ebr')
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ mbr_id: mbrId, batch_number: 'BATCH-TEST-001' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/);
  });

  test('EBR has pre-populated steps and parameters', async () => {
    const res = await request(app)
      .get(`/api/ebr/${ebrId}`)
      .set('Authorization', `Bearer ${getToken('operator')}`);

    expect(res.status).toBe(200);
    expect(res.body.steps.length).toBeGreaterThanOrEqual(1);
    expect(res.body.steps[0].step_name).toBe('Weigh API');
    expect(res.body.steps[0].parameters.length).toBe(2);
    stepExecId = res.body.steps[0].id;
    paramValueId = res.body.steps[0].parameters[0].id;
  });
});

// ════════════════════════════════════════════════════════════════
// STEP EXECUTION
// ════════════════════════════════════════════════════════════════

describe('Step-by-step execution', () => {
  test('start step moves to In Progress', async () => {
    const res = await request(app)
      .post(`/api/ebr/steps/${stepExecId}/start`)
      .set('Authorization', `Bearer ${getToken('operator')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('In Progress');
    expect(res.body.started_at).toBeDefined();
  });

  test('cannot complete step with unrecorded parameters', async () => {
    const res = await request(app)
      .post(`/api/ebr/steps/${stepExecId}/complete`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ notes: 'Attempting early completion' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/parameter.*not yet recorded/);
  });
});

// ════════════════════════════════════════════════════════════════
// PARAMETER VERIFICATION
// ════════════════════════════════════════════════════════════════

describe('Parameter verification (auto-check limits)', () => {
  test('in-spec value records successfully', async () => {
    const res = await request(app)
      .post(`/api/ebr/parameters/${paramValueId}/record`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ actual_value: '25.2' });

    expect(res.status).toBe(200);
    expect(res.body.in_spec).toBe(true);
    expect(res.body.deviation).toBeNull();
    expect(res.body.parameter.actual_value).toBe('25.2');
  });

  test('out-of-spec value auto-creates deviation', async () => {
    // Get the second parameter (Weight with limits 495-505)
    const params = await request(app).get(`/api/ebr/${ebrId}/parameters`).set('Authorization', `Bearer ${getToken('operator')}`);
    const weightParam = params.body.data.find(p => p.param_name === 'Weight');

    const res = await request(app)
      .post(`/api/ebr/parameters/${weightParam.id}/record`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ actual_value: '510' });

    expect(res.status).toBe(200);
    expect(res.body.in_spec).toBe(false);
    expect(res.body.deviation).toBeDefined();
    expect(res.body.deviation.deviation_type).toBe('Out of Spec');
    expect(res.body.deviation.severity).toBe('Major'); // CPP+CQA = Major
  });
});

// ════════════════════════════════════════════════════════════════
// DEVIATION HANDLING
// ════════════════════════════════════════════════════════════════

describe('Deviation capture and resolution', () => {
  test('list deviations for EBR', async () => {
    const res = await request(app)
      .get(`/api/ebr/${ebrId}/deviations`)
      .set('Authorization', `Bearer ${getToken('operator')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('resolve deviation with root cause and corrective action', async () => {
    const devs = await request(app).get(`/api/ebr/${ebrId}/deviations`).set('Authorization', `Bearer ${getToken('operator')}`);
    const devId = devs.body.data[0].id;

    const res = await request(app)
      .put(`/api/ebr/deviations/${devId}/resolve`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ root_cause: 'Scale calibration drift', corrective_action: 'Recalibrated scale, re-weighed material to 501g' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Resolved');
    expect(res.body.root_cause).toBe('Scale calibration drift');
  });
});

// ════════════════════════════════════════════════════════════════
// MATERIAL CONSUMPTION
// ════════════════════════════════════════════════════════════════

describe('Material consumption tracking', () => {
  test('record material with lot number and weights', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/materials`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({
        step_execution_id: stepExecId, material_code: 'API-001', material_name: 'Metformin HCl',
        lot_number: 'LOT-2026-0042', quantity_required: 500, quantity_dispensed: 500.2,
        unit: 'g', tare_weight: 45.0, gross_weight: 545.2, net_weight: 500.2,
      });

    expect(res.status).toBe(201);
    expect(res.body.lot_number).toBe('LOT-2026-0042');
    expect(parseFloat(res.body.net_weight)).toBe(500.2);
  });
});

// ════════════════════════════════════════════════════════════════
// EQUIPMENT USAGE
// ════════════════════════════════════════════════════════════════

describe('Equipment usage logging', () => {
  test('log equipment with calibration status', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/equipment`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({
        step_execution_id: stepExecId, equipment_code: 'BAL-001', equipment_name: 'Analytical Balance Mettler XPE205',
        equipment_type: 'Balance', calibration_status: 'Verified', calibration_due: '2026-12-31', clean_status: 'Clean',
      });

    expect(res.status).toBe(201);
    expect(res.body.calibration_status).toBe('Verified');
  });
});

// ════════════════════════════════════════════════════════════════
// IPC CHECK RECORDING
// ════════════════════════════════════════════════════════════════

describe('IPC check recording', () => {
  test('record passing IPC check', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/ipc`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({
        step_execution_id: stepExecId, check_name: 'Blend Uniformity', check_type: 'Chemical',
        specification: 'RSD ≤ 5.0%', actual_result: '2.3%', unit: '%RSD', pass_fail: 'Pass',
      });

    expect(res.status).toBe(201);
    expect(res.body.pass_fail).toBe('Pass');
  });
});

// ════════════════════════════════════════════════════════════════
// YIELD CALCULATION
// ════════════════════════════════════════════════════════════════

describe('Yield calculation', () => {
  test('record phase yield', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/yield`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ phase_name: 'Test Dispensing', stage: 'In Process', theoretical_qty: 500, actual_qty: 498.5, unit: 'g' });

    expect(res.status).toBe(201);
    expect(parseFloat(res.body.yield_pct)).toBeCloseTo(99.7, 0);
    expect(res.body.in_range).toBe(true);
  });

  test('record final yield', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/yield`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ phase_name: 'Final', stage: 'Final', theoretical_qty: 100000, actual_qty: 97500, unit: 'tablets' });

    expect(res.status).toBe(201);
    expect(parseFloat(res.body.yield_pct)).toBe(97.5);
  });
});

// ════════════════════════════════════════════════════════════════
// STEP COMPLETION & BATCH COMPLETE
// ════════════════════════════════════════════════════════════════

describe('Batch completion', () => {
  test('complete step after all params recorded and deviations resolved', async () => {
    const res = await request(app)
      .post(`/api/ebr/steps/${stepExecId}/complete`)
      .set('Authorization', `Bearer ${getToken('operator')}`)
      .send({ notes: 'Step completed per SOP', actual_duration_min: 18 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Completed');
    expect(res.body.actual_duration_min).toBe(18);
  });

  test('complete batch (all steps done, no open deviations)', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/complete`)
      .set('Authorization', `Bearer ${getToken('operator')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Complete');
    expect(res.body.completed_at).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// BATCH RELEASE (QA)
// ════════════════════════════════════════════════════════════════

describe('Batch release workflow', () => {
  test('release requires password (§11.200)', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/release`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ decision: 'Released', notes: 'No password' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Password required/);
  });

  test('QA releases batch with password', async () => {
    const res = await request(app)
      .post(`/api/ebr/${ebrId}/release`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`)
      .send({ decision: 'Released', notes: 'Batch meets all specifications. Released for distribution.', password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Released');
    expect(res.body.released_at).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// FULL EBR RETRIEVAL WITH SUMMARY
// ════════════════════════════════════════════════════════════════

describe('EBR retrieval with full execution data', () => {
  test('get complete EBR with all nested data', async () => {
    const res = await request(app)
      .get(`/api/ebr/${ebrId}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Released');
    expect(res.body.steps.length).toBeGreaterThanOrEqual(1);
    expect(res.body.deviations.length).toBeGreaterThanOrEqual(1);
    expect(res.body.yields.length).toBe(2);
    expect(res.body.release_signatures.length).toBe(1);
    expect(res.body.summary).toBeDefined();
    expect(res.body.summary.completed_steps).toBe(res.body.summary.total_steps);
    expect(res.body.summary.open_deviations).toBe(0);
  });

  test('list EBRs with filters', async () => {
    const res = await request(app)
      .get('/api/ebr?status=Released')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data[0].completed_steps).toBeDefined();
  });
});
