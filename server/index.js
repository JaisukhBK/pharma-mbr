// server/index.js
// PharmaMES.AI — GAMP5 Category 5 / 21 CFR Part 11 Compliant MES Server
// Segment 6: Security hardening — Helmet, input sanitization, JWT strength check

require('dotenv').config();

var express    = require('express');
var cors       = require('cors');
var helmet     = require('helmet');
var rateLimit  = require('express-rate-limit');
var { body, validationResult } = require('express-validator');

// ── DB ───────────────────────────────────────────────────────────────────────
var { runMigrations } = require('./db/pool');

// ── Middleware ───────────────────────────────────────────────────────────────
var { authenticate, authorize, logAudit,
      queryAudit, verifyIntegrity, getAuditCount } = require('./middleware/middleware');

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

var app  = express();
var PORT = process.env.PORT || 5000;

// ── JWT_SECRET strength check (21 CFR Part 11 — server refuses weak secrets) ─
var JWT_SECRET = process.env.JWT_SECRET || '';
if (JWT_SECRET.length < 32 || JWT_SECRET === 'pharma-mbr-change-this-to-64-char-random-string') {
  console.error('\n  [FATAL] JWT_SECRET is too weak or is the default placeholder.');
  console.error('  Generate a strong secret: node -e "require(\'crypto\').randomBytes(64).toString(\'hex\')|pbcopy"');
  console.error('  Then set it in your .env file.\n');
  process.exit(1);
}

// ── Helmet — HTTP security headers ───────────────────────────────────────────
// Adds: XSS protection, content-type sniffing prevention, clickjacking protection,
// HSTS, referrer policy, permissions policy
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:  ["'self'"],
      scriptSrc:   ["'self'", "'unsafe-inline'"],   // needed for React dev
      styleSrc:    ["'self'", "'unsafe-inline'"],
      imgSrc:      ["'self'", 'data:', 'blob:'],
      connectSrc:  ["'self'"],
      fontSrc:     ["'self'"],
      objectSrc:   ["'none'"],
      frameSrc:    ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,   // needed for some client tools
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
}));

// ── CORS ─────────────────────────────────────────────────────────────────────
var allowedOrigins = process.env.NODE_ENV === 'production'
  ? [process.env.CLIENT_URL || 'https://pharmames.ai']
  : ['http://localhost:5173', 'http://localhost:5176', 'http://localhost:3000'];

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (curl, Postman, server-to-server)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) return callback(null, true);
    callback(new Error('CORS: origin not allowed — ' + origin));
  },
  credentials:      true,
  methods:          ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders:   ['Content-Type', 'Authorization'],
  exposedHeaders:   ['Content-Disposition'],  // for CSV export
  maxAge:           86400,                     // preflight cache 24h
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Rate limiters ─────────────────────────────────────────────────────────────
var loginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,
  max:              20,
  message:          { error: 'Too many login attempts — try again in 15 minutes' },
  standardHeaders:  true,
  legacyHeaders:    false,
});

var apiLimiter = rateLimit({
  windowMs:         60 * 1000,
  max:              300,
  message:          { error: 'Rate limit exceeded' },
  standardHeaders:  true,
  legacyHeaders:    false,
  skip: function(req) {
    return req.path === '/api/health';
  },
});

app.use('/api', apiLimiter);

// ── Input validation helper ───────────────────────────────────────────────────
// Used by routes that accept user input.
// Returns 400 with field-level errors if validation fails.
function validate(rules) {
  return async function(req, res, next) {
    await Promise.all(rules.map(function(rule) { return rule.run(req); }));
    var errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error:  'Validation failed',
        fields: errors.array().map(function(e) {
          return { field: e.path, message: e.msg };
        }),
      });
    }
    next();
  };
}

// ── Input sanitization rules (reusable) ──────────────────────────────────────
var loginValidation = validate([
  body('email')
    .isEmail().withMessage('Valid email required')
    .normalizeEmail()
    .trim(),
  body('password')
    .notEmpty().withMessage('Password required')
    .isLength({ max: 200 }).withMessage('Password too long'),
]);

