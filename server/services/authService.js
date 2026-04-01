// ============================================================================
// PharmaMES.AI — JWT Authentication Service
// server/services/authService.js
//
// Replaces the in-memory sessions Map in middleware/auth.js.
// - Access tokens: JWT, 15 min expiry (configurable via env)
// - Refresh tokens: opaque UUID stored hashed in Neon refresh_tokens table
// - bcrypt password hashing + verification
// - Account lockout (5 failed attempts → 30 min lock)
// - 21 CFR Part 11 §11.10(g) — automatic session timeout enforced via JWT exp
// ============================================================================

'use strict';

const crypto  = require('crypto');
const bcrypt  = require('bcrypt');
const jwt     = require('jsonwebtoken');
const { query, transaction } = require('../db/pool');

const BCRYPT_ROUNDS        = 12;
const ACCESS_TOKEN_TTL     = process.env.ACCESS_TOKEN_TTL_MIN  ? parseInt(process.env.ACCESS_TOKEN_TTL_MIN) * 60  : 15 * 60;  // seconds
const REFRESH_TOKEN_TTL    = process.env.REFRESH_TOKEN_TTL_DAYS ? parseInt(process.env.REFRESH_TOKEN_TTL_DAYS) * 86400 : 7 * 86400; // seconds
const MAX_FAILED_ATTEMPTS  = parseInt(process.env.MAX_FAILED_LOGIN_ATTEMPTS) || 5;
const LOCKOUT_MINUTES      = parseInt(process.env.ACCOUNT_LOCKOUT_MINUTES)   || 30;
const JWT_SECRET           = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error('[authService] JWT_SECRET is not set in environment. Cannot start server.');
}

// ── Group permission map ─────────────────────────────────────────────────────
// Mirrors users.js groups. Single source of truth is the DB group_id field.
const GROUP_PERMISSIONS = {
  'GRP-PROD': [
    'batch:read', 'batch:execute', 'batch:comment',
    'equipment:read', 'equipment:operate',
    'quality:read', 'dashboard:read',
  ],
  'GRP-QA': [
    'batch:read', 'batch:review', 'batch:approve', 'batch:reject', 'batch:comment',
    'equipment:read',
    'quality:read', 'quality:write', 'quality:approve',
    'deviation:read', 'deviation:write', 'deviation:approve',
    'capa:read', 'capa:write', 'capa:approve',
    'dashboard:read', 'report:read', 'report:generate',
    'audit:read', 'audit:export', 'esignature:sign', 'config:read',
  ],
  'GRP-ENG': [
    'batch:read',
    'equipment:read', 'equipment:write', 'equipment:calibrate', 'equipment:maintain',
    'quality:read',
    'integration:read', 'integration:configure',
    'dashboard:read', 'report:read', 'report:generate', 'config:read',
  ],
  'GRP-ADMIN': ['*'],
};

// ── Password hashing ─────────────────────────────────────────────────────────
async function hashPassword(plainText) {
  return bcrypt.hash(plainText, BCRYPT_ROUNDS);
}

async function verifyPassword(plainText, hash) {
  return bcrypt.compare(plainText, hash);
}

