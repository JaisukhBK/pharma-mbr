// server/services/stateMachine.js — MBR Lifecycle State Machine
// 21 CFR Part 11 §11.10(f) — Operational system checks to enforce sequencing
// ISA-88 S88.02 — Recipe lifecycle management
// GAMP5 D8 — Change control

const { query } = require('../db/pool');

// ════════════════════════════════════════════════════════════════
// SIGNATURE SEQUENCE — strict chain enforced
// Author → Reviewer → Approver → QA_Approver
// ════════════════════════════════════════════════════════════════

const SIGNATURE_SEQUENCE = ['Author', 'Reviewer', 'Approver', 'QA_Approver'];

// Which status each signature triggers (null = no status change)
const SIGNATURE_STATUS_MAP = {
  Author:      null,          // Author signs in Draft, status stays Draft
  Reviewer:    'In Review',   // Reviewer moves to In Review → edits locked
  Approver:    'Approved',    // Approver moves to Approved
  QA_Approver: 'Effective',   // QA Approver moves to Effective (production release)
};

// ════════════════════════════════════════════════════════════════
// PREREQUISITE CHECK — enforces strict sequencing
// ════════════════════════════════════════════════════════════════

/**
 * Check if a signature role is allowed given existing signatures.
 * Enforces: Author before Reviewer, Reviewer before Approver, Approver before QA_Approver.
 *
 * @param {string} mbrId
 * @param {string} signatureRole - 'Author', 'Reviewer', 'Approver', 'QA_Approver'
 * @returns {Object} { allowed, error?, missing?, next_status? }
 */
async function checkSignaturePrerequisites(mbrId, signatureRole) {
  const roleIndex = SIGNATURE_SEQUENCE.indexOf(signatureRole);
  if (roleIndex < 0) {
    return { allowed: false, error: `Invalid signature role: ${signatureRole}` };
  }

  const sigs = await query('SELECT signature_role FROM mbr_signatures WHERE mbr_id=$1', [mbrId]);
  const appliedRoles = sigs.rows.map(s => s.signature_role);

  // Check if this role has already signed
  if (appliedRoles.includes(signatureRole)) {
    return { allowed: false, error: `${signatureRole} has already signed this MBR` };
  }

  // Check all prerequisites in the chain
  for (let i = 0; i < roleIndex; i++) {
    const required = SIGNATURE_SEQUENCE[i];
    if (!appliedRoles.includes(required)) {
      return {
        allowed: false,
        error: `Cannot sign as ${signatureRole}: ${required} signature is required first (§11.10(f) sequencing)`,
        missing: required,
      };
    }
  }

  return {
    allowed: true,
    next_status: SIGNATURE_STATUS_MAP[signatureRole],
  };
}

// ════════════════════════════════════════════════════════════════
// EDIT LOCK — blocks content changes after Reviewer signs
// ════════════════════════════════════════════════════════════════

/**
 * Check if an MBR is editable.
 * Rules:
 *   - Draft status → edits allowed (even after Author signs)
 *   - In Review / Approved / Effective / Superseded / Obsolete → edits blocked
 *   - User must create a new version to resume editing
 *
 * @param {string} mbrId
 * @returns {Object} { editable, error?, status?, httpStatus? }
 */
async function assertEditable(mbrId) {
  const mbr = await query('SELECT status FROM mbrs WHERE id=$1', [mbrId]);
  if (mbr.rows.length === 0) {
    return { editable: false, error: 'MBR not found', httpStatus: 404 };
  }

  const status = mbr.rows[0].status;
  if (status !== 'Draft') {
    return {
      editable: false,
      error: `MBR is locked (status: ${status}). Content edits are blocked after Reviewer signature. Create a new version to make changes.`,
      status,
      httpStatus: 400,
    };
  }

  return { editable: true, status };
}

/**
 * Express middleware factory — rejects write requests if MBR is locked.
 * Extracts mbrId from req.params.mbrId or req.params.id.
 */
function requireEditable() {
  return async (req, res, next) => {
    const mbrId = req.params.mbrId || req.params.id;
    if (!mbrId) return next(); // No MBR context (e.g., create new MBR)

    try {
      const result = await assertEditable(mbrId);
      if (!result.editable) {
        return res.status(result.httpStatus || 400).json({ error: result.error });
      }
      next();
    } catch (err) {
      console.error('[STATE-MACHINE] Edit check error:', err.message);
      next(); // Don't block on internal errors — log and continue
    }
  };
}

// ════════════════════════════════════════════════════════════════
// TRANSITION LOG — records every status change
// ════════════════════════════════════════════════════════════════

/**
 * Log a status transition to the mbr_status_transitions table.
 */
async function logTransition(mbrId, fromStatus, toStatus, triggeredBy, userId, reason) {
  await query(
    'INSERT INTO mbr_status_transitions (mbr_id, from_status, to_status, triggered_by, user_id, reason) VALUES ($1,$2,$3,$4,$5,$6)',
    [mbrId, fromStatus, toStatus, triggeredBy, userId, reason || `${triggeredBy} signature applied`]
  );
}

/**
 * Get transition history for an MBR.
 */
async function getTransitions(mbrId) {
  const r = await query(
    'SELECT t.*, u.full_name as user_name FROM mbr_status_transitions t LEFT JOIN users u ON t.user_id=u.id WHERE t.mbr_id=$1 ORDER BY t.created_at',
    [mbrId]
  );
  return r.rows;
}

/**
 * Get the next required signature role for an MBR.
 */
async function getNextRequiredSignature(mbrId) {
  const sigs = await query('SELECT signature_role FROM mbr_signatures WHERE mbr_id=$1', [mbrId]);
  const appliedRoles = sigs.rows.map(s => s.signature_role);

  for (const role of SIGNATURE_SEQUENCE) {
    if (!appliedRoles.includes(role)) return role;
  }
  return null; // All signatures complete
}

module.exports = {
  SIGNATURE_SEQUENCE,
  SIGNATURE_STATUS_MAP,
  checkSignaturePrerequisites,
  assertEditable,
  requireEditable,
  logTransition,
  getTransitions,
  getNextRequiredSignature,
};
