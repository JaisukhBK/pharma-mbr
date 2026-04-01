// server/middleware/middleware.js
// PharmaMES.AI — JWT + RBAC + Part 11 lockout + Immutable audit log
// 21 CFR Part 11 §11.10(d) (access controls) + §11.10(e) (audit trail)
//
// Auth identity model:
//   email    — unique login qualifier (no two users share an email)
//   username — display name only (two people CAN share "j.smith" across sites)
//   failed_attempts + locked_until — account lockout per §11.10(d)
//   status   — 'Active' | 'Inactive' | 'Locked' — admin-controlled account state

const jwt    = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const { query } = require('../db/pool');

// ════════════════════════════════════════════════════════════════════════
// AUDIT TRAIL (Part 11 §11.10(e) — append-only, SHA-256 chained)
// ════════════════════════════════════════════════════════════════════════

// In-memory last checksum — loaded from DB on first write if DB is ahead
let _lastChecksum = 'GENESIS';
let _checksumLoaded = false;

async function _ensureChecksum() {
  if (_checksumLoaded) return;
  try {
    const r = await query('SELECT checksum FROM audit_trail ORDER BY sequence_number DESC LIMIT 1');
    if (r.rows.length) _lastChecksum = r.rows[0].checksum;
    _checksumLoaded = true;
  } catch (_) {
    _checksumLoaded = true; // DB not ready yet — will retry on next call
  }
}

