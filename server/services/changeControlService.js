// server/services/changeControlService.js — Change Control Workflow
// GAMP5 D8 — Change management | 21 CFR Part 11 §11.10(k)

const crypto = require('crypto');
const { query } = require('../db/pool');

// ════════════════════════════════════════════════════════════════
// CR NUMBER GENERATOR — CR-YYYY-NNNN
// ════════════════════════════════════════════════════════════════

async function generateCRNumber() {
  const year = new Date().getFullYear();
  const prefix = `CR-${year}-`;
  const r = await query(
    "SELECT cr_number FROM change_requests WHERE cr_number LIKE $1 ORDER BY cr_number DESC LIMIT 1",
    [`${prefix}%`]
  );
  if (r.rows.length === 0) return `${prefix}0001`;
  const lastNum = parseInt(r.rows[0].cr_number.split('-')[2]) || 0;
  return `${prefix}${String(lastNum + 1).padStart(4, '0')}`;
}

// ════════════════════════════════════════════════════════════════
// CREATE CHANGE REQUEST
// ════════════════════════════════════════════════════════════════

async function createChangeRequest({ typeId, title, description, justification, impactAssessment, riskLevel, priority, mbrId, requestedBy }) {
  // Validate type exists
  const typeR = await query('SELECT * FROM change_request_types WHERE id=$1 AND is_active=true', [typeId]);
  if (typeR.rows.length === 0) return { error: 'Change request type not found or inactive' };

  const crType = typeR.rows[0];
  if (crType.requires_impact_assessment && !impactAssessment) {
    return { error: `Impact assessment is required for ${crType.type_name} changes` };
  }

  const crNumber = await generateCRNumber();

  const r = await query(
    `INSERT INTO change_requests (cr_number, type_id, title, description, justification, impact_assessment, risk_level, priority, mbr_id, requested_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Draft') RETURNING *`,
    [crNumber, typeId, title, description, justification, impactAssessment, riskLevel || 'Medium', priority || 'Normal', mbrId, requestedBy]
  );

  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// SUBMIT — moves from Draft to Under Review, creates approval steps
// ════════════════════════════════════════════════════════════════

async function submitChangeRequest(crId, userId) {
  const cr = await query('SELECT cr.*, crt.approval_chain FROM change_requests cr JOIN change_request_types crt ON cr.type_id=crt.id WHERE cr.id=$1', [crId]);
  if (cr.rows.length === 0) return { error: 'Change request not found' };

  const req = cr.rows[0];
  if (req.status !== 'Draft') return { error: `Cannot submit: CR is in ${req.status} status` };
  if (req.requested_by !== userId) return { error: 'Only the requester can submit this CR' };

  const chain = req.approval_chain || [];
  if (chain.length === 0) return { error: 'No approval chain configured for this type' };

  // Create approval steps
  for (let i = 0; i < chain.length; i++) {
    await query(
      `INSERT INTO change_approvals (change_request_id, approval_step, step_index, status)
       VALUES ($1, $2, $3, 'Pending')`,
      [crId, chain[i], i]
    );
  }

  await query(
    "UPDATE change_requests SET status='Under Review', current_approver_index=0, updated_at=NOW() WHERE id=$1",
    [crId]
  );

  return { status: 'Under Review', approval_chain: chain, current_step: chain[0] };
}

// ════════════════════════════════════════════════════════════════
// APPROVE / REJECT / RETURN — process approval chain step
// ════════════════════════════════════════════════════════════════

async function processApproval(crId, action, userId, comments) {
  if (!['Approved', 'Rejected', 'Returned'].includes(action)) {
    return { error: 'Action must be Approved, Rejected, or Returned' };
  }

  const cr = await query(
    'SELECT cr.*, crt.approval_chain FROM change_requests cr JOIN change_request_types crt ON cr.type_id=crt.id WHERE cr.id=$1',
    [crId]
  );
  if (cr.rows.length === 0) return { error: 'Change request not found' };

  const req = cr.rows[0];
  if (req.status !== 'Under Review') return { error: `Cannot process: CR is in ${req.status} status` };

  const chain = req.approval_chain || [];
  const currentIndex = req.current_approver_index || 0;

  if (currentIndex >= chain.length) return { error: 'All approval steps already processed' };

  // Update the current approval step
  await query(
    `UPDATE change_approvals SET status=$1, approver_id=$2, comments=$3, decided_at=NOW()
     WHERE change_request_id=$4 AND step_index=$5`,
    [action, userId, comments, crId, currentIndex]
  );

  let newStatus = req.status;
  let nextStep = null;
  let mbrVersionCreated = null;

  if (action === 'Approved') {
    if (currentIndex + 1 >= chain.length) {
      // Last approver — CR is fully approved
      newStatus = 'Approved';

      // Auto-create MBR new version if linked
      if (req.mbr_id) {
        mbrVersionCreated = await autoCreateMBRVersion(req.mbr_id, req.cr_number, userId);
      }
    } else {
      // Move to next approver
      nextStep = chain[currentIndex + 1];
      await query(
        'UPDATE change_requests SET current_approver_index=$1, updated_at=NOW() WHERE id=$2',
        [currentIndex + 1, crId]
      );
    }
  } else if (action === 'Rejected') {
    newStatus = 'Rejected';
  } else if (action === 'Returned') {
    // Return to requester for revision
    newStatus = 'Draft';
    // Reset all pending approval steps
    await query(
      "DELETE FROM change_approvals WHERE change_request_id=$1 AND status='Pending'",
      [crId]
    );
  }

  if (newStatus !== req.status) {
    await query('UPDATE change_requests SET status=$1, updated_at=NOW() WHERE id=$2', [newStatus, crId]);
  }

  return {
    cr_number: req.cr_number,
    action,
    new_status: newStatus,
    current_step: nextStep || (action === 'Approved' && newStatus === 'Approved' ? 'All approved' : null),
    comments,
    mbr_version_created: mbrVersionCreated,
  };
}

// ════════════════════════════════════════════════════════════════
// AUTO MBR VERSION — creates new version when CR is approved
// ════════════════════════════════════════════════════════════════

async function autoCreateMBRVersion(mbrId, crNumber, userId) {
  try {
    const mbr = await query('SELECT * FROM mbrs WHERE id=$1', [mbrId]);
    if (mbr.rows.length === 0) return null;

    const ver = mbr.rows[0].current_version;
    const snap = JSON.stringify(mbr.rows[0]);
    const hash = crypto.createHash('sha256').update(snap).digest('hex');

    await query(
      'INSERT INTO mbr_versions (mbr_id, version, change_reason, snapshot, content_hash, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
      [mbrId, ver, `Change Request ${crNumber} approved`, snap, hash, userId]
    );
    await query(
      "UPDATE mbrs SET current_version=$1, status='Draft', approved_by=NULL, approved_at=NULL, updated_at=NOW() WHERE id=$2",
      [ver + 1, mbrId]
    );
    // Clear signatures for the new version
    await query('DELETE FROM mbr_signatures WHERE mbr_id=$1', [mbrId]);

    return { mbr_id: mbrId, previous_version: ver, new_version: ver + 1 };
  } catch (err) {
    console.error('[CHANGE-CONTROL] Auto MBR version failed:', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
// IMPLEMENTATION & VERIFICATION — post-approval workflow
// ════════════════════════════════════════════════════════════════

async function implementCR(crId, userId, notes) {
  const cr = await query('SELECT status FROM change_requests WHERE id=$1', [crId]);
  if (cr.rows.length === 0) return { error: 'Not found' };
  if (cr.rows[0].status !== 'Approved') return { error: `Cannot implement: CR is in ${cr.rows[0].status} status` };

  await query(
    "UPDATE change_requests SET status='Implemented', implementation_notes=$1, implemented_by=$2, implemented_at=NOW(), updated_at=NOW() WHERE id=$3",
    [notes, userId, crId]
  );
  return { status: 'Implemented' };
}

async function verifyCR(crId, userId, notes) {
  const cr = await query('SELECT status FROM change_requests WHERE id=$1', [crId]);
  if (cr.rows.length === 0) return { error: 'Not found' };
  if (cr.rows[0].status !== 'Implemented') return { error: `Cannot verify: CR is in ${cr.rows[0].status} status` };

  await query(
    "UPDATE change_requests SET status='Verified', verification_notes=$1, verified_by=$2, verified_at=NOW(), updated_at=NOW() WHERE id=$3",
    [notes, userId, crId]
  );
  return { status: 'Verified' };
}

async function closeCR(crId, userId) {
  const cr = await query('SELECT status FROM change_requests WHERE id=$1', [crId]);
  if (cr.rows.length === 0) return { error: 'Not found' };
  if (cr.rows[0].status !== 'Verified') return { error: `Cannot close: CR is in ${cr.rows[0].status} status` };

  await query(
    "UPDATE change_requests SET status='Closed', closed_by=$1, closed_at=NOW(), updated_at=NOW() WHERE id=$2",
    [userId, crId]
  );
  return { status: 'Closed' };
}

async function cancelCR(crId, userId) {
  const cr = await query('SELECT status, requested_by FROM change_requests WHERE id=$1', [crId]);
  if (cr.rows.length === 0) return { error: 'Not found' };
  if (['Closed', 'Cancelled'].includes(cr.rows[0].status)) return { error: 'CR already closed or cancelled' };

  await query(
    "UPDATE change_requests SET status='Cancelled', updated_at=NOW() WHERE id=$1",
    [crId]
  );
  return { status: 'Cancelled' };
}

// ════════════════════════════════════════════════════════════════
// QUERIES
// ════════════════════════════════════════════════════════════════

async function getCRWithApprovals(crId) {
  const cr = await query(
    `SELECT cr.*, crt.type_code, crt.type_name, crt.approval_chain,
     u.full_name as requested_by_name, u.email as requested_by_email
     FROM change_requests cr
     JOIN change_request_types crt ON cr.type_id=crt.id
     JOIN users u ON cr.requested_by=u.id
     WHERE cr.id=$1`,
    [crId]
  );
  if (cr.rows.length === 0) return null;

  const approvals = await query(
    `SELECT ca.*, u.full_name as approver_name
     FROM change_approvals ca LEFT JOIN users u ON ca.approver_id=u.id
     WHERE ca.change_request_id=$1 ORDER BY ca.step_index`,
    [crId]
  );

  return { ...cr.rows[0], approvals: approvals.rows };
}

async function getPendingApprovals(userId, userRole) {
  // Find CRs where the current approval step could be handled by this user
  const r = await query(
    `SELECT cr.*, crt.type_code, crt.type_name, crt.approval_chain,
     ca.approval_step, ca.step_index
     FROM change_requests cr
     JOIN change_request_types crt ON cr.type_id=crt.id
     JOIN change_approvals ca ON ca.change_request_id=cr.id
     WHERE cr.status='Under Review'
       AND ca.step_index=cr.current_approver_index
       AND ca.status='Pending'
     ORDER BY cr.priority DESC, cr.created_at ASC`
  );
  return r.rows;
}

module.exports = {
  generateCRNumber,
  createChangeRequest,
  submitChangeRequest,
  processApproval,
  autoCreateMBRVersion,
  implementCR,
  verifyCR,
  closeCR,
  cancelCR,
  getCRWithApprovals,
  getPendingApprovals,
};
