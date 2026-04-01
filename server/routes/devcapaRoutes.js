// server/routes/devcapaRoutes.js — Deviation & CAPA API
const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const svc = require('../services/devcapaService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// Deviations
router.get('/deviations', async (req, res) => {
  try { res.json({ data: await svc.listDeviations(req.query) }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.get('/deviations/:id', async (req, res) => {
  try { const d = await svc.getDeviation(req.params.id); if (!d) return res.status(404).json({ error: 'Not found' }); res.json(d); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.post('/deviations', async (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'title required' });
    const d = await svc.createDeviation({ ...req.body, reported_by: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'DEVIATION', resourceId: d.id, details: `${d.deviation_number}: ${d.title}` });
    res.status(201).json(d);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.put('/deviations/:id', async (req, res) => {
  try { const d = await svc.updateDeviation(req.params.id, req.body); if (!d) return res.status(404).json({ error: 'Not found' }); res.json(d); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.post('/deviations/:id/close', authorize('mbr:approve'), async (req, res) => {
  try {
    const d = await svc.closeDeviation(req.params.id, req.session.userId);
    await req.audit({ action: 'UPDATE', resourceType: 'DEVIATION', resourceId: req.params.id, details: 'Deviation closed' });
    res.json(d);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// CAPAs
router.get('/capas', async (req, res) => {
  try { res.json({ data: await svc.listCAPAs(req.query) }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.get('/capas/:id', async (req, res) => {
  try { const c = await svc.getCAPA(req.params.id); if (!c) return res.status(404).json({ error: 'Not found' }); res.json(c); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.post('/capas', async (req, res) => {
  try {
    if (!req.body.title) return res.status(400).json({ error: 'title required' });
    const c = await svc.createCAPA({ ...req.body, created_by: req.session.userId });
    await req.audit({ action: 'CREATE', resourceType: 'CAPA', resourceId: c.id, details: `${c.capa_number}: ${c.title}` });
    res.status(201).json(c);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.put('/capas/:id', async (req, res) => {
  try { const c = await svc.updateCAPA(req.params.id, req.body); if (!c) return res.status(404).json({ error: 'Not found' }); res.json(c); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.post('/capas/:id/verify', authorize('mbr:approve'), async (req, res) => {
  try {
    const c = await svc.verifyCAPA(req.params.id, req.session.userId);
    await req.audit({ action: 'APPROVE', resourceType: 'CAPA', resourceId: req.params.id, details: 'CAPA verified effective' });
    res.json(c);
  } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

// Stats
router.get('/stats/overview', async (req, res) => {
  try { res.json(await svc.getDevCAPAStats()); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
