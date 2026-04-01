// server/app.js
// Express app — separated from server start for Vercel serverless
// Local: index.js imports this and calls app.listen()
// Vercel: api/index.js imports this and exports as serverless function

require('dotenv').config();

var express    = require('express');
var cors       = require('cors');
var helmet     = require('helmet');
var rateLimit  = require('express-rate-limit');
var { body, validationResult } = require('express-validator');

var { runMigrations } = require('./db/pool');
var { authenticate, authorize, logAudit, queryAudit, verifyIntegrity, getAuditCount } = require('./middleware/middleware');

var authRoutes                 = require('./routes/authRoutes');
var mbrRoutes                  = require('./routes/mbrRoutes');
var ebrRoutes                  = require('./routes/ebrRoutes');
var equipmentRoutes            = require('./routes/equipmentRoutes');
var genealogyRoutes            = require('./routes/genealogyRoutes');
var devcapaRoutes              = require('./routes/devcapaRoutes');
var trainingRoutes             = require('./routes/trainingRoutes');
var changeControlRoutes        = require('./routes/changeControlRoutes');
var complianceRoutes           = require('./routes/complianceRoutes');
var coDesignerRoutes           = require('./routes/coDesignerRoutes');
var kpiRoutes                  = require('./routes/kpiRoutes');
var integrationPlatformRoutes  = require('./routes/integrationPlatformRoutes');

var app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

var allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['http://localhost:5173', 'http://localhost:5176', 'http://localhost:3000'];

app.use(cors({
  origin: function(origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    if (origin && origin.endsWith('.vercel.app')) return callback(null, true);
    callback(new Error('CORS: origin not allowed — ' + origin));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
  maxAge: 86400,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

var loginLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Too many login attempts' }, standardHeaders: true, legacyHeaders: false });
var apiLimiter = rateLimit({ windowMs: 60*1000, max: 300, message: { error: 'Rate limit exceeded' }, standardHeaders: true, legacyHeaders: false });
app.use('/api', apiLimiter);

function validate(rules) {
  return async function(req, res, next) {
    await Promise.all(rules.map(function(rule) { return rule.run(req); }));
    var errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: 'Validation failed', fields: errors.array().map(function(e) { return { field: e.path, message: e.msg }; }) });
    next();
  };
}

var loginValidation = validate([
  body('email').isEmail().withMessage('Valid email required').normalizeEmail().trim(),
  body('password').notEmpty().withMessage('Password required').isLength({ max: 200 }),
]);
var registerValidation = validate([
  body('email').isEmail().withMessage('Valid email required').normalizeEmail().trim(),
  body('password').isLength({ min: 8 }).withMessage('Min 8 characters'),
  body('full_name').notEmpty().withMessage('full_name required').trim().escape(),
]);

app.locals.validate = validate;
app.post('/api/auth/login', loginValidation);
app.post('/api/auth/register', registerValidation);

// Health check — no auth required, must be before authenticated routes
app.get('/api/health', async function(req, res) {
  var c = await getAuditCount().catch(function() { return '?'; });
  res.json({ status: 'healthy', uptime: process.uptime(), timestamp: new Date().toISOString(), version: '1.0.0', auditEntries: c });
});

app.use('/api/auth',                 loginLimiter, authRoutes);
app.use('/api/mbr',                  mbrRoutes);
app.use('/api/ebr',                  ebrRoutes);
app.use('/api/equipment',            equipmentRoutes);
app.use('/api/genealogy',            genealogyRoutes);
app.use('/api/devcapa',              devcapaRoutes);
app.use('/api/training',             trainingRoutes);
app.use('/api/change-control',       changeControlRoutes);
app.use('/api/compliance',           complianceRoutes);
app.use('/api/co-designer',          coDesignerRoutes);
app.use('/api/integration-platform', integrationPlatformRoutes);
app.use('/api',                      kpiRoutes);

app.get('/api/audit', authenticate, authorize('audit:read'), async function(req, res) {
  var p = req.query;
  var data = await queryAudit({ resource: p.resource, userId: p.userId, action: p.action, from: p.from, to: p.to, limit: p.limit });
  res.json(data);
});
app.get('/api/audit/verify', authenticate, authorize('audit:read'), async function(req, res) { res.json(await verifyIntegrity()); });
app.get('/api/audit/export', authenticate, authorize('audit:export'), async function(req, res) {
  var data = await queryAudit({ limit: 1000 });
  var csv = 'Timestamp,User,Action,Resource,ResourceId,Details,Checksum\n';
  data.entries.forEach(function(e) { csv += '"'+(e.timestamp||'')+'",'+(e.user_name||'')+','+(e.action||'')+','+(e.resource||'')+','+(e.resource_id||'')+','+(e.details||'').replace(/"/g,'""')+','+(e.checksum||'')+'\n'; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=audit_trail_'+new Date().toISOString().split('T')[0]+'.csv');
  res.send(csv);
});

app.get('/api/system/config', authenticate, authorize('config:read'), function(req, res) {
  res.json({ systemName: 'PharmaMES.AI', version: '1.0.0', gamp5Category: 5, environment: process.env.NODE_ENV || 'development', aiEnabled: !!process.env.GROQ_API_KEY });
});

app.use(function(req, res) { res.status(404).json({ error: 'Route not found', path: req.path }); });
app.use(function(err, req, res, _next) {
  console.error('[server] Error:', err.message);
  if (err.message && err.message.startsWith('CORS:')) return res.status(403).json({ error: err.message });
  res.status(err.status || 500).json({ error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message });
});

// Run migrations once on cold start
runMigrations().catch(function(e) { console.error('Migration error:', e.message); });

module.exports = app;
