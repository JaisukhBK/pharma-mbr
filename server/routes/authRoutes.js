// server/routes/authRoutes.js — Auth endpoints (fixed for M-001 schema)
const { Router } = require('express');
const { login, registerUser, authenticate, authorize, verifyPasswordForSignature, logAudit } = require('../middleware/middleware');
const { query } = require('../db/pool');

const router = Router();

// Login
router.post('/login', async (req, res) => {
  try {
    const result = await login(req.body.email, req.body.password);
    if (result.error) return res.status(result.status || 401).json({ error: result.error });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Login failed' }); }
});

// Register
router.post('/register', authenticate, authorize('admin:write'), async (req, res) => {
  try {
    const { email, password, full_name, group_id, title } = req.body;
    if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password, and full_name required' });
    const user = await registerUser({ email, password, full_name, group_id: group_id || 'viewer', title });
    res.status(201).json(user);
  } catch (err) { res.status(err.status || 500).json({ error: err.message || 'Registration failed' }); }
});

// Get current user profile
router.get('/me', authenticate, async (req, res) => {
  try {
    const r = await query('SELECT id, email, full_name, group_id, title, status, training_status, last_login, created_at FROM users WHERE id=$1', [req.session.userId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Verify password (for Co-Designer auth, independent of MBR)
router.post('/verify-password', authenticate, async (req, res) => {
  try {
    if (!req.body.password) return res.status(400).json({ error: 'Password required' });
    const valid = await verifyPasswordForSignature(req.session.userId, req.body.password);
    if (!valid) return res.status(401).json({ error: 'Password verification failed' });
    res.json({ verified: true });
  } catch (err) { res.status(500).json({ error: 'Verification failed' }); }
});

// List all users (admin)
router.get('/users', authenticate, authorize('admin:write'), async (req, res) => {
  try {
    const r = await query('SELECT id, email, full_name, group_id, title, status, training_status, last_login, created_at FROM users ORDER BY full_name');
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Update user (admin)
router.put('/users/:id', authenticate, authorize('admin:write'), async (req, res) => {
  try {
    const { full_name, group_id, title, status } = req.body;
    const r = await query(
      'UPDATE users SET full_name=COALESCE($1,full_name), group_id=COALESCE($2,group_id), title=COALESCE($3,title), status=COALESCE($4,status), updated_at=NOW() WHERE id=$5 RETURNING id, email, full_name, group_id, title, status',
      [full_name, group_id, title, status, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Update failed' }); }
});

module.exports = router;
