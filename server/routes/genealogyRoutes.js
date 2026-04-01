// server/routes/genealogyRoutes.js — Batch Genealogy & Traceability API
const { Router } = require('express');
const { authenticate } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const svc = require('../services/genealogyService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// Batches
router.get('/batches', async (req, res) => {
  try { res.json({ data: await svc.listBatches(req.query) }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.get('/batches/:id', async (req, res) => {
  try { const b = await svc.getBatch(req.params.id); if (!b) return res.status(404).json({ error: 'Not found' }); res.json(b); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Materials
router.get('/materials', async (req, res) => {
  try { res.json({ data: await svc.listMaterials(req.query) }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.post('/materials', async (req, res) => {
  try {
    if (!req.body.lot_number || !req.body.material_name) return res.status(400).json({ error: 'lot_number and material_name required' });
    const lot = await svc.createMaterialLot(req.body);
    await req.audit({ action: 'CREATE', resourceType: 'MATERIAL_LOT', resourceId: lot.id, details: `Lot ${lot.lot_number}: ${lot.material_name}` });
    res.status(201).json(lot);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Lot number already exists' });
    res.status(500).json({ error: 'Failed' });
  }
});
router.post('/materials/:id/release', async (req, res) => {
  try { const lot = await svc.releaseLot(req.params.id); res.json(lot); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Genealogy links
router.post('/link', async (req, res) => {
  try {
    const link = await svc.linkMaterialToBatch(req.body);
    res.status(201).json(link);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Traceability
router.get('/trace/forward/:lotNumber', async (req, res) => {
  try { res.json(await svc.traceForward(req.params.lotNumber)); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.get('/trace/backward/:batchNumber', async (req, res) => {
  try { res.json(await svc.traceBackward(req.params.batchNumber)); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Recall simulation
router.get('/recalls', async (req, res) => {
  try {
    if (!req.query.lot_number) return res.json({ data: [] });
    const result = await svc.simulateRecall(req.query.lot_number);
    res.json(result);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Stats
router.get('/stats/overview', async (req, res) => {
  try { res.json(await svc.getGenealogyStats()); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
