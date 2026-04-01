// server/routes/complianceRoutes.js — Features 6-10 Compliance API
// Risk Assessment (GAMP5 §6) | RTM (D4) | Periodic Review (D10) | AI Governance (D11) | SBOM (D8)

const { Router } = require('express');
const { query } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const { createRisk, updateRisk, reviewRisk, getRisksForMBR, getRiskSummary } = require('../services/riskAssessmentService');
const { generateRTM } = require('../services/rtmService');
const { getReviews, createReview, completeReview, getOverdueReviews, getUpcomingReviews, getDashboard } = require('../services/periodicReviewService');
const { registerModel, getModels, updateModelStatus, recordMetrics, getMetricsHistory, detectDrift } = require('../services/aiGovernanceService');
const { generateSBOM, saveSnapshot, getSnapshots, getSystemHealth } = require('../services/sbomService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ═══════════════════════════════════════════════════════════════
// FEATURE 6: RISK ASSESSMENT (FMEA)
// ═══════════════════════════════════════════════════════════════

router.get('/risk/:mbrId', async (req, res) => {
  try {
    const risks = await getRisksForMBR(req.params.mbrId);
    const summary = await getRiskSummary(req.params.mbrId);
    res.json({ data: risks, summary });
  } catch (err) { res.status(500).json({ error: 'Failed to get risks' }); }
});

router.post('/risk/:mbrId', authorize('mbr:write'), async (req, res) => {
  try {
    const { step_id, parameter_id, hazard, hazard_category, severity, probability, detectability, mitigation } = req.body;
    if (!hazard || !severity || !probability || !detectability) {
      return res.status(400).json({ error: 'hazard, severity, probability, and detectability are required' });
    }
    const result = await createRisk({
      mbrId: req.params.mbrId, stepId: step_id, parameterId: parameter_id,
      hazard, hazardCategory: hazard_category, severity, probability, detectability,
      mitigation, assessedBy: req.session.userId,
    });
    await req.audit({ action: 'CREATE', resourceType: 'RISK_ASSESSMENT', resourceId: result.id, details: `Risk: ${hazard} (RPN: ${result.rpn})` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to create risk' }); }
});

router.put('/risk/:riskId', authorize('mbr:write'), async (req, res) => {
  try {
    const result = await updateRisk(req.params.riskId, req.body);
    if (!result) return res.status(404).json({ error: 'Risk not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'RISK_ASSESSMENT', resourceId: req.params.riskId, details: `Risk updated (RPN: ${result.rpn})` });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/risk/:riskId/review', authorize('mbr:approve'), async (req, res) => {
  try {
    const result = await reviewRisk(req.params.riskId, req.session.userId);
    if (!result) return res.status(404).json({ error: 'Not found' });
    await req.audit({ action: 'APPROVE', resourceType: 'RISK_ASSESSMENT', resourceId: req.params.riskId, details: 'Risk reviewed' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/risk/:mbrId/summary', async (req, res) => {
  try {
    const summary = await getRiskSummary(req.params.mbrId);
    res.json(summary);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 7: RTM GENERATOR
// ═══════════════════════════════════════════════════════════════

router.get('/rtm', authorize('audit:read'), async (req, res) => {
  try {
    const rtm = generateRTM();
    res.json(rtm);
  } catch (err) { res.status(500).json({ error: 'Failed to generate RTM' }); }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 8: PERIODIC REVIEW
// ═══════════════════════════════════════════════════════════════

router.get('/reviews', async (req, res) => {
  try {
    const reviews = await getReviews(req.query);
    res.json({ data: reviews });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/reviews/dashboard', async (req, res) => {
  try {
    const dashboard = await getDashboard();
    res.json(dashboard);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/reviews/upcoming', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const upcoming = await getUpcomingReviews(days);
    res.json({ data: upcoming, days_ahead: days });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/reviews/overdue', async (req, res) => {
  try {
    const overdue = await getOverdueReviews();
    res.json({ data: overdue });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/reviews', authorize('config:write'), async (req, res) => {
  try {
    const { review_type, title, description, frequency_months, next_due, assigned_to } = req.body;
    if (!review_type || !title || !next_due) return res.status(400).json({ error: 'review_type, title, and next_due required' });
    const result = await createReview({ reviewType: review_type, title, description, frequencyMonths: frequency_months, nextDue: next_due, assignedTo: assigned_to, createdBy: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'PERIODIC_REVIEW', resourceId: result.id, details: `Review: ${title}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/reviews/:id/complete', authorize('config:write'), async (req, res) => {
  try {
    const result = await completeReview(req.params.id, req.session.userId, req.body.findings, req.body.corrective_actions);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'PERIODIC_REVIEW', resourceId: req.params.id, details: 'Review completed' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 9: AI/ML GOVERNANCE
// ═══════════════════════════════════════════════════════════════

router.get('/ai/models', async (req, res) => {
  try {
    const models = await getModels(req.query.status);
    res.json({ data: models });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/ai/models', authorize('config:write'), async (req, res) => {
  try {
    const { model_name, model_version, provider, prompt_version, description, risk_level } = req.body;
    if (!model_name || !model_version || !provider) return res.status(400).json({ error: 'model_name, model_version, and provider required' });
    const result = await registerModel({ modelName: model_name, modelVersion: model_version, provider, promptVersion: prompt_version, description, riskLevel: risk_level, validatedBy: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'AI_MODEL', resourceId: result.id, details: `Model: ${model_name} v${model_version}` });
    res.status(201).json(result);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Model name+version already registered' });
    res.status(500).json({ error: 'Failed' });
  }
});

router.put('/ai/models/:id/status', authorize('config:write'), async (req, res) => {
  try {
    const result = await updateModelStatus(req.params.id, req.body.status, req.session.userId);
    if (!result) return res.status(404).json({ error: 'Model not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'AI_MODEL', resourceId: req.params.id, details: `Status: ${req.body.status}` });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/ai/models/:id/metrics', authorize('config:write'), async (req, res) => {
  try {
    const { period_start, period_end } = req.body;
    if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end required' });
    const result = await recordMetrics(req.params.id, period_start, period_end);
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/ai/models/:id/metrics', async (req, res) => {
  try {
    const metrics = await getMetricsHistory(req.params.id);
    res.json({ data: metrics });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/ai/models/:id/drift', async (req, res) => {
  try {
    const threshold = parseFloat(req.query.threshold) || 0.1;
    const result = await detectDrift(req.params.id, threshold);
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════════
// FEATURE 10: SBOM & CONFIG MANAGEMENT
// ═══════════════════════════════════════════════════════════════

router.get('/sbom', authorize('audit:read'), async (req, res) => {
  try {
    const sbom = generateSBOM();
    res.json(sbom);
  } catch (err) { res.status(500).json({ error: 'Failed to generate SBOM' }); }
});

router.post('/sbom/snapshot', authorize('config:write'), async (req, res) => {
  try {
    const { snapshot_type, version_tag, git_sha, content } = req.body;
    if (!snapshot_type || !content) return res.status(400).json({ error: 'snapshot_type and content required' });
    const result = await saveSnapshot(snapshot_type, content, version_tag, git_sha, req.session.userId);
    await req.audit({ action: 'CREATE', resourceType: 'CONFIG_SNAPSHOT', resourceId: result.id, details: `${snapshot_type} snapshot: ${version_tag || 'untagged'}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/sbom/snapshots', authorize('audit:read'), async (req, res) => {
  try {
    const type = req.query.type || 'SBOM';
    const snapshots = await getSnapshots(type);
    res.json({ data: snapshots });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.get('/system-health', async (req, res) => {
  try {
    const health = getSystemHealth();
    const dbR = await query('SELECT NOW() as t, current_database() as db');
    res.json({ ...health, status: 'healthy', db: dbR.rows[0] });
  } catch (err) { res.status(503).json({ status: 'unhealthy', error: err.message }); }
});

module.exports = router;
