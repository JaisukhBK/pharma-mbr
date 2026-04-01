// server/routes/authRoutes.js
const { Router } = require('express');
const { login, registerUser, authenticate, authorize, verifyPasswordForSignature, logAudit } = require('../middleware/middleware');
const { query } = require('../db/pool');
const router = Router();

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const result = await login(email, password);
    if (result.error) {
      await logAudit({ userEmail: email, action: 'LOGIN', resourceType: 'AUTH', details: `Failed: ${result.error}`, ipAddress: req.ip });
      return res.status(result.status).json({ error: result.error });
    }
    await logAudit({ userId: result.user.id, userEmail: email, action: 'LOGIN', resourceType: 'AUTH', details: `Login: ${result.user.full_name}`, ipAddress: req.ip });
    res.json(result);
  } catch (err) { console.error('[AUTH] Login error:', err); res.status(500).json({ error: 'Login failed: ' + err.message }); }
});

router.post('/register', authenticate, authorize('user:write'), async (req, res) => {
  try {
    const { email, password, full_name, role, department, employee_id } = req.body;
    if (!email || !password || !full_name) return res.status(400).json({ error: 'email, password, full_name required' });
    const user = await registerUser({ email, password, full_name, role, department, employee_id });
    res.status(201).json(user);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Registration failed' });
  }
});

router.get('/me', authenticate, async (req, res) => {
  try {
    const r = await query(
      `SELECT id, email, full_name,
              group_id as role,
              title as department,
              username as employee_id,
              last_login as last_login_at,
              created_at
       FROM users WHERE id=$1`,
      [req.session.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ...r.rows[0], permissions: req.session.permissions });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/verify-password', authenticate, async (req, res) => {
  try {
    if (!req.body.password) return res.status(400).json({ error: 'Password required' });
    const valid = await verifyPasswordForSignature(req.session.userId, req.body.password);
    if (!valid) return res.status(401).json({ error: 'Password verification failed' });
    res.json({ verified: true, user_id: req.session.userId, email: req.session.email });
  } catch (err) { res.status(500).json({ error: 'Verification failed' }); }
});

router.get('/users', authenticate, authorize('user:read'), async (req, res) => {
  try {
    const r = await query(
      `SELECT id, email, full_name,
              group_id as role,
              title as department,
              username as employee_id,
              (status = 'Active') as is_active,
              last_login as last_login_at,
              created_at
       FROM users ORDER BY full_name`
    );
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