// ── JWT helpers ──────────────────────────────────────────────────────────────
function issueAccessToken(user) {
  const permissions = GROUP_PERMISSIONS[user.group_id] || [];
  return jwt.sign(
    {
      sub:         user.id,
      username:    user.username,
      full_name:   user.full_name,
      group_id:    user.group_id,
      permissions: permissions,
    },
    JWT_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function verifyAccessToken(token) {
  // Returns decoded payload or throws
  return jwt.verify(token, JWT_SECRET);
}

// ── Refresh token helpers ────────────────────────────────────────────────────
function sha256(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

async function issueRefreshToken(userId, ipAddress, userAgent) {
  const rawToken  = crypto.randomUUID() + crypto.randomUUID(); // 72 hex chars
  const tokenHash = sha256(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL * 1000).toISOString();

  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, ip_address, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, tokenHash, expiresAt, ipAddress || null, userAgent || null]
  );

  return rawToken; // Return raw — caller sends to client
}

async function consumeRefreshToken(rawToken, ipAddress) {
  const tokenHash = sha256(rawToken);

  const result = await query(
    `SELECT rt.*, u.id as uid, u.username, u.full_name, u.group_id, u.status,
            u.must_change_password, u.password_expires_at
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()`,
    [tokenHash]
  );

  if (!result.rows.length) {
    return { error: 'Invalid or expired refresh token' };
  }

  const row = result.rows[0];

  if (row.status !== 'Active') {
    return { error: 'Account deactivated' };
  }

  // Revoke used token (rotation — single-use)
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1`,
    [tokenHash]
  );

  // Issue new pair
  const accessToken  = issueAccessToken(row);
  const refreshToken = await issueRefreshToken(row.uid, ipAddress);

  return {
    accessToken,
    refreshToken,
    user: {
      id:                  row.uid,
      username:            row.username,
      full_name:           row.full_name,
      group_id:            row.group_id,
      must_change_password: row.must_change_password,
      password_expires_at: row.password_expires_at,
    },
  };
}

async function revokeAllRefreshTokens(userId) {
  await query(
    `UPDATE refresh_tokens SET revoked_at = NOW()
     WHERE user_id = $1 AND revoked_at IS NULL`,
    [userId]
  );
}

// ── Login ────────────────────────────────────────────────────────────────────
async function login(username, password, ipAddress, userAgent) {
  const result = await query(
    `SELECT id, username, password_hash, full_name, title, email, group_id,
            status, must_change_password, failed_attempts, locked_until,
            last_login, password_expires_at, session_timeout_min, training_status
     FROM users WHERE username = $1`,
    [username]
  );

  if (!result.rows.length) {
    return { error: 'Invalid credentials', code: 'AUTH_FAILED' };
  }

  const user = result.rows[0];

  // Account locked?
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    const remaining = Math.ceil((new Date(user.locked_until) - Date.now()) / 60000);
    return { error: 'Account locked', code: 'ACCOUNT_LOCKED', minutesRemaining: remaining };
  }

  // Account active?
  if (user.status !== 'Active') {
    return { error: 'Account deactivated', code: 'ACCOUNT_INACTIVE' };
  }

  // Verify password
  const passwordOk = await verifyPassword(password, user.password_hash);

  if (!passwordOk) {
    const newAttempts = (user.failed_attempts || 0) + 1;
    let lockedUntil = null;

    if (newAttempts >= MAX_FAILED_ATTEMPTS) {
      lockedUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString();
    }

    await query(
      `UPDATE users SET failed_attempts = $1, locked_until = $2, updated_at = NOW()
       WHERE id = $3`,
      [newAttempts, lockedUntil, user.id]
    );

    return {
      error: 'Invalid credentials',
      code: 'AUTH_FAILED',
      attemptsRemaining: Math.max(0, MAX_FAILED_ATTEMPTS - newAttempts),
    };
  }

  // Success — reset lockout
  await query(
    `UPDATE users SET failed_attempts = 0, locked_until = NULL,
                      last_login = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [user.id]
  );

  const accessToken  = issueAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id, ipAddress, userAgent);

  const permissions = GROUP_PERMISSIONS[user.group_id] || [];

  // Password expiry warning
  let passwordExpiryWarning = null;
  if (user.password_expires_at) {
    const daysLeft = Math.ceil((new Date(user.password_expires_at) - Date.now()) / 86400000);
    if (daysLeft <= 14) {
      passwordExpiryWarning = 'Password expires in ' + daysLeft + ' days';
    }
  }

  return {
    accessToken,
    refreshToken,
    user: {
      id:                    user.id,
      username:              user.username,
      full_name:             user.full_name,
      title:                 user.title,
      email:                 user.email,
      group_id:              user.group_id,
      permissions:           permissions,
      must_change_password:  user.must_change_password,
      training_status:       user.training_status,
      password_expires_at:   user.password_expires_at,
      passwordExpiryWarning: passwordExpiryWarning,
    },
  };
}

