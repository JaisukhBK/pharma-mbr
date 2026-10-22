// server/routes/integrationPlatformRoutes.js — Integration Platform API
// FS-INT-001 v1.1 — ERP, LIMS, Historian, OPC UA
const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const engine = require('../services/integrationEngine');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ═══ STATS ═══
router.get('/stats', async (req, res) => {
  try { res.json(await engine.getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ CONNECTIONS ═══
router.get('/connections', async (req, res) => {
  try { res.json({ data: await engine.listConnections(req.query) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/connections/:id', async (req, res) => {
  try {
    const c = await engine.getConnection(req.params.id);
    if (!c) return res.status(404).json({ error: 'Connection not found' });
    res.json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/connections', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.connection_name || !req.body.system_type) return res.status(400).json({ error: 'connection_name and system_type required' });
    const c = await engine.createConnection(req.body);
    await req.audit({ action: 'CREATE', resourceType: 'INTEGRATION', resourceId: c.id, details: `${c.connection_name} (${c.system_type})` });
    res.status(201).json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/connections/:id/test', authorize('config:write'), async (req, res) => {
  try {
    const result = await engine.testConnection(req.params.id);
    await req.audit({ action: 'UPDATE', resourceType: 'INTEGRATION', resourceId: req.params.id, details: `Test: ${result.success ? 'OK' : 'FAIL'} (${result.duration_ms}ms)` });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ MESSAGE QUEUE ═══
router.get('/queue', async (req, res) => {
  try { res.json({ data: await engine.getQueueItems(req.query) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queue/process', authorize('config:write'), async (req, res) => {
  try {
    const result = await engine.processQueue();
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/queue/enqueue', authorize('config:write'), async (req, res) => {
  try {
    const msg = await engine.enqueueMessage(req.body);
    res.status(201).json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ ACTIVITY LOG ═══
router.get('/log', async (req, res) => {
  try { res.json({ data: await engine.getRecentLog(parseInt(req.query.limit) || 50) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ ERP — PRODUCTION ORDERS ═══
router.get('/erp/orders', async (req, res) => {
  try { res.json({ data: await engine.listProductionOrders(req.query) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/erp/orders', authorize('config:write'), async (req, res) => {
  try {
    const order = await engine.createProductionOrder(req.body);
    await req.audit({ action: 'CREATE', resourceType: 'ERP_ORDER', resourceId: order.id, details: `Order ${order.erp_order_number}: ${order.product_name}` });
    res.status(201).json(order);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Order number already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.post('/erp/batch-report', authorize('config:write'), async (req, res) => {
  try {
    const msg = await engine.postBatchReport(req.body.connection_id, req.body.ebr_id, req.body);
    res.status(201).json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/erp/goods-movement', authorize('config:write'), async (req, res) => {
  try {
    const msg = await engine.postGoodsMovement(req.body.connection_id, req.body.type, req.body);
    res.status(201).json(msg);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ LIMS — SAMPLES ═══
router.get('/lims/samples', async (req, res) => {
  try { res.json({ data: await engine.listSamples(req.query) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/lims/samples', authorize('config:write'), async (req, res) => {
  try {
    const sample = await engine.submitSample(req.body.connection_id, { ...req.body, submitted_by: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'LIMS_SAMPLE', resourceId: sample.id, details: `Sample for ${req.body.batch_number}` });
    res.status(201).json(sample);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/lims/samples/:id/results', authorize('config:write'), async (req, res) => {
  try {
    const sample = await engine.updateSampleResults(req.params.id, req.body.results, req.body.is_oos);
    await req.audit({ action: 'UPDATE', resourceType: 'LIMS_SAMPLE', resourceId: req.params.id, details: `Results: ${req.body.is_oos ? 'OOS' : 'Pass'}` });
    res.json(sample);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// LIMS webhook — external LIMS pushes results here
router.post('/lims/webhook/results', async (req, res) => {
  try {
    const { sample_id, results, is_oos } = req.body;
    if (!sample_id) return res.status(400).json({ error: 'sample_id required' });
    const sample = await engine.updateSampleResults(sample_id, results, is_oos);
    res.json({ received: true, sample });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ═══ HISTORIAN — BATCH CONTEXTS ═══
router.get('/historian/contexts', async (req, res) => {
  try {
    if (!req.query.ebr_id) return res.status(400).json({ error: 'ebr_id required' });
    res.json({ data: await engine.listBatchContexts(req.query.ebr_id) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/historian/contexts', authorize('config:write'), async (req, res) => {
  try {
    const ctx = await engine.openBatchContext(req.body.connection_id, req.body.ebr_id, req.body.step_id, req.body.step_name, req.body.tags);
    res.status(201).json(ctx);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/historian/contexts/:id/close', authorize('config:write'), async (req, res) => {
  try {
    const ctx = await engine.closeBatchContext(req.params.id);
    if (!ctx) return res.status(404).json({ error: 'Context not found' });
    res.json(ctx);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
