// server/app.js
// PharmaMES.AI — single source of truth for the Express app.
// Every route, security setting, and validator lives HERE and nowhere else.
//   Local:  index.js imports this and calls app.listen()
//   Vercel: api/index.js imports this and exports it as the serverless function

require('dotenv').config();

var express    = require('express');
var cors       = require('cors');
var helmet     = require('helmet');
var rateLimit  = require('express-rate-limit');
var { body, validationResult } = require('express-validator');

var { runMigrations } = require('./db/pool');
var { authenticate, authorize, queryAudit, verifyIntegrity, getAuditCount } = require('./middleware/middleware');

// ── Routes ───────────────────────────────────────────────────────────────────
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
var dispensingRoutes           = require('./routes/dispensingRoutes');
var envMonitoringRoutes        = require('./routes/envMonitoringRoutes');

var isProd = process.env.NODE_ENV === 'production';

// ── JWT_SECRET strength check (21 CFR Part 11 — refuse weak secrets) ────────
// Throws instead of process.exit() so it fails closed both locally and on Vercel.
var JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32 || JWT_SECRET === 'pharma-mbr-change-this-to-64-char-random-string') {
  throw new Error(
    '[FATAL] JWT_SECRET is missing, shorter than 32 characters, or the default placeholder. ' +
    'Generate one with: node -e "console.log(require(\'crypto\').randomBytes(64).toString(\'hex\'))"'
  );
}

var app = express();

// ── Helmet — HTTP security headers ───────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      upgradeInsecureRequests: isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: isProd ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
}));

// ── CORS — explicit allowlist only ──────────────────────────────────────────
// No wildcard *.vercel.app: that let ANY Vercel-hosted site make credentialed
// requests to this API. Origins come from ALLOWED_ORIGINS (comma-separated)
// and CLIENT_URL.
var devOrigins = ['http://localhost:5173', 'http://localhost:5176', 'http://localhost:3000'];
var configuredOrigins = (process.env.ALLOWED_ORIGINS || '').split(',')
  .concat(process.env.CLIENT_URL || '')
  .map(function(o) { return o.trim().replace(/\/$/, ''); })
  .filter(Boolean);
var allowedOrigins = isProd ? configuredOrigins : configuredOrigins.concat(devOrigins);

if (isProd && allowedOrigins.length === 0) {
  console.warn('[CORS] No ALLOWED_ORIGINS or CLIENT_URL set — all browser requests will be rejected.');
}

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    callback(new Error('CORS: origin not allowed — ' + origin));
  },
  credentials:    true,
  methods:        ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  exposedHeaders: ['Content-Disposition'],
  maxAge:         86400,
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate limiters ────────────────────────────────────────────────────────────
var loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many login attempts — try again in 15 minutes' },
  standardHeaders: true,
  legacyHeaders: false,
});

var apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Rate limit exceeded' },
  standardHeaders: true,
  legacyHeaders: false,
  // Mounted at '/api', so req.path is relative ('/health'). Use originalUrl.
  skip: function(req) { return req.originalUrl.indexOf('/api/health') === 0; },
});

app.use('/api', apiLimiter);

// ── Input validation ─────────────────────────────────────────────────────────
function validate(rules) {
  return async function(req, res, next) {
    await Promise.all(rules.map(function(rule) { return rule.run(req); }));
    var errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        fields: errors.array().map(function(e) { return { field: e.path, message: e.msg }; }),
      });
    }
    next();
  };
}

var loginValidation = validate([
  body('email').isEmail().withMessage('Valid email required').normalizeEmail().trim(),
  body('password')
    .notEmpty().withMessage('Password required')
    .isLength({ max: 200 }).withMessage('Password too long'),
]);

