// server/routes/genealogyRoutes.js — Material Genealogy & Traceability API
// 21 CFR 211.184 — Component, container, closure records
const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const { query } = require('../db/pool');
const svc = require('../services/genealogyService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ═══ STATS ═══
router.get('/stats', async (req, res) => {
  try { res.json(await svc.getStats()); }
  catch (e) { console.error('[GENEALOGY] Stats:', e.message); res.status(500).json({ error: e.message }); }
});

// ═══ MATERIAL MASTER ═══
router.get('/materials', async (req, res) => {
  try { res.json({ data: await svc.listMaterials(req.query) }); }
  catch (e) { console.error('[GENEALOGY] List:', e.message); res.status(500).json({ error: e.message }); }
});

router.get('/materials/:id', async (req, res) => {
  try {
    const m = await svc.getMaterial(req.params.id);
    if (!m) return res.status(404).json({ error: 'Material not found' });
    res.json(m);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/materials', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.material_code || !req.body.material_name) return res.status(400).json({ error: 'material_code and material_name required' });
    const m = await svc.createMaterial({ ...req.body, created_by: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'MATERIAL', resourceId: m.id, details: `${m.material_code}: ${m.material_name} (${m.material_type})` });
    res.status(201).json(m);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Material code already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/materials/:id', authorize('config:write'), async (req, res) => {
  try {
    const m = await svc.updateMaterial(req.params.id, req.body);
    if (!m) return res.status(404).json({ error: 'Material not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'MATERIAL', resourceId: req.params.id, details: `Updated: ${m.material_name}` });
    res.json(m);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ LOTS — static routes FIRST (before parametric :lotId routes) ═══
router.post('/materials/:materialId/lots', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.lot_number || !req.body.quantity_received || !req.body.received_date) return res.status(400).json({ error: 'lot_number, quantity_received, and received_date required' });
    const lot = await svc.createLot(req.params.materialId, { ...req.body, received_by: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'LOT', resourceId: lot.id, details: `Lot ${lot.lot_number}: ${lot.quantity_received} ${lot.unit} received` });
    res.status(201).json(lot);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Lot number already exists for this material' });
    res.status(500).json({ error: e.message });
  }
});

// Static lot routes — must be before /lots/:lotId routes
router.get('/lots/expiring', async (req, res) => {
  try { res.json({ data: await svc.getExpiringLots(parseInt(req.query.days) || 90) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/lots/lookup/:lotNumber', async (req, res) => {
  try {
    const r = await query(
      `SELECT l.*, m.material_name, m.material_code, m.material_type 
       FROM material_lots l JOIN material_master m ON l.material_id=m.id 
       WHERE l.lot_number=$1`, [req.params.lotNumber]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Lot not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Parametric lot routes — after static routes
router.put('/lots/:lotId/status', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.status) return res.status(400).json({ error: 'status required' });
    const lot = await svc.updateLotStatus(req.params.lotId, req.body.status, req.session.userId, req.body.notes);
    if (!lot) return res.status(404).json({ error: 'Lot not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'LOT', resourceId: req.params.lotId, details: `Status → ${req.body.status}` });
    res.json(lot);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/lots/:lotId/transactions', async (req, res) => {
  try { res.json({ data: await svc.getLotTransactions(req.params.lotId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ TRANSACTIONS ═══
router.post('/transactions', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.lot_id || !req.body.transaction_type || !req.body.quantity) return res.status(400).json({ error: 'lot_id, transaction_type, and quantity required' });
    const txn = await svc.recordTransaction({ ...req.body, performed_by: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'TRANSACTION', resourceId: txn.id, details: `${req.body.transaction_type}: ${req.body.quantity} ${req.body.unit || 'kg'}` });
    res.status(201).json(txn);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ TRACE ═══
router.get('/trace/forward/:lotId', async (req, res) => {
  try {
    const result = await svc.forwardTrace(req.params.lotId);
    if (result.error) return res.status(404).json(result);
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/trace/backward/:batchNumber', async (req, res) => {
  try { res.json(await svc.backwardTrace(req.params.batchNumber)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ BATCHES (for backward trace lookup) ═══
router.get('/batches', async (req, res) => {
  try {
    const r = await query('SELECT id, ebr_code, batch_number, product_name, status, created_at FROM ebrs ORDER BY created_at DESC LIMIT 100');
    res.json({ data: r.rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
