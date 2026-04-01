// server/__tests__/helpers/testApp.js — Express app for Supertest (no listen)
// Mirrors server/index.js but exports app instead of starting it

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { auditMiddleware } = require('../../middleware/middleware');

function createTestApp() {
  const app = express();
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '50mb' }));
  app.use(auditMiddleware);

  // Routes — identical to index.js
  app.use('/api/auth', require('../../routes/authRoutes'));
  app.use('/api/training', require('../../routes/trainingRoutes'));
  app.use('/api/mbr', require('../../routes/mbrRoutes'));
  app.use('/api/co-designer', require('../../routes/coDesignerRoutes'));
  app.use('/api/change-control', require('../../routes/changeControlRoutes'));
  app.use('/api/compliance', require('../../routes/complianceRoutes'));
  app.use('/api/ebr', require('../../routes/ebrRoutes'));
  app.use('/api/devcapa', require('../../routes/devcapaRoutes'));
  app.use('/api/equipment', require('../../routes/equipmentRoutes'));
  app.use('/api/genealogy', require('../../routes/genealogyRoutes'));
  app.use('/api', require('../../routes/kpiRoutes'));

  // Global audit endpoint
  const { query } = require('../../db/pool');
  app.get('/api/audit', async (req, res) => {
    try {
      const { limit = 100, offset = 0 } = req.query;
      const r = await query(
        'SELECT at.*,u.full_name as user_name FROM audit_trail at LEFT JOIN users u ON at.user_id=u.id ORDER BY at.created_at DESC LIMIT $1 OFFSET $2',
        [parseInt(limit), parseInt(offset)]
      );
      res.json({ data: r.rows });
    } catch (err) {
      res.status(500).json({ error: 'Failed' });
    }
  });

  // Health check
  app.get('/health', async (req, res) => {
    try {
      const r = await query('SELECT NOW() as t, current_database() as db');
      res.json({ status: 'healthy', db: r.rows[0] });
    } catch (err) {
      res.status(503).json({ status: 'unhealthy', error: err.message });
    }
  });

  app.use((err, req, res, next) => {
    console.error('[TEST ERROR]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createTestApp };
