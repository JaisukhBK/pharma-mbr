// server/routes/envMonitoringRoutes.js — Environmental Monitoring API
// EU GMP Annex 1 | 21 CFR 211.42 | ISO 14644
const { Router } = require('express');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const svc = require('../services/envMonitoringService');
const poller = require('../services/bmsPollingEngine');
const simulator = require('../services/bmsSimulator');

const router = Router();

// ═══ BMS INGESTION — no auth required (uses API key in body) ═══
// BMS/EMS systems push readings here
router.post('/ingest', async (req, res) => {
  try {
    if (req.body.readings && Array.isArray(req.body.readings)) {
      const result = await svc.ingestBatch(req.body.readings);
      res.json(result);
    } else {
      const result = await svc.ingestReading(req.body);
      res.status(201).json(result);
    }
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// All other routes require auth
router.use(authenticate);
router.use(auditMiddleware);

// ═══ STATS ═══
router.get('/stats', async (req, res) => {
  try { res.json(await svc.getStats()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ ZONES ═══
router.get('/zones', async (req, res) => {
  try { res.json({ data: await svc.listZones(req.query) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/zones/:id', async (req, res) => {
  try {
    const z = await svc.getZone(req.params.id);
    if (!z) return res.status(404).json({ error: 'Zone not found' });
    res.json(z);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/zones', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.zone_code || !req.body.zone_name) return res.status(400).json({ error: 'zone_code and zone_name required' });
    const z = await svc.createZone(req.body);
    await req.audit({ action: 'CREATE', resourceType: 'ENV_ZONE', resourceId: z.id, details: `${z.zone_code}: ${z.zone_name}` });
    res.status(201).json(z);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Zone code already exists' });
    res.status(500).json({ error: e.message });
  }
});

// ═══ SENSORS ═══
router.post('/zones/:zoneId/sensors', authorize('config:write'), async (req, res) => {
  try {
    if (!req.body.sensor_code || !req.body.parameter_type) return res.status(400).json({ error: 'sensor_code and parameter_type required' });
    const s = await svc.createSensor(req.params.zoneId, req.body);
    await req.audit({ action: 'CREATE', resourceType: 'ENV_SENSOR', resourceId: s.id, details: `${s.sensor_code}: ${s.parameter_type}` });
    res.status(201).json(s);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ READINGS ═══
router.post('/readings', authorize('config:write'), async (req, res) => {
  try {
    const result = await svc.ingestReading({ ...req.body, source: 'Manual' });
    await req.audit({ action: 'CREATE', resourceType: 'ENV_READING', resourceId: result.reading.id, details: `Manual: ${result.reading.value} ${result.reading.unit}` });
    res.status(201).json(result);
  } catch (e) { res.status(400).json({ error: e.message }); }
});

router.get('/sensors/:sensorId/history', async (req, res) => {
  try { res.json({ data: await svc.getReadingHistory(req.params.sensorId, parseInt(req.query.hours) || 24) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/zones/:zoneId/snapshot', async (req, res) => {
  try { res.json({ data: await svc.getZoneSnapshot(req.params.zoneId) }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ ALERTS ═══
router.get('/alerts', async (req, res) => {
  try { res.json({ data: await svc.getActiveAlerts() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/alerts/:id/acknowledge', authorize('config:write'), async (req, res) => {
  try {
    const a = await svc.acknowledgeAlert(req.params.id, req.session.userId, req.body.notes);
    if (!a) return res.status(404).json({ error: 'Alert not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'ENV_ALERT', resourceId: req.params.id, details: 'Alert acknowledged' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.put('/alerts/:id/resolve', authorize('config:write'), async (req, res) => {
  try {
    const a = await svc.resolveAlert(req.params.id, req.body.notes);
    if (!a) return res.status(404).json({ error: 'Alert not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'ENV_ALERT', resourceId: req.params.id, details: 'Alert resolved' });
    res.json(a);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ BMS CONNECTIONS ═══
router.get('/connections', authorize('config:read'), async (req, res) => {
  try { res.json({ data: await svc.listConnections() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/connections', authorize('config:write'), async (req, res) => {
  try {
    const c = await svc.createConnection(req.body);
    await req.audit({ action: 'CREATE', resourceType: 'BMS_CONNECTION', resourceId: c.id, details: `${c.connection_name} (${c.system_type})` });
    // Restart polling to pick up new connection
    poller.restartPolling().catch(e => console.error('[BMS-POLL] Restart failed:', e.message));
    res.status(201).json(c);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ POLLING CONTROL ═══
router.get('/poll/status', authorize('config:read'), async (req, res) => {
  try { res.json(poller.getPollerStatus()); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/poll/start', authorize('config:write'), async (req, res) => {
  try { await poller.startPolling(); res.json({ message: 'Polling started', status: poller.getPollerStatus() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/poll/stop', authorize('config:write'), async (req, res) => {
  try { poller.stopPolling(); res.json({ message: 'Polling stopped' }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/poll/restart', authorize('config:write'), async (req, res) => {
  try { await poller.restartPolling(); res.json({ message: 'Polling restarted', status: poller.getPollerStatus() }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Vercel Cron trigger — POST /api/env/poll/trigger (no auth, protected by Vercel cron secret)
router.post('/poll/trigger', async (req, res) => {
  try {
    const results = await poller.pollAllOnce();
    res.json({ triggered_at: new Date().toISOString(), results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ EBR ENVIRONMENTAL RECORDING (FR-ENV-007) ═══
// Capture env snapshot at step start/complete
router.post('/ebr/:ebrId/step/:stepId/env-snapshot', authenticate, async (req, res) => {
  try {
    const { zone_id, step_name, event_type } = req.body;
    if (!zone_id || !event_type) return res.status(400).json({ error: 'zone_id and event_type required' });
    if (!['start_snapshot', 'periodic', 'end_snapshot'].includes(event_type)) return res.status(400).json({ error: 'event_type must be start_snapshot, periodic, or end_snapshot' });
    const result = await svc.captureStepSnapshot(req.params.ebrId, req.params.stepId, step_name || '', zone_id, event_type);
    await req.audit({ action: 'CREATE', resourceType: 'EBR_ENV', resourceId: req.params.ebrId, details: `Env ${event_type} for step ${req.params.stepId}: ${result.readings.length} readings, ${result.out_of_spec_count} OOS` });
    res.status(201).json(result);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Get historized env records for a step
router.get('/ebr/:ebrId/step/:stepId/env-records', authenticate, async (req, res) => {
  try { res.json(await svc.getStepEnvRecords(req.params.ebrId, req.params.stepId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// Get env summary for entire EBR
router.get('/ebr/:ebrId/env-summary', authenticate, async (req, res) => {
  try { res.json(await svc.getEbrEnvSummary(req.params.ebrId)); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ═══ BMS SIMULATOR — mock BMS REST API for testing ═══
// Configure a BMS connection with endpoint_url pointing to this endpoint
router.get('/simulate/bms', async (req, res) => {
  try {
    const readings = await simulator.generateBmsPayload();
    res.json(readings);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Quick simulate: generate and ingest readings for all sensors in one call
router.post('/simulate/run', authenticate, async (req, res) => {
  try {
    const readings = await simulator.generateBmsPayload();
    const results = [];
    for (const r of readings) {
      try {
        const result = await svc.ingestReading({ bms_tag: r.tag, value: r.value, source: 'Simulation', bms_timestamp: r.timestamp });
        results.push({ tag: r.tag, value: r.value, in_spec: result.in_spec, alert: result.alert ? result.alert.alert_type : null });
      } catch (e) { results.push({ tag: r.tag, error: e.message }); }
    }
    res.json({ simulated_at: new Date().toISOString(), readings_count: results.length, results });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