async function logAudit({
  userId,         // UUID of the acting user (or 'SYSTEM')
  userEmail,      // email of the acting user — stored for human-readable trail
  userName,       // full_name — optional, for readability
  action,         // LOGIN | LOGOUT | CREATE | UPDATE | DELETE | SIGN | ACCESS_DENIED | ...
  resourceType,   // AUTH | MBR | EBR | EQUIPMENT | DEVIATION | CAPA | USER | ...
  resourceId,     // UUID or code of the affected record
  details,        // human-readable summary
  oldValue,       // object — previous state (for UPDATE/DELETE)
  newValue,       // object — new state (for CREATE/UPDATE)
  changeReason,   // 21 CFR Part 11: reason for change
  ipAddress,
  userAgent,
  aiGenerated = false,
} = {}) {
  await _ensureChecksum();

  const entry = {
    id:               crypto.randomUUID(),
    timestamp:        new Date().toISOString(),
    userId:           userId   || 'SYSTEM',
    userEmail:        userEmail || null,
    userName:         userName  || null,
    action:           action,
    resourceType:     resourceType,
    resourceId:       resourceId  || null,
    details:          details     || null,
    oldValue:         oldValue    ? JSON.stringify(oldValue)  : null,
    newValue:         newValue    ? JSON.stringify(newValue)  : null,
    changeReason:     changeReason || null,
    ipAddress:        ipAddress   || null,
    userAgent:        userAgent   || null,
    aiGenerated:      aiGenerated,
    previousChecksum: _lastChecksum,
    checksum:         null,
  };

  // SHA-256 chained integrity — each entry hashes itself + previous checksum
  entry.checksum = crypto
    .createHash('sha256')
    .update(JSON.stringify({ ...entry, checksum: undefined }))
    .digest('hex');

  _lastChecksum = entry.checksum;

  try {
    await query(
      `INSERT INTO audit_trail
         (user_id, user_name, action, resource, resource_id,
          details, old_value, new_value, reason,
          ip_address, previous_checksum, checksum)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        // Store "email (username)" as user_name for full traceability in the trail
        entry.userId,
        entry.userEmail
          ? (entry.userEmail + (entry.userName ? ' (' + entry.userName + ')' : ''))
          : (entry.userName || null),
        entry.action,
        entry.resourceType,
        entry.resourceId,
        entry.details,
        entry.oldValue,
        entry.newValue,
        entry.changeReason,
        entry.ipAddress,
        entry.previousChecksum,
        entry.checksum,
      ]
    );
  } catch (err) {
    // Never crash the request because of an audit write failure — but always log it
    console.error('[AUDIT] Write failed:', err.message,
      { action, resourceType, resourceId, userId, userEmail });
  }

  return entry;
}

// Convenience middleware — attaches req.audit() to every request
function auditMiddleware(req, res, next) {
  req.audit = (params) => logAudit({
    userId:    req.session?.userId,
    userEmail: req.session?.email,
    userName:  req.session?.fullName,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    ...params,
  });
  next();
}

// ════════════════════════════════════════════════════════════════════════
// ROLE-BASED PERMISSIONS
// group_id in the users table → permission list in the JWT
// ════════════════════════════════════════════════════════════════════════

const PERMS = {
  'GRP-ADMIN': ['*'],   // wildcard — all permissions
  'GRP-QA': [
    'mbr:read', 'mbr:approve', 'mbr:sign',
    'ebr:read', 'ebr:verify',
    'deviation:read', 'deviation:write', 'deviation:approve',
    'capa:read', 'capa:write', 'capa:approve',
    'audit:read', 'audit:export',
    'user:read', 'co_designer:review',
    'config:read', 'report:read', 'report:generate',
  ],
  'GRP-ENG': [
    'mbr:read',
    'ebr:read',
    'equipment:read', 'equipment:write', 'equipment:calibrate', 'equipment:maintain',
    'integration:read', 'integration:configure',
    'audit:read', 'config:read', 'report:read',
  ],
  'GRP-PROD': [
    'mbr:read',
    'ebr:read', 'ebr:execute',
    'equipment:read',
    'audit:read', 'config:read',
  ],
  // Legacy role names (kept for backward compat with older routes)
  'admin':               ['*'],
  'designer':            ['mbr:read','mbr:write','mbr:sign','ebr:read','audit:read','co_designer:toggle','co_designer:review','config:read'],
  'qa_reviewer':         ['mbr:read','mbr:approve','mbr:sign','ebr:read','ebr:verify','audit:read','co_designer:review','config:read'],
  'production_operator': ['mbr:read','ebr:read','ebr:execute','audit:read','config:read'],
  'viewer':              ['mbr:read','ebr:read','audit:read','config:read'],
};

// ════════════════════════════════════════════════════════════════════════
// JWT HELPERS
// ════════════════════════════════════════════════════════════════════════

const SECRET      = process.env.JWT_SECRET;
const TOKEN_TTL   = process.env.ACCESS_TOKEN_TTL_MIN
  ? parseInt(process.env.ACCESS_TOKEN_TTL_MIN) + 'm'
  : '8h';

if (!SECRET) {
  throw new Error('[middleware] JWT_SECRET is not set. Server cannot start.');
}

function generateToken(user) {
  // group_id takes priority; fall back to legacy role field
  const groupKey = user.group_id || user.role || 'viewer';
  let permissions = PERMS[groupKey] || [];

  return jwt.sign(
    {
      userId:      user.id,
      email:       user.email,        // unique auth identity
      username:    user.username,     // display name
      fullName:    user.full_name,
      groupId:     groupKey,
      role:        groupKey,          // kept for legacy route compatibility
      permissions: permissions,
    },
    SECRET,
    { expiresIn: TOKEN_TTL }
  );
}

// ════════════════════════════════════════════════════════════════════════
// AUTHENTICATE MIDDLEWARE
// Validates JWT; populates req.session with decoded payload
// ════════════════════════════════════════════════════════════════════════

async function authenticate(req, res, next) {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required', code: 'AUTH_REQUIRED' });
  }

  try {
    const payload = jwt.verify(h.split(' ')[1], SECRET);

    req.session = {
      userId:      payload.userId,
      email:       payload.email,       // unique identifier
      username:    payload.username,    // display name
      fullName:    payload.fullName,
      groupId:     payload.groupId,
      role:        payload.role,
      permissions: payload.permissions || [],
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired — please log in again', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token', code: 'TOKEN_INVALID' });
  }
}

// ════════════════════════════════════════════════════════════════════════
// AUTHORIZE MIDDLEWARE
// Checks that the JWT payload contains ALL required permissions
// ════════════════════════════════════════════════════════════════════════

function authorize(...requiredPerms) {
  return (req, res, next) => {
    if (!req.session) {
      return res.status(401).json({ error: 'Not authenticated', code: 'AUTH_REQUIRED' });
    }

    // Admin wildcard — always passes
    if (req.session.permissions.includes('*')) return next();

    const missing = requiredPerms.filter(p => !req.session.permissions.includes(p));

    if (missing.length) {
      logAudit({
        userId:       req.session.userId,
        userEmail:    req.session.email,
        userName:     req.session.fullName,
        action:       'ACCESS_DENIED',
        resourceType: 'AUTH',
        details:      'Missing permissions: ' + missing.join(', '),
        ipAddress:    req.ip,
      }).catch(() => {});

      return res.status(403).json({
        error:    'Insufficient permissions',
        required: requiredPerms,
        missing:  missing,
        role:     req.session.role,
        code:     'FORBIDDEN',
      });
    }

    next();
  };
}

// ════════════════════════════════════════════════════════════════════════
// LOGIN
// Looks up by email (unique) — includes username + status + failed_attempts
// ════════════════════════════════════════════════════════════════════════

const MAX_ATTEMPTS  = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_MIN   = parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES)   || 30;

async function login(email, password) {
  // Fetch by email — the unique qualifier
  const r = await query(
    `SELECT id, email, username, password_hash, full_name, title,
            group_id, status, failed_attempts, locked_until,
            last_login, password_expires_at, training_status
     FROM users
     WHERE email = $1`,
    [email.toLowerCase().trim()]
  );

  if (r.rows.length === 0) {
    // Don't reveal whether the email exists
    return { error: 'Invalid credentials', status: 401 };
  }

  const u = r.rows[0];

  // ── Account locked? ───────────────────────────────────────────────────
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    const mins = Math.ceil((new Date(u.locked_until) - Date.now()) / 60000);
    return {
      error:  `Account locked. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`,
      status: 423,
      lockedUntil: u.locked_until,
    };
  }

  // ── Account active? ───────────────────────────────────────────────────
  if (u.status !== 'Active') {
    return { error: 'Account is ' + u.status.toLowerCase() + '. Contact your administrator.', status: 403 };
  }

  // ── Password check ────────────────────────────────────────────────────
  const valid = await bcrypt.compare(password, u.password_hash);

  if (!valid) {
    const attempts = (u.failed_attempts || 0) + 1;
    const willLock = attempts >= MAX_ATTEMPTS;
    const lockedUntil = willLock
      ? new Date(Date.now() + LOCKOUT_MIN * 60000).toISOString()
      : null;

    await query(
      `UPDATE users
       SET failed_attempts = $1,
           locked_until    = $2,
           status          = CASE WHEN $3 THEN 'Locked' ELSE status END,
           updated_at      = NOW()
       WHERE id = $4`,
      [attempts, lockedUntil, willLock, u.id]
    );

    if (willLock) {
      return {
        error:  `Account locked after ${MAX_ATTEMPTS} failed attempts. Try again in ${LOCKOUT_MIN} minutes.`,
        status: 423,
      };
    }

    return {
      error:             'Invalid credentials',
      status:            401,
      attemptsRemaining: MAX_ATTEMPTS - attempts,
    };
  }

  // ── Success ───────────────────────────────────────────────────────────
  await query(
    `UPDATE users
     SET failed_attempts = 0,
         locked_until    = NULL,
         status          = CASE WHEN status = 'Locked' THEN 'Active' ELSE status END,
         last_login      = NOW(),
         updated_at      = NOW()
     WHERE id = $1`,
    [u.id]
  );

  const token = generateToken(u);

  // Password expiry warning
  let passwordExpiryWarning = null;
  if (u.password_expires_at) {
    const daysLeft = Math.ceil((new Date(u.password_expires_at) - Date.now()) / 86400000);
    if (daysLeft <= 14) {
      passwordExpiryWarning = `Password expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}`;
    }
  }

  const groupKey = u.group_id || 'viewer';

  return {
    token,
    user: {
      id:                   u.id,
      email:                u.email,       // unique auth identity
      username:             u.username,    // display name
      full_name:            u.full_name,
      title:                u.title,
      group_id:             groupKey,
      role:                 groupKey,      // legacy compat
      training_status:      u.training_status,
      permissions:          PERMS[groupKey] || [],
      passwordExpiryWarning,
    },
  };
}

// ════════════════════════════════════════════════════════════════════════
// REGISTER USER
// email must be unique; username is display-only (not enforced unique)
// ════════════════════════════════════════════════════════════════════════

async function registerUser({ email, username, password, full_name, title, group_id, role, department, employee_id }) {
  const hash     = await bcrypt.hash(password, 12);
  const groupKey = group_id || role || 'viewer';
  const expiry   = new Date(Date.now() + 90 * 86400000).toISOString();

  const r = await query(
    `INSERT INTO users
       (email, username, password_hash, full_name, title, group_id,
        password_expires_at, must_change_password, status, training_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, TRUE, 'Active', 'Pending')
     RETURNING id, email, username, full_name, title, group_id, status, created_at`,
    [
      email.toLowerCase().trim(),
      username || email.split('@')[0],   // default username to email prefix if not provided
      hash,
      full_name,
      title     || null,
      groupKey,
      expiry,
    ]
  );

  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════════════
// VERIFY PASSWORD FOR E-SIGNATURE (21 CFR Part 11 §11.200(a)(2))
// Re-authenticates by userId — email is already known from the session
// ════════════════════════════════════════════════════════════════════════

async function verifyPasswordForSignature(userId, password) {
  const r = await query(
    `SELECT password_hash FROM users WHERE id = $1 AND status = 'Active'`,
    [userId]
  );
  if (r.rows.length === 0) return false;
  return bcrypt.compare(password, r.rows[0].password_hash);
}

// ════════════════════════════════════════════════════════════════════════
// AUDIT QUERY HELPERS (used by index.js audit endpoints)
// ════════════════════════════════════════════════════════════════════════

async function queryAudit({ resource, userId, action, from, to, limit = 100 } = {}) {
  let sql    = 'SELECT * FROM audit_trail WHERE 1=1';
  const vals = [];
  let   n    = 1;

  if (resource) { sql += ` AND resource = $${n++}`;   vals.push(resource); }
  if (userId)   { sql += ` AND user_id  = $${n++}`;   vals.push(userId);   }
  if (action)   { sql += ` AND action   = $${n++}`;   vals.push(action);   }
  if (from)     { sql += ` AND timestamp >= $${n++}`;  vals.push(from);     }
  if (to)       { sql += ` AND timestamp <= $${n++}`;  vals.push(to);       }

  sql += ` ORDER BY sequence_number DESC LIMIT $${n}`;
  vals.push(Math.min(parseInt(limit) || 100, 1000));

  try {
    const result = await query(sql, vals);
    return { total: result.rowCount, entries: result.rows };
  } catch (err) {
    console.error('[AUDIT] queryAudit error:', err.message);
    return { total: 0, entries: [] };
  }
}

async function verifyIntegrity() {
  const crypto = require('crypto');
  try {
    const result = await query(
      'SELECT * FROM audit_trail ORDER BY sequence_number ASC'
    );
    const rows = result.rows;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const inputObj = {
        id:               row.id,
        timestamp:        row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
        userId:           row.user_id,
        userName:         row.user_name   || null,
        action:           row.action,
        resource:         row.resource,
        resourceId:       row.resource_id || null,
        details:          row.details     || null,
        oldValue:         row.old_value   || null,
        newValue:         row.new_value   || null,
        ipAddress:        row.ip_address  || null,
        reason:           row.reason      || null,
        previousChecksum: row.previous_checksum,
        checksum:         undefined,
      };
      const expected = crypto.createHash('sha256')
        .update(JSON.stringify(inputObj)).digest('hex');
      if (row.checksum !== expected) {
        return { valid: false, failedAt: i, entryId: row.id, reason: 'Checksum mismatch', sequence: row.sequence_number };
      }
      if (i > 0 && row.previous_checksum !== rows[i - 1].checksum) {
        return { valid: false, failedAt: i, entryId: row.id, reason: 'Chain broken', sequence: row.sequence_number };
      }
    }
    return { valid: true, totalEntries: rows.length };
  } catch (err) {
    return { valid: false, error: err.message };
  }
}

async function getAuditCount() {
  try {
    const r = await query('SELECT COUNT(*) FROM audit_trail');
    return parseInt(r.rows[0].count);
  } catch (_) { return 0; }
}

module.exports = {
  // Audit
  logAudit,
  auditMiddleware,
  queryAudit,
  verifyIntegrity,
  getAuditCount,
  // Auth
  authenticate,
  authorize,
  generateToken,
  // User operations
  login,
  registerUser,
  verifyPasswordForSignature,
  // Permission map (exported for tests and seeding)
  PERMS,
};
