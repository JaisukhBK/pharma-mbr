// server/routes/dispensingRoutes.js — Electronic Weighing & Dispensing API
// 21 CFR 211.101 — Charge-in of components
const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const svc = require('../services/dispensingService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// Validation errors from the service carry e.status (4xx) and a safe message.
// Unexpected errors become 500, and in production their details are hidden.
function sendError(res, e, tag) {
  const status = e.status || 500;
  if (status >= 500) console.error('[DISPENSING] ' + tag + ':', e.message);
  const hide = status >= 500 && process.env.NODE_ENV === 'production';
  res.status(status).json({ error: hide ? 'Internal server error' : e.message });
}

// ═══ STATS ═══
router.get('/stats', async (req, res) => {
  try { res.json(await svc.getStats()); }
  catch (e) { sendError(res, e, 'Stats'); }
});

// ═══ ORDERS ═══
router.get('/orders', async (req, res) => {
  try { res.json({ data: await svc.listOrders(req.query) }); }
  catch (e) { sendError(res, e, 'List orders'); }
});

router.get('/orders/:id', async (req, res) => {
  try {
    const o = await svc.getOrder(req.params.id);
    if (!o) return res.status(404).json({ error: 'Order not found' });
    res.json(o);
  } catch (e) { sendError(res, e, 'Get order'); }
});

// Create orders from BOM for a batch
router.post('/orders/from-bom', authorize('config:write'), async (req, res) => {
  try {
    const { ebr_id, batch_number, mbr_id } = req.body;
    if (!batch_number || !mbr_id) return res.status(400).json({ error: 'batch_number and mbr_id required' });
    const orders = await svc.createOrdersFromBOM(ebr_id, batch_number, mbr_id);
    await req.audit({ action: 'CREATE', resourceType: 'DISPENSING', resourceId: batch_number, details: `Created ${orders.length} dispensing orders for batch ${batch_number}` });
    res.status(201).json({ data: orders, count: orders.length });
  } catch (e) { sendError(res, e, 'From BOM'); }
});

// ═══ LOT SELECTION ═══
router.get('/orders/:id/available-lots', async (req, res) => {
  try {
    const order = await svc.getOrder(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    const lots = await svc.getAvailableLots(order.material_id, parseFloat(order.target_quantity));
    res.json(lots);
  } catch (e) { sendError(res, e, 'Available lots'); }
});

// ═══ WEIGHING ═══
router.post('/orders/:id/weigh', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.gross_weight || !req.body.lot_id) return res.status(400).json({ error: 'gross_weight and lot_id required' });
    const result = await svc.recordWeighing(req.params.id, { ...req.body, operator_id: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'WEIGHING', resourceId: result.record.id, details: `Weighed: ${result.net_weight} ${result.record.unit} (PASS) — lot ${result.record.lot_number}, tolerance ${result.tolerance.min.toFixed(4)}–${result.tolerance.max.toFixed(4)}` });
    res.status(201).json(result);
  } catch (e) {
    // Blocked weighings (expired lot, wrong material, out of tolerance) are GMP-relevant events — audit them
    if (e.status && e.status < 500) {
      await Promise.resolve(req.audit({
        action: 'REJECT', resourceType: 'WEIGHING', resourceId: req.params.id,
        details: `Weighing rejected: ${e.message} (lot_id ${req.body.lot_id || 'none'})`,
      })).catch(function(err) { console.warn('[DISPENSING] Audit of rejection failed:', err.message); });
    }
    sendError(res, e, 'Weigh');
  }
});

// ═══ VERIFICATION ═══
router.put('/records/:id/verify', authorize('config:write'), async (req, res) => {
  try {
    const record = await svc.verifyWeighing(req.params.id, req.session.userId);
    await req.audit({ action: 'UPDATE', resourceType: 'WEIGHING', resourceId: req.params.id, details: 'Weighing verified (dual check)' });
    res.json(record);
  } catch (e) { sendError(res, e, 'Verify'); }
});

module.exports = router;
