// server/routes/equipmentRoutes.js — Equipment Management API
const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const svc = require('../services/equipmentService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ── List & Stats ──────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try { res.json({ data: await svc.listEquipment(req.query) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/stats/overview', async (req, res) => {
  try { res.json(await svc.getEquipmentStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/calibrations/overdue', async (req, res) => {
  try { res.json({ data: await svc.getOverdueCalibrations() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Single equipment ──────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const eq = await svc.getEquipment(req.params.id);
    if (!eq) return res.status(404).json({ error: 'Equipment not found' });
    res.json(eq);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Create ────────────────────────────────────────────────────────────────────
router.post('/', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.equipment_code || !req.body.equipment_name) {
      return res.status(400).json({ error: 'equipment_code and equipment_name required' });
    }
    const eq = await svc.createEquipment(req.body);
    await req.audit({
      action: 'CREATE', resourceType: 'EQUIPMENT', resourceId: eq.id,
      details: `${eq.equipment_code}: ${eq.equipment_name}`,
    });
    res.status(201).json(eq);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Equipment code already exists' });
    res.status(500).json({ error: e.message });
  }
});

// ── Update ────────────────────────────────────────────────────────────────────
router.put('/:id', authorize('config:write'), async (req, res) => {
  try {
    const eq = await svc.updateEquipment(req.params.id, req.body);
    if (!eq) return res.status(404).json({ error: 'Equipment not found' });
    await req.audit({
      action: 'UPDATE', resourceType: 'EQUIPMENT', resourceId: req.params.id,
      details: `Status: ${req.body.status || 'updated'}`,
    });
    res.json(eq);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Calibration ───────────────────────────────────────────────────────────────
router.post('/:id/calibration', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.calibration_date || !req.body.next_due) {
      return res.status(400).json({ error: 'calibration_date and next_due required' });
    }
    const cal = await svc.recordCalibration(req.params.id, req.body);
    await req.audit({
      action: 'CREATE', resourceType: 'CALIBRATION', resourceId: cal.id,
      details: `Equipment calibrated: ${req.body.result || 'Pass'} — next due ${req.body.next_due}`,
    });
    res.status(201).json(cal);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/:id/calibrations', async (req, res) => {
  try { res.json({ data: await svc.getCalibrationHistory(req.params.id) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ── Qualification ─────────────────────────────────────────────────────────────
router.put('/:id/qualification', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.qualification_status) {
      return res.status(400).json({ error: 'qualification_status required' });
    }
    const result = await svc.updateQualificationStatus(
      req.params.id, req.body.qualification_status,
      req.session.userId, req.body.notes
    );
    if (result.error) return res.status(400).json(result);
    await req.audit({
      action: 'UPDATE', resourceType: 'EQUIPMENT', resourceId: req.params.id,
      details: `Qualification updated: ${req.body.qualification_status}`,
    });
    res.json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