var registerValidation = validate([
  body('email').isEmail().withMessage('Valid email required').normalizeEmail().trim(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters')
    .matches(/[A-Z]/).withMessage('Password must contain an uppercase letter')
    .matches(/[a-z]/).withMessage('Password must contain a lowercase letter')
    .matches(/[0-9]/).withMessage('Password must contain a number')
    .matches(/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/).withMessage('Password must contain a special character'),
  body('full_name')
    .notEmpty().withMessage('full_name required')
    .isLength({ max: 200 }).withMessage('full_name too long')
    .trim()
    .escape(),
  body('role')
    .optional()
    .isIn(['admin', 'designer', 'qa_reviewer', 'production_operator', 'viewer'])
    .withMessage('Invalid role'),
]);

app.locals.validate           = validate;
app.locals.loginValidation    = loginValidation;
app.locals.registerValidation = registerValidation;

app.post('/api/auth/login',    loginValidation);
app.post('/api/auth/register', registerValidation);

// ═══ PUBLIC ENDPOINTS ════════════════════════════════════════════════════════

app.get('/', function(req, res) {
  res.json({
    system:      'PharmaMES.AI',
    description: 'Pharmaceutical Manufacturing Execution System',
    compliance:  ['21 CFR Part 11', 'GAMP5 Cat.5', 'ISA-88', 'ISA-95', 'ICH Q10'],
    version:     '1.0.0',
    api:         '/api',
    health:      '/api/health',
    docs:        'https://github.com/JaisukhBK/pharma-mbr',
  });
});

app.get('/api/health', async function(req, res) {
  var auditCount = await getAuditCount().catch(function() { return '?'; });
  res.json({
    status:       'healthy',
    uptime:       process.uptime(),
    timestamp:    new Date().toISOString(),
    version:      '1.0.0',
    aiEnabled:    !!process.env.GROQ_API_KEY,
    db:           'Neon PostgreSQL',
    auditEntries: auditCount,
    security:     { helmet: true, validated: true },
  });
});

// ═══ ROUTE MOUNTS ════════════════════════════════════════════════════════════

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
app.use('/api/dispensing',           dispensingRoutes);
app.use('/api/env',                  envMonitoringRoutes);
app.use('/api',                      kpiRoutes);

// ═══ AUDIT TRAIL ═════════════════════════════════════════════════════════════

function csvField(value) {
  return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"';
}

app.get('/api/audit', authenticate, authorize('audit:read'), async function(req, res) {
  var p = req.query;
  var data = await queryAudit({
    resource: p.resource, userId: p.userId, action: p.action,
    from: p.from, to: p.to, limit: p.limit,
  });
  res.json(data);
});

app.get('/api/audit/verify', authenticate, authorize('audit:read'), async function(req, res) {
  res.json(await verifyIntegrity());
});

app.get('/api/audit/export', authenticate, authorize('audit:export'), async function(req, res) {
  var data = await queryAudit({ limit: 1000 });
  var csv  = 'Timestamp,User,Action,Resource,ResourceId,Details,Checksum\n';
  data.entries.forEach(function(e) {
    csv += [
      e.timestamp, e.user_name || e.user_id, e.action,
      e.resource, e.resource_id, e.details, e.checksum,
    ].map(csvField).join(',') + '\n';
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition',
    'attachment; filename=audit_trail_' + new Date().toISOString().split('T')[0] + '.csv');
  res.send(csv);
});

// ═══ SYSTEM CONFIG ═══════════════════════════════════════════════════════════

app.get('/api/system/config', authenticate, authorize('config:read'), function(req, res) {
  res.json({
    systemName:          'PharmaMES.AI',
    version:             '1.0.0',
    gamp5Category:       5,
    gamp5Description:    'Custom Application — AI-Integrated MES',
    complianceStandards: ['21 CFR Part 11', 'EU Annex 11', 'GAMP 5', 'ICH Q10'],
    validationStatus:    'IQ/OQ Complete — PQ In Progress',
    environment:         process.env.NODE_ENV || 'development',
    aiEnabled:           !!process.env.GROQ_API_KEY,
    dbBackend:           'Neon PostgreSQL',
    authMode:            'JWT (8h)',
    security: {
      helmet:           true,
      corsLockdown:     isProd,
      inputValidation:  true,
      jwtStrengthCheck: true,
    },
    dataIntegrity: {
      alcoa: true, alcoaPlus: true,
      principles: ['Attributable', 'Legible', 'Contemporaneous', 'Original',
                   'Accurate', 'Complete', 'Consistent', 'Enduring', 'Available'],
    },
    passwordPolicy: {
      minLength: 8, requireUppercase: true, requireLowercase: true,
      requireNumber: true, requireSpecial: true,
      expiryDays: 90, maxFailedAttempts: 5, lockoutMinutes: 30,
    },
    auditTrail:           { enabled: true, immutable: true, integrityChecks: true, algorithm: 'SHA-256', backend: 'Neon' },
    electronicSignatures: { enabled: true, requireReason: true },
  });
});

// ═══ 404 + ERROR HANDLERS ════════════════════════════════════════════════════

app.use(function(req, res) {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

app.use(function(err, req, res, _next) {
  console.error('[server] Unhandled error:', err.message);
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  res.status(err.status || err.statusCode || 500).json({
    error: isProd ? 'Internal server error' : err.message,
  });
});

// ═══ MIGRATIONS (once per cold start) ════════════════════════════════════════
// Resolves true/false and never rejects, so serverless never sees an
// unhandled rejection. index.js awaits this and refuses to start on failure.
app.locals.migrationsReady = runMigrations()
  .then(function() { return true; })
  .catch(function(e) {
    console.error('[FATAL] Migration error:', e.message);
    return false;
  });

module.exports = app;