// ── Change password ──────────────────────────────────────────────────────────
async function changePassword(userId, currentPassword, newPassword) {
  const result = await query(
    `SELECT password_hash FROM users WHERE id = $1`,
    [userId]
  );

  if (!result.rows.length) return { error: 'User not found' };

  const ok = await verifyPassword(currentPassword, result.rows[0].password_hash);
  if (!ok) return { error: 'Current password incorrect' };

  // Basic complexity check
  const complexityErrors = validatePasswordComplexity(newPassword);
  if (complexityErrors.length) return { error: complexityErrors.join('. ') };

  const newHash = await hashPassword(newPassword);
  const expiresAt = new Date(Date.now() + 90 * 86400000).toISOString(); // 90 days

  await query(
    `UPDATE users
     SET password_hash = $1, password_expires_at = $2,
         must_change_password = FALSE, updated_at = NOW()
     WHERE id = $3`,
    [newHash, expiresAt, userId]
  );

  // Revoke all refresh tokens — force re-login
  await revokeAllRefreshTokens(userId);

  return { success: true };
}

// ── Password complexity ───────────────────────────────────────────────────────
function validatePasswordComplexity(password) {
  const errors = [];
  if (!password || password.length < 8)          errors.push('Minimum 8 characters');
  if (!/[A-Z]/.test(password))                   errors.push('At least one uppercase letter');
  if (!/[a-z]/.test(password))                   errors.push('At least one lowercase letter');
  if (!/[0-9]/.test(password))                   errors.push('At least one number');
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) errors.push('At least one special character');
  return errors;
}

// ── Seed default admin user (idempotent) ─────────────────────────────────────
// Creates the admin user if no users exist.
// Call this from pool.runMigrations() aftermath in index.js.
async function seedDefaultUsers() {
  const countResult = await query('SELECT COUNT(*) FROM users');
  if (parseInt(countResult.rows[0].count) > 0) return; // Already seeded

  console.log('  -> Seeding default users...');

  const defaultUsers = [
    { username:'admin',          password:'Admin@123!',  full_name:'System Administrator', title:'System Administrator', email:'admin@pharmames.ai',         group_id:'GRP-ADMIN', must_change:false, training:'Current' },
    { username:'qa.singh',       password:'QaSingh@1!',  full_name:'Priya Singh',          title:'QA Manager',           email:'priya.singh@pharmames.ai',    group_id:'GRP-QA',    must_change:true,  training:'Current' },
    { username:'prod.kumar',     password:'ProdKumar1!', full_name:'Rajesh Kumar',         title:'Production Supervisor',email:'rajesh.kumar@pharmames.ai',   group_id:'GRP-PROD',  must_change:true,  training:'Current' },
    { username:'eng.chen',       password:'EngChen@1!',  full_name:'Wei Chen',             title:'Senior Systems Eng',   email:'wei.chen@pharmames.ai',       group_id:'GRP-ENG',   must_change:true,  training:'Current' },
    { username:'qa.williams',    password:'QaWill@1!',   full_name:'Sarah Williams',       title:'QA Analyst',           email:'sarah.williams@pharmames.ai', group_id:'GRP-QA',    must_change:true,  training:'Current' },
    { username:'prod.martinez',  password:'ProdMart1!',  full_name:'Carlos Martinez',      title:'Production Operator',  email:'carlos.martinez@pharmames.ai',group_id:'GRP-PROD',  must_change:true,  training:'Pending' },
  ];

  for (const u of defaultUsers) {
    const hash    = await hashPassword(u.password);
    const expiry  = new Date(Date.now() + 90 * 86400000).toISOString();
    await query(
      `INSERT INTO users (username, password_hash, full_name, title, email, group_id,
                          must_change_password, training_status, password_expires_at, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Active')
       ON CONFLICT (username) DO NOTHING`,
      [u.username, hash, u.full_name, u.title, u.email, u.group_id, u.must_change, u.training, expiry]
    );
    console.log('     ✓ user: ' + u.username);
  }
  console.log('  -> Default users seeded.\n');
}

module.exports = {
  hashPassword, verifyPassword,
  issueAccessToken, verifyAccessToken,
  issueRefreshToken, consumeRefreshToken, revokeAllRefreshTokens,
  login, changePassword, validatePasswordComplexity, seedDefaultUsers,
  GROUP_PERMISSIONS,
};
