// server/routes/changeControlRoutes.js — Change Control API
// GAMP5 D8 | 21 CFR Part 11 §11.10(k)

const { Router } = require('express');
const { query } = require('../db/pool');
const { authenticate, authorize } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const {
  createChangeRequest, submitChangeRequest, processApproval,
  implementCR, verifyCR, closeCR, cancelCR,
  getCRWithApprovals, getPendingApprovals,
} = require('../services/changeControlService');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// ════════════════════════════════════════════════════════════════
// CHANGE REQUEST TYPES
// ════════════════════════════════════════════════════════════════

router.get('/types', async (req, res) => {
  try {
    const r = await query('SELECT * FROM change_request_types WHERE is_active=true ORDER BY type_code');
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ════════════════════════════════════════════════════════════════
// CHANGE REQUESTS — CRUD
// ════════════════════════════════════════════════════════════════

// List CRs (filterable)
router.get('/', async (req, res) => {
  try {
    const { status, mbr_id, requested_by, type_id } = req.query;
    let sql = `SELECT cr.*, crt.type_code, crt.type_name, u.full_name as requested_by_name
               FROM change_requests cr
               JOIN change_request_types crt ON cr.type_id=crt.id
               JOIN users u ON cr.requested_by=u.id WHERE 1=1`;
    const params = []; let i = 1;
    if (status) { sql += ` AND cr.status=$${i++}`; params.push(status); }
    if (mbr_id) { sql += ` AND cr.mbr_id=$${i++}`; params.push(mbr_id); }
    if (requested_by) { sql += ` AND cr.requested_by=$${i++}`; params.push(requested_by); }
    if (type_id) { sql += ` AND cr.type_id=$${i++}`; params.push(type_id); }
    sql += ' ORDER BY cr.created_at DESC';
    const r = await query(sql, params);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Get single CR with approval history
router.get('/:id', async (req, res) => {
  try {
    const cr = await getCRWithApprovals(req.params.id);
    if (!cr) return res.status(404).json({ error: 'Change request not found' });
    res.json(cr);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Create new CR
router.post('/', async (req, res) => {
  try {
    const { type_id, title, description, justification, impact_assessment, risk_level, priority, mbr_id } = req.body;
    if (!type_id || !title || !description || !justification) {
      return res.status(400).json({ error: 'type_id, title, description, and justification are required' });
    }

    const result = await createChangeRequest({
      typeId: type_id, title, description, justification,
      impactAssessment: impact_assessment, riskLevel: risk_level,
      priority, mbrId: mbr_id, requestedBy: req.session.userId,
    });

    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'CREATE', resourceType: 'CHANGE_REQUEST', resourceId: result.id, details: `CR ${result.cr_number}: ${title}` });
    res.status(201).json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to create change request' }); }
});

// Update CR (only in Draft)
router.put('/:id', async (req, res) => {
  try {
    const cr = await query('SELECT status, requested_by FROM change_requests WHERE id=$1', [req.params.id]);
    if (cr.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    if (cr.rows[0].status !== 'Draft') return res.status(400).json({ error: `Cannot edit CR in ${cr.rows[0].status} status` });

    const { title, description, justification, impact_assessment, risk_level, priority, mbr_id } = req.body;
    const r = await query(
      `UPDATE change_requests SET title=COALESCE($1,title), description=COALESCE($2,description),
       justification=COALESCE($3,justification), impact_assessment=COALESCE($4,impact_assessment),
       risk_level=COALESCE($5,risk_level), priority=COALESCE($6,priority), mbr_id=COALESCE($7,mbr_id),
       updated_at=NOW() WHERE id=$8 RETURNING *`,
      [title, description, justification, impact_assessment, risk_level, priority, mbr_id, req.params.id]
    );
    await req.audit({ action: 'UPDATE', resourceType: 'CHANGE_REQUEST', resourceId: req.params.id, details: 'CR updated' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ════════════════════════════════════════════════════════════════
// WORKFLOW — submit, approve/reject, implement, verify, close
// ════════════════════════════════════════════════════════════════

// Submit CR for review
router.post('/:id/submit', async (req, res) => {
  try {
    const result = await submitChangeRequest(req.params.id, req.session.userId);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'CHANGE_REQUEST', resourceId: req.params.id, details: 'CR submitted for review' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to submit' }); }
});

// Process approval (approve/reject/return)
router.post('/:id/approve', async (req, res) => {
  try {
    const { action, comments } = req.body;
    if (!action) return res.status(400).json({ error: 'action required (Approved, Rejected, or Returned)' });

    const result = await processApproval(req.params.id, action, req.session.userId, comments);
    if (result.error) return res.status(400).json(result);

    await req.audit({
      action: 'APPROVE', resourceType: 'CHANGE_REQUEST', resourceId: req.params.id,
      details: `CR ${result.cr_number}: ${action} by approver — ${comments || 'No comments'}`,
    });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed to process approval' }); }
});

// Mark as implemented
router.post('/:id/implement', async (req, res) => {
  try {
    const result = await implementCR(req.params.id, req.session.userId, req.body.notes);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'CHANGE_REQUEST', resourceId: req.params.id, details: 'CR implemented' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Mark as verified
router.post('/:id/verify', async (req, res) => {
  try {
    const result = await verifyCR(req.params.id, req.session.userId, req.body.notes);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'CHANGE_REQUEST', resourceId: req.params.id, details: 'CR verified' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Close CR
router.post('/:id/close', async (req, res) => {
  try {
    const result = await closeCR(req.params.id, req.session.userId);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'CHANGE_REQUEST', resourceId: req.params.id, details: 'CR closed' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// Cancel CR
router.post('/:id/cancel', async (req, res) => {
  try {
    const result = await cancelCR(req.params.id, req.session.userId);
    if (result.error) return res.status(400).json(result);
    await req.audit({ action: 'UPDATE', resourceType: 'CHANGE_REQUEST', resourceId: req.params.id, details: 'CR cancelled' });
    res.json(result);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ════════════════════════════════════════════════════════════════
// PENDING APPROVALS — dashboard for approvers
// ════════════════════════════════════════════════════════════════

router.get('/pending/my-approvals', async (req, res) => {
  try {
    const pending = await getPendingApprovals(req.session.userId, req.session.role);
    res.json({ data: pending });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
