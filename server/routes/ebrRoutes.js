// server/routes/ebrRoutes.js — Electronic Batch Record Execution API
// Shop floor operations for pharmaceutical manufacturing

const { Router } = require('express');
const { query } = require('../db/pool');
const { authenticate, authorize, verifyPasswordForSignature } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const {
  createEBR, startStep, completeStep, verifyStep,
  recordParameterValue, createDeviation, resolveDeviation,
  recordMaterialConsumption, verifyMaterial,
  logEquipmentUsage, recordIPCResult,
  recordYield, calculateFinalYield,
  completeBatch, releaseBatch,
  getEBR, listEBRs,
} = require('../services/ebrService');

// ── Agentic AI — fire-and-forget async agents ────────────────────────────────
const { runRCAAgent }        = require('../services/agents/deviationRCAAgent');
const { runAnomalySentinel } = require('../services/agents/anomalySentinel');
const { runReleaseAdvisor }  = require('../services/agents/batchReleaseAdvisor');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ═══ LIST & GET ═══

router.get('/', async (req, res) => {
  try {
    const ebrs = await listEBRs(req.query);
    res.json({ data: ebrs });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/:id', async (req, res) => {
  try {
    const ebr = await getEBR(req.params.id);
    if (!ebr) return res.status(404).json({ error: 'EBR not found' });
    res.json(ebr);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ CREATE EBR ═══

router.post('/', authorize('mbr:read'), async (req, res) => {
  try {
    const { mbr_id, batch_number } = req.body;
    if (!mbr_id || !batch_number) return res.status(400).json({ error: 'mbr_id and batch_number required' });

    const result = await createEBR(mbr_id, batch_number, req.session.userId);
    if (result.error) return res.status(400).json(result);

    await req.audit({ action: 'CREATE', resourceType: 'EBR', resourceId: result.id, details: `EBR created: ${result.ebr_code} batch ${batch_number}` });
    res.status(201).json(result);
  } catch (err) { console.error('[EBR] Create:', err); res.status(500).json({ error: 'Failed to create EBR' }); }
});

// ═══ STEP EXECUTION ═══

router.post('/steps/:stepExecId/start', async (req, res) => {
  try {
    const result = await startStep(req.params.stepExecId, req.session.userId);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'EBR_STEP', resourceId: req.params.stepExecId, details: `Step started: ${result.step_name}` });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/steps/:stepExecId/complete', async (req, res) => {
  try {
    const result = await completeStep(req.params.stepExecId, req.session.userId, req.body.notes, req.body.actual_duration_min);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'EBR_STEP', resourceId: req.params.stepExecId, details: `Step completed: ${result.step_name}` });

    // ── Fire Anomaly Sentinel asynchronously ──────────────────────────────────
    runAnomalySentinel(
      result.ebr_id,
      result.id,
      result.step_name
    ).catch(err => console.error('[SENTINEL] Background error:', err.message));

    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/steps/:stepExecId/verify', async (req, res) => {
  try {
    const result = await verifyStep(req.params.stepExecId, req.session.userId);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'APPROVE', resourceType: 'EBR_STEP', resourceId: req.params.stepExecId, details: 'Step verified' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ PARAMETER VALUES ═══

router.get('/:ebrId/parameters', async (req, res) => {
  try {
    const r = await query('SELECT * FROM ebr_parameter_values WHERE ebr_id=$1 ORDER BY created_at', [req.params.ebrId]);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/parameters/:paramId/record', async (req, res) => {
  try {
    const { actual_value } = req.body;
    if (actual_value === undefined || actual_value === null) return res.status(400).json({ error: 'actual_value required' });

    const result = await recordParameterValue(req.params.paramId, actual_value, req.session.userId);
    if (result.error) return res.status(400).json(result);

    const logDetail = result.in_spec
      ? `Parameter ${result.parameter.param_name}: ${actual_value} (IN SPEC)`
      : `Parameter ${result.parameter.param_name}: ${actual_value} (OUT OF SPEC — deviation auto-created)`;
    await req.audit({ action: 'UPDATE', resourceType: 'EBR_PARAMETER', resourceId: req.params.paramId, details: logDetail });

    // ── Fire RCA Agent asynchronously on OOS ─────────────────────────────────
    if (!result.in_spec && result.deviation) {
      const p = result.parameter;
      runRCAAgent(
        p.ebr_id,
        result.deviation.id,
        p.param_name,
        actual_value,
        { lower: p.lower_limit, upper: p.upper_limit, unit: p.unit },
        null // equipmentId — can be enriched from step context
      ).catch(err => console.error('[RCA-AGENT] Background error:', err.message));
    }

    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ DEVIATIONS ═══

router.get('/:ebrId/deviations', async (req, res) => {
  try {
    const r = await query('SELECT * FROM ebr_deviations WHERE ebr_id=$1 ORDER BY created_at DESC', [req.params.ebrId]);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:ebrId/deviations', async (req, res) => {
  try {
    const { step_execution_id, deviation_type, severity, description, expected_value, actual_value, immediate_action } = req.body;
    if (!description) return res.status(400).json({ error: 'description required' });

    const result = await createDeviation({
      ebrId: req.params.ebrId, stepExecId: step_execution_id, deviationType: deviation_type,
      severity, description, expectedValue: expected_value, actualValue: actual_value,
      immediateAction: immediate_action, reportedBy: req.session.userId,
    });
    await req.audit({ action: 'CREATE', resourceType: 'EBR_DEVIATION', resourceId: result.id, details: `Deviation: ${description.substring(0, 100)}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/deviations/:devId/resolve', async (req, res) => {
  try {
    const { root_cause, corrective_action } = req.body;
    if (!root_cause || !corrective_action) return res.status(400).json({ error: 'root_cause and corrective_action required' });

    const result = await resolveDeviation(req.params.devId, root_cause, corrective_action, req.session.userId);
    if (!result) return res.status(404).json({ error: 'Deviation not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'EBR_DEVIATION', resourceId: req.params.devId, details: 'Deviation resolved' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ MATERIAL CONSUMPTION ═══

router.post('/:ebrId/materials', async (req, res) => {
  try {
    const result = await recordMaterialConsumption({ ebrId: req.params.ebrId, ...req.body, dispensedBy: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'EBR_MATERIAL', resourceId: result.id, details: `Material: ${req.body.material_name} lot ${req.body.lot_number}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/materials/:matId/verify', async (req, res) => {
  try {
    const result = await verifyMaterial(req.params.matId, req.session.userId);
    if (!result) return res.status(404).json({ error: 'Not found' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ EQUIPMENT USAGE ═══

router.post('/:ebrId/equipment', async (req, res) => {
  try {
    const result = await logEquipmentUsage({ ebrId: req.params.ebrId, ...req.body, loggedBy: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'EBR_EQUIPMENT', resourceId: result.id, details: `Equipment: ${req.body.equipment_name}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ IPC RESULTS ═══

router.post('/:ebrId/ipc', async (req, res) => {
  try {
    const result = await recordIPCResult({ ebrId: req.params.ebrId, ...req.body, testedBy: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'EBR_IPC', resourceId: result.id, details: `IPC: ${req.body.check_name} — ${req.body.pass_fail}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ YIELD ═══

router.post('/:ebrId/yield', async (req, res) => {
  try {
    const result = await recordYield({ ebrId: req.params.ebrId, ...req.body, recordedBy: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'EBR_YIELD', resourceId: result.id, details: `Yield: ${result.yield_pct}% (${req.body.phase_name})` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ BATCH COMPLETE & RELEASE ═══

router.post('/:ebrId/complete', async (req, res) => {
  try {
    const result = await completeBatch(req.params.ebrId);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'EBR', resourceId: req.params.ebrId, details: `Batch completed: ${result.batch_number}` });

    // ── Fire Release Advisor asynchronously ───────────────────────────────────
    runReleaseAdvisor(req.params.ebrId)
      .catch(err => console.error('[RELEASE-ADVISOR] Background error:', err.message));

    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:ebrId/release', authorize('mbr:approve'), async (req, res) => {
  try {
    const { decision, notes, password } = req.body;
    if (!decision) return res.status(400).json({ error: 'decision required (Released or Rejected)' });

    const result = await releaseBatch(req.params.ebrId, decision, notes, req.session.userId, password, verifyPasswordForSignature);
    if (result.error) return res.status(400).json(result);

    await req.audit({ action: 'APPROVE', resourceType: 'EBR', resourceId: req.params.ebrId, details: `Batch ${decision}: ${result.batch_number}` });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