var registerValidation = validate([
  body('email')
    .isEmail().withMessage('Valid email required')
    .normalizeEmail()
    .trim(),
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

// ── Make validators available to routes via app.locals ───────────────────────
app.locals.validate          = validate;
app.locals.loginValidation   = loginValidation;
app.locals.registerValidation = registerValidation;

// ── Attach validators to auth routes before mounting ─────────────────────────
// authRoutes uses these via req.app.locals
app.post('/api/auth/login',    loginValidation);
app.post('/api/auth/register', registerValidation);

// ═══ ROUTE MOUNTS ════════════════════════════════════════════════════════════

app.use('/api/auth',                loginLimiter, authRoutes);
app.use('/api/mbr',                 mbrRoutes);
app.use('/api/ebr',                 ebrRoutes);
app.use('/api/equipment',           equipmentRoutes);
app.use('/api/genealogy',           genealogyRoutes);
app.use('/api/devcapa',             devcapaRoutes);
app.use('/api/training',            trainingRoutes);
app.use('/api/change-control',      changeControlRoutes);
app.use('/api/compliance',          complianceRoutes);
app.use('/api/co-designer',         coDesignerRoutes);
app.use('/api/integration-platform', integrationPlatformRoutes);
app.use('/api',                     kpiRoutes);

// ═══ AUDIT TRAIL ENDPOINTS ════════════════════════════════════════════════════

app.get('/api/audit', authenticate, authorize('audit:read'), async function(req, res) {
  var p    = req.query;
  var data = await queryAudit({
    resource: p.resource, userId: p.userId, action: p.action,
    from: p.from, to: p.to, limit: p.limit,
  });
  res.json(data);
});

app.get('/api/audit/verify', authenticate, authorize('audit:read'), async function(req, res) {
  var result = await verifyIntegrity();
  res.json(result);
});

app.get('/api/audit/export', authenticate, authorize('audit:export'), async function(req, res) {
  var data = await queryAudit({ limit: 1000 });
  var csv  = 'Timestamp,User,Action,Resource,ResourceId,Details,Checksum\n';
  data.entries.forEach(function(e) {
    csv += '"' + (e.timestamp     || '') + '","' +
           (e.user_name || e.user_id || '') + '","' +
           (e.action    || '') + '","' +
           (e.resource  || '') + '","' +
           (e.resource_id || '') + '","' +
           (e.details   || '').replace(/"/g, '""') + '","' +
           (e.checksum  || '') + '"\n';
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition',
    'attachment; filename=audit_trail_' + new Date().toISOString().split('T')[0] + '.csv');
  res.send(csv);
});

// ═══ SYSTEM CONFIG ════════════════════════════════════════════════════════════

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
      helmet:          true,
      corsLockdown:    process.env.NODE_ENV === 'production',
      inputValidation: true,
      jwtStrengthCheck: true,
    },
    dataIntegrity: {
      alcoa: true, alcoaPlus: true,
      principles: ['Attributable','Legible','Contemporaneous','Original',
                   'Accurate','Complete','Consistent','Enduring','Available'],
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

// ═══ HEALTH CHECK ════════════════════════════════════════════════════════════

app.get('/api/health', async function(req, res) {
  var auditCount = await getAuditCount().catch(function() { return '?'; });
  res.json({
    status:       'healthy',
    uptime:       process.uptime(),
    timestamp:    new Date().toISOString(),
    aiEnabled:    !!process.env.GROQ_API_KEY,
    version:      '1.0.0',
    db:           'Neon PostgreSQL',
    auditEntries: auditCount,
    security: {
      helmet:    true,
      validated: true,
    },
  });
});

// ═══ 404 + ERROR HANDLERS ════════════════════════════════════════════════════

app.use(function(req, res) {
  res.status(404).json({ error: 'Route not found', path: req.path });
});

// Global error handler — never leak stack traces in production
app.use(function(err, req, res, _next) {
  console.error('[server] Unhandled error:', err.message);
  if (err.message && err.message.startsWith('CORS:')) {
    return res.status(403).json({ error: err.message });
  }
  var statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    error: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
  });
});

// ═══ STARTUP ══════════════════════════════════════════════════════════════════

async function startServer() {
  console.log('');
  console.log('  +=============================================+');
  console.log('  |          PharmaMES.AI Server               |');
  console.log('  |   GAMP5 Cat.5 | 21 CFR Part 11            |');
  console.log('  |   Neon PostgreSQL + JWT + Helmet           |');
  console.log('  +=============================================+');
  console.log('');

  try {
    await runMigrations();

    app.listen(PORT, function() {
      console.log('  -> Running on http://localhost:' + PORT);
      console.log('  -> AI:       ' + (process.env.GROQ_API_KEY ? 'Enabled (Groq/Llama 3.3 70B)' : 'Disabled'));
      console.log('  -> DB:       Neon PostgreSQL');
      console.log('  -> Auth:     JWT · middleware/middleware.js');
      console.log('  -> Security: Helmet + express-validator + CORS');
      console.log('');
    });

    logAudit({
      userId:       'SYSTEM',
      action:       'STARTUP',
      resourceType: 'SYSTEM',
      details:      'PharmaMES.AI server started — Segment 6 security hardening active',
    });

  } catch (err) {
    console.error('\n  [FATAL] Server startup failed:', err.message);
    process.exit(1);
  }
}

startServer();
