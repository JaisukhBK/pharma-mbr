// server/routes/dispensingRoutes.js — Electronic Weighing & Dispensing API
// 21 CFR 211.101 — Charge-in of components
const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const svc = require('../services/dispensingService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ═══ STATS ═══
router.get('/stats', async (req, res) => {
  try { res.json(await svc.getStats()); }
  catch (e) { console.error('[DISPENSING] Stats:', e.message); res.status(500).json({ error: e.message }); }
});

// ═══ ORDERS ═══
router.get('/orders', async (req, res) => {
  try { res.json({ data: await svc.listOrders(req.query) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const o = await svc.getOrder(req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    res.json(o);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Create orders from BOM for a batch
router.post('/orders/from-bom', authorize('config:write'), async (req, res) => {
  try {
    const { ebr_id, batch_number, mbr_id } = req.body;
    if (!batch_number || !mbr_id) return res.status(400).json({ error: 'batch_number and mbr_id required' });
    const orders = await svc.createOrdersFromBOM(ebr_id, batch_number, mbr_id);
    await req.audit({ action: 'CREATE', resourceType: 'DISPENSING', resourceId: batch_number, details: `Created ${orders.length} dispensing orders for batch ${batch_number}` });
    res.status(201).json({ data: orders, count: orders.length });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ LOT SELECTION ═══
router.get('/orders/:id/available-lots', async (req, res) => {
  try {
    const order = await svc.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const lots = await svc.getAvailableLots(order.material_id, parseFloat(order.target_quantity));
    res.json(lots);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ WEIGHING ═══
router.post('/orders/:id/weigh', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.gross_weight || !req.body.lot_id) return res.status(400).json({ error: 'gross_weight and lot_id required' });
    const result = await svc.recordWeighing(req.params.id, { ...req.body, operator_id: req.session.userId });
    const tolLabel = result.within_tolerance ? 'PASS' : 'FAIL';
    await req.audit({ action: 'CREATE', resourceType: 'WEIGHING', resourceId: result.record.id, details: `Weighed: ${result.net_weight} ${result.record.unit} (${tolLabel}) — tolerance ${result.tolerance.min.toFixed(4)}–${result.tolerance.max.toFixed(4)}` });
    res.status(201).json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ VERIFICATION ═══
router.put('/records/:id/verify', authorize('config:write'), async (req, res) => {
  try {
    const record = await svc.verifyWeighing(req.params.id, req.session.userId);
    await req.audit({ action: 'UPDATE', resourceType: 'WEIGHING', resourceId: req.params.id, details: 'Weighing verified (dual check)' });
    res.json(record);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
