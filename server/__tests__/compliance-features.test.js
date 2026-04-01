// server/__tests__/compliance-features.test.js
// GAMP5 D6 | Features 6-10: Risk, RTM, Reviews, AI Governance, SBOM

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
afterAll(async () => {
  // Clean up feature 6-10 test data
  const testIds = Object.values(TEST_USERS).map(u => `'${u.id}'`).join(',');
  await query(`DELETE FROM risk_assessments WHERE assessed_by IN (${testIds})`);
  await query(`DELETE FROM ai_performance_metrics WHERE model_id IN (SELECT id FROM ai_model_registry WHERE validated_by IN (${testIds}))`);
  await query(`DELETE FROM ai_model_registry WHERE validated_by IN (${testIds})`);
  await query(`DELETE FROM system_config_snapshots WHERE created_by IN (${testIds})`);
  await query(`DELETE FROM periodic_reviews WHERE created_by IN (${testIds})`);
  await teardownTestDB();
  await closePool();
});

// ════════════════════════════════════════════════════════════════
// FEATURE 6: RISK ASSESSMENT (FMEA)
// ════════════════════════════════════════════════════════════════

describe('Risk Assessment — FMEA (GAMP5 §6, ICH Q9)', () => {
  let riskId;

  test('create risk assessment with severity/probability/detectability', async () => {
    const res = await request(app)
      .post(`/api/compliance/risk/${mbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({
        hazard: 'Impeller speed exceeds validated range',
        hazard_category: 'Process',
        severity: 8,
        probability: 3,
        detectability: 4,
        mitigation: 'Install interlock on impeller VFD with validated setpoint limits',
      });

    expect(res.status).toBe(201);
    expect(res.body.rpn).toBe(96); // 8*3*4
    expect(res.body.risk_level).toBe('Medium');
    expect(res.body.hazard_category).toBe('Process');
    riskId = res.body.id;
  });

  test('create critical risk (RPN >= 200)', async () => {
    const res = await request(app)
      .post(`/api/compliance/risk/${mbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ hazard: 'Cross-contamination during dispensing', hazard_category: 'Quality', severity: 10, probability: 5, detectability: 5 });

    expect(res.status).toBe(201);
    expect(res.body.rpn).toBe(250);
    expect(res.body.risk_level).toBe('Critical');
  });

  test('risk validation — missing required fields returns 400', async () => {
    const res = await request(app)
      .post(`/api/compliance/risk/${mbrId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ hazard: 'Incomplete' });

    expect(res.status).toBe(400);
  });

  test('update risk with mitigation and residual RPN', async () => {
    const res = await request(app)
      .put(`/api/compliance/risk/${riskId}`)
      .set('Authorization', `Bearer ${getToken('designer')}`)
      .send({ mitigation: 'Interlock installed and qualified', residual_rpn: 24, status: 'Mitigated' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Mitigated');
    expect(res.body.residual_rpn).toBe(24);
  });

  test('review risk (QA approval)', async () => {
    const res = await request(app)
      .post(`/api/compliance/risk/${riskId}/review`)
      .set('Authorization', `Bearer ${getToken('qa_reviewer')}`);

    expect(res.status).toBe(200);
    expect(res.body.reviewed_by).toBe(TEST_USERS.qa_reviewer.id);
    expect(res.body.reviewed_at).toBeDefined();
  });

  test('get risks for MBR with summary', async () => {
    const res = await request(app)
      .get(`/api/compliance/risk/${mbrId}`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(2);
    expect(res.body.summary.total).toBe(2);
    expect(res.body.summary.by_level.Critical).toBe(1);
    expect(res.body.summary.highest_rpn).toBe(250);
  });

  test('risk summary endpoint', async () => {
    const res = await request(app)
      .get(`/api/compliance/risk/${mbrId}/summary`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.unmitigated_critical).toBe(1);
    expect(res.body.by_status.Mitigated).toBe(1);
  });
});

// ════════════════════════════════════════════════════════════════
// FEATURE 7: RTM GENERATOR
// ════════════════════════════════════════════════════════════════

describe('RTM Generator (GAMP5 D4)', () => {
  test('generate RTM returns full matrix', async () => {
    const res = await request(app)
      .get('/api/compliance/rtm')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.generated_at).toBeDefined();
    expect(res.body.total_requirements).toBeGreaterThanOrEqual(20);
    expect(res.body.coverage_pct).toBe(100);
    expect(res.body.matrix).toBeDefined();
    expect(res.body.matrix.length).toBeGreaterThanOrEqual(20);

    // Each entry has URS ID, requirement, and test suite
    const first = res.body.matrix[0];
    expect(first.urs_id).toMatch(/^URS-/);
    expect(first.test_suite).toMatch(/\.test\.js$/);
  });
});

// ════════════════════════════════════════════════════════════════
// FEATURE 8: PERIODIC REVIEW
// ════════════════════════════════════════════════════════════════

describe('Periodic Review (GAMP5 D10)', () => {
  let reviewId;

  test('list seeded reviews', async () => {
    const res = await request(app)
      .get('/api/compliance/reviews')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(6);
  });

  test('create custom review', async () => {
    const nextDue = new Date();
    nextDue.setMonth(nextDue.getMonth() + 6);

    const res = await request(app)
      .post('/api/compliance/reviews')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({
        review_type: 'System Validation',
        title: 'Test Mid-Year Validation Review',
        description: 'Test review',
        frequency_months: 6,
        next_due: nextDue.toISOString(),
      });

    expect(res.status).toBe(201);
    expect(res.body.review_type).toBe('System Validation');
    reviewId = res.body.id;
  });

  test('complete review with findings', async () => {
    const res = await request(app)
      .post(`/api/compliance/reviews/${reviewId}/complete`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ findings: 'No issues found', corrective_actions: 'None required' });

    expect(res.status).toBe(200);
    expect(res.body.findings).toBe('No issues found');
    expect(res.body.completed_at).toBeDefined();
  });

  test('dashboard returns summary stats', async () => {
    const res = await request(app)
      .get('/api/compliance/reviews/dashboard')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBeGreaterThanOrEqual(6);
    expect(res.body.reviews).toBeDefined();
  });

  test('upcoming reviews endpoint', async () => {
    const res = await request(app)
      .get('/api/compliance/reviews/upcoming?days=400')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toBeDefined();
  });
});

// ════════════════════════════════════════════════════════════════
// FEATURE 9: AI/ML GOVERNANCE
// ════════════════════════════════════════════════════════════════

describe('AI/ML Governance (GAMP5 D11)', () => {
  let modelId;

  test('register AI model', async () => {
    const res = await request(app)
      .post('/api/compliance/ai/models')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({
        model_name: 'claude-sonnet',
        model_version: '4-20250514',
        provider: 'Anthropic',
        prompt_version: 'S88 Decomposition Prompt v2.1',
        description: 'Primary Co-Designer model for ISA-88 MBR decomposition',
        risk_level: 'Medium',
      });

    expect(res.status).toBe(201);
    expect(res.body.model_name).toBe('claude-sonnet');
    expect(res.body.prompt_hash).toBeDefined();
    expect(res.body.prompt_hash.length).toBe(64);
    modelId = res.body.id;
  });

  test('duplicate model returns 409', async () => {
    const res = await request(app)
      .post('/api/compliance/ai/models')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ model_name: 'claude-sonnet', model_version: '4-20250514', provider: 'Anthropic' });

    expect(res.status).toBe(409);
  });

  test('list registered models', async () => {
    const res = await request(app)
      .get('/api/compliance/ai/models')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('record performance metrics', async () => {
    const res = await request(app)
      .post(`/api/compliance/ai/models/${modelId}/metrics`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ period_start: '2026-03-01', period_end: '2026-03-31' });

    expect(res.status).toBe(201);
    expect(res.body.period_start).toBeDefined();
    expect(res.body.acceptance_rate).toBeDefined();
  });

  test('get metrics history', async () => {
    const res = await request(app)
      .get(`/api/compliance/ai/models/${modelId}/metrics`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('drift detection with insufficient data', async () => {
    const res = await request(app)
      .get(`/api/compliance/ai/models/${modelId}/drift`)
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.drift_detected).toBe(false);
    expect(res.body.reason).toMatch(/Insufficient data/);
  });

  test('update model status to Deprecated', async () => {
    const res = await request(app)
      .put(`/api/compliance/ai/models/${modelId}/status`)
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({ status: 'Deprecated' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('Deprecated');
  });
});

// ════════════════════════════════════════════════════════════════
// FEATURE 10: SBOM & CONFIG MANAGEMENT
// ════════════════════════════════════════════════════════════════

describe('SBOM & Config Management (GAMP5 D8, FDA CSA)', () => {
  test('generate SBOM from package.json', async () => {
    const res = await request(app)
      .get('/api/compliance/sbom')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.format).toMatch(/SBOM/);
    expect(res.body.application.name).toBe('pharma-mbr-server');
    expect(res.body.dependencies.length).toBeGreaterThanOrEqual(5);
    expect(res.body.content_hash).toBeDefined();
    expect(res.body.content_hash.length).toBe(64);

    // Verify key dependencies are listed
    const depNames = res.body.dependencies.map(d => d.name);
    expect(depNames).toContain('express');
    expect(depNames).toContain('pg');
    expect(depNames).toContain('bcrypt');
  });

  test('save config snapshot', async () => {
    const res = await request(app)
      .post('/api/compliance/sbom/snapshot')
      .set('Authorization', `Bearer ${getToken('admin')}`)
      .send({
        snapshot_type: 'SBOM',
        version_tag: 'v1.0.0-test',
        git_sha: 'abc123def456',
        content: { test: true, timestamp: new Date().toISOString() },
      });

    expect(res.status).toBe(201);
    expect(res.body.snapshot_type).toBe('SBOM');
    expect(res.body.content_hash).toBeDefined();
  });

  test('list config snapshots', async () => {
    const res = await request(app)
      .get('/api/compliance/sbom/snapshots?type=SBOM')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  test('system health endpoint', async () => {
    const res = await request(app)
      .get('/api/compliance/system-health')
      .set('Authorization', `Bearer ${getToken('admin')}`);

    expect(res.status).toBe(200);
    expect(res.body.service).toBe('Pharma-MBR');
    expect(res.body.status).toBe('healthy');
    expect(res.body.compliance).toContain('21 CFR Part 11');
    expect(res.body.compliance).toContain('GAMP5 Cat.5');
    expect(res.body.uptime_seconds).toBeGreaterThanOrEqual(0);
    expect(res.body.node_version).toMatch(/^v\d+/);
  });
});
