// server/routes/kpiRoutes.js — Dashboard KPI API
const { Router } = require('express');
const { authenticate } = require('../middleware/middleware');
const svc = require('../services/kpiService');

const router = Router();
router.use(authenticate);

router.get('/kpis', async (req, res) => {
  try { res.json(await svc.getKPIs()); } catch (e) { res.status(500).json({ error: 'Failed to get KPIs' }); }
});
router.get('/batches', async (req, res) => {
  try { res.json({ data: await svc.getBatchSummary(req.query) }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.get('/products', async (req, res) => {
  try { res.json({ data: await svc.getProducts() }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.get('/throughput', async (req, res) => {
  try { res.json({ data: await svc.getThroughput() }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});
router.get('/quality/trend', async (req, res) => {
  try { res.json({ data: await svc.getQualityTrend() }); } catch (e) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
