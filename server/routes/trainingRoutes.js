// server/routes/trainingRoutes.js — Training Management API
// 21 CFR Part 11 §11.10(i) | GAMP5 §7

const { Router } = require('express');
const { query } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const {
  getRequiredCurricula, getTrainingStatus, isTrainingComplete,
  assignTraining, completeTraining,
  getExpiringTraining, expireOverdueTraining, getTrainingMatrix,
} = require('../services/trainingService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ════════════════════════════════════════════════════════════════
// CURRICULA — course management (admin only for write)
// ════════════════════════════════════════════════════════════════

// List all active curricula
router.get('/curricula', async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM training_curricula WHERE is_active=true ORDER BY course_code'
    );
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to list curricula' }); }
});

// Create curriculum (admin only)
router.post('/curricula', authorize('config:write'), async (req, res) => {
  try {
    const { course_code, course_name, description, required_for_roles, validity_months } = req.body;
    if (!course_code || !course_name) return res.status(400).json({ error: 'course_code and course_name required' });

    const r = await query(
      `INSERT INTO training_curricula (course_code, course_name, description, required_for_roles, validity_months, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [course_code, course_name, description, required_for_roles || [], validity_months || 12, req.session.userId]
    );
    await req.audit({ action: 'CREATE', resourceType: 'TRAINING_CURRICULUM', resourceId: r.rows[0].id, details: `Created course: ${course_code}` });
    res.status(201).json(r.rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Course code already exists' });
    res.status(500).json({ error: 'Failed to create curriculum' });
  }
});

// Update curriculum (admin only)
router.put('/curricula/:id', authorize('config:write'), async (req, res) => {
  try {
    const { course_name, description, required_for_roles, validity_months, is_active } = req.body;
    const r = await query(
      `UPDATE training_curricula SET
       course_name=COALESCE($1,course_name), description=COALESCE($2,description),
       required_for_roles=COALESCE($3,required_for_roles), validity_months=COALESCE($4,validity_months),
       is_active=COALESCE($5,is_active), updated_at=NOW()
       WHERE id=$6 RETURNING *`,
      [course_name, description, required_for_roles, validity_months, is_active, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Curriculum not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'TRAINING_CURRICULUM', resourceId: req.params.id, details: `Updated course: ${r.rows[0].course_code}` });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed to update curriculum' }); }
});

// ════════════════════════════════════════════════════════════════
// MY TRAINING STATUS — current user's compliance view
// ════════════════════════════════════════════════════════════════

// Get current user's training status
router.get('/my-status', async (req, res) => {
  try {
    const status = await getTrainingStatus(req.session.userId, req.session.role);
    const compliance = await isTrainingComplete(req.session.userId, req.session.role);
    res.json({ ...compliance, details: status });
  } catch (err) { res.status(500).json({ error: 'Failed to get training status' }); }
});

// ════════════════════════════════════════════════════════════════
// TRAINING RECORDS — assignment and completion
// ════════════════════════════════════════════════════════════════

// List training records (filterable)
router.get('/records', async (req, res) => {
  try {
    const { user_id, status, curriculum_id } = req.query;
    let sql = `SELECT tr.*, tc.course_code, tc.course_name, u.full_name as user_name, u.email as user_email, ab.full_name as assigned_by_name
               FROM training_records tr
               JOIN training_curricula tc ON tr.curriculum_id=tc.id
               JOIN users u ON tr.user_id=u.id
               LEFT JOIN users ab ON tr.assigned_by=ab.id
               WHERE 1=1`;
    const params = [];
    let i = 1;
    if (user_id) { sql += ` AND tr.user_id=$${i++}`; params.push(user_id); }
    if (status) { sql += ` AND tr.status=$${i++}`; params.push(status); }
    if (curriculum_id) { sql += ` AND tr.curriculum_id=$${i++}`; params.push(curriculum_id); }
    sql += ' ORDER BY tr.created_at DESC';

    const r = await query(sql, params);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed to list records' }); }
});

// Assign training to a user (admin/QA only)
router.post('/assign', authorize('user:write'), async (req, res) => {
  try {
    const { curriculum_id, user_id, due_date } = req.body;
    if (!curriculum_id || !user_id) return res.status(400).json({ error: 'curriculum_id and user_id required' });

    const result = await assignTraining(curriculum_id, user_id, req.session.userId, due_date);
    if (result.error) return res.status(409).json(result);

    await req.audit({ action: 'CREATE', resourceType: 'TRAINING_RECORD', resourceId: result.id, details: `Training assigned to user ${user_id}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to assign training' }); }
});

// Bulk assign — assign all required training for a user based on their role
router.post('/assign-required', authorize('user:write'), async (req, res) => {
  try {
    const { user_id } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id required' });

    const user = await query('SELECT role FROM users WHERE id=$1', [user_id]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const curricula = await getRequiredCurricula(user.rows[0].role);
    const assigned = [];
    const skipped = [];

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30); // 30 days to complete

    for (const c of curricula) {
      const result = await assignTraining(c.id, user_id, req.session.userId, dueDate.toISOString());
      if (result.error) {
        skipped.push({ course_code: c.course_code, reason: result.error });
      } else {
        assigned.push({ course_code: c.course_code, record_id: result.id });
      }
    }

    await req.audit({ action: 'CREATE', resourceType: 'TRAINING_RECORD', details: `Bulk assigned ${assigned.length} courses to user ${user_id}` });
    res.status(201).json({ assigned, skipped, total: curricula.length });
  } catch (err) { res.status(500).json({ error: 'Failed to bulk assign' }); }
});

// Mark training as complete (admin/QA or self-completion)
router.put('/records/:id/complete', async (req, res) => {
  try {
    const { score, evidence_notes } = req.body;
    const result = await completeTraining(req.params.id, req.session.userId, score, evidence_notes);
    if (result.error) return res.status(400).json(result);

    await req.audit({ action: 'UPDATE', resourceType: 'TRAINING_RECORD', resourceId: req.params.id, details: `Training completed (score: ${score || 'N/A'})` });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to complete training' }); }
});

// Update record status (admin — for waiver, in-progress, etc.)
router.put('/records/:id', authorize('user:write'), async (req, res) => {
  try {
    const { status, evidence_notes } = req.body;
    if (!status) return res.status(400).json({ error: 'status required' });

    const r = await query(
      `UPDATE training_records SET status=$1, evidence_notes=COALESCE($2,evidence_notes), updated_at=NOW() WHERE id=$3 RETURNING *`,
      [status, evidence_notes, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Record not found' });
    await req.audit({ action: 'UPDATE', resourceType: 'TRAINING_RECORD', resourceId: req.params.id, details: `Status changed to: ${status}` });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ════════════════════════════════════════════════════════════════
// EXPIRY & REMINDERS
// ════════════════════════════════════════════════════════════════

// Get training expiring within N days (default 30)
router.get('/expiring', authorize('user:read'), async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const records = await getExpiringTraining(days);
    res.json({ data: records, days_ahead: days });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Trigger expiry check (admin — marks overdue records as Expired)
router.post('/expire-check', authorize('config:write'), async (req, res) => {
  try {
    const expired = await expireOverdueTraining();
    await req.audit({ action: 'UPDATE', resourceType: 'TRAINING_RECORD', details: `Expiry check: ${expired.length} records expired` });
    res.json({ expired_count: expired.length, records: expired });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ════════════════════════════════════════════════════════════════
// TRAINING MATRIX — full compliance report
// ════════════════════════════════════════════════════════════════

router.get('/matrix', authorize('audit:read'), async (req, res) => {
  try {
    const matrix = await getTrainingMatrix();
    res.json(matrix);
  } catch (err) { res.status(500).json({ error: 'Failed to generate matrix' }); }
});

// Get training status for a specific user (admin view)
router.get('/user/:userId/status', authorize('user:read'), async (req, res) => {
  try {
    const user = await query('SELECT id, role FROM users WHERE id=$1', [req.params.userId]);
    if (user.rows.length === 0) return res.status(404).json({ error: 'User not found' });

    const status = await getTrainingStatus(req.params.userId, user.rows[0].role);
    const compliance = await isTrainingComplete(req.params.userId, user.rows[0].role);
    res.json({ user_id: req.params.userId, ...compliance, details: status });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
