// server/services/riskAssessmentService.js — FMEA Risk Assessment
// GAMP5 §6 Quality Risk Management | ICH Q9

const { query } = require('../db/pool');

async function createRisk({ mbrId, stepId, parameterId, hazard, hazardCategory, severity, probability, detectability, mitigation, assessedBy }) {
  const r = await query(
    `INSERT INTO risk_assessments (mbr_id, step_id, parameter_id, hazard, hazard_category, severity, probability, detectability, mitigation, assessed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [mbrId, stepId, parameterId, hazard, hazardCategory || 'Process', severity, probability, detectability, mitigation, assessedBy]
  );
  return r.rows[0];
}

async function updateRisk(riskId, updates) {
  const { hazard, hazard_category, severity, probability, detectability, mitigation, residual_rpn, status } = updates;
  const r = await query(
    `UPDATE risk_assessments SET hazard=COALESCE($1,hazard), hazard_category=COALESCE($2,hazard_category),
     severity=COALESCE($3,severity), probability=COALESCE($4,probability), detectability=COALESCE($5,detectability),
     mitigation=COALESCE($6,mitigation), residual_rpn=$7, status=COALESCE($8,status), updated_at=NOW()
     WHERE id=$9 RETURNING *`,
    [hazard, hazard_category, severity, probability, detectability, mitigation, residual_rpn, status, riskId]
  );
  return r.rows[0];
}

async function reviewRisk(riskId, reviewerId) {
  const r = await query(
    'UPDATE risk_assessments SET reviewed_by=$1, reviewed_at=NOW(), updated_at=NOW() WHERE id=$2 RETURNING *',
    [reviewerId, riskId]
  );
  return r.rows[0];
}

async function getRisksForMBR(mbrId) {
  const r = await query(
    `SELECT ra.*, s.step_name, p.param_name, u.full_name as assessed_by_name
     FROM risk_assessments ra
     LEFT JOIN mbr_steps s ON ra.step_id=s.id
     LEFT JOIN mbr_step_parameters p ON ra.parameter_id=p.id
     LEFT JOIN users u ON ra.assessed_by=u.id
     WHERE ra.mbr_id=$1 ORDER BY ra.rpn DESC`,
    [mbrId]
  );
  return r.rows;
}

async function getRiskSummary(mbrId) {
  const risks = await getRisksForMBR(mbrId);
  const summary = {
    total: risks.length,
    by_level: { Critical: 0, High: 0, Medium: 0, Low: 0 },
    by_status: { Open: 0, Mitigated: 0, Accepted: 0, Closed: 0 },
    by_category: {},
    highest_rpn: risks.length > 0 ? risks[0].rpn : 0,
    avg_rpn: risks.length > 0 ? Math.round(risks.reduce((s, r) => s + r.rpn, 0) / risks.length) : 0,
    unmitigated_critical: 0,
  };

  for (const r of risks) {
    summary.by_level[r.risk_level] = (summary.by_level[r.risk_level] || 0) + 1;
    summary.by_status[r.status] = (summary.by_status[r.status] || 0) + 1;
    summary.by_category[r.hazard_category] = (summary.by_category[r.hazard_category] || 0) + 1;
    if (r.risk_level === 'Critical' && r.status === 'Open') summary.unmitigated_critical++;
  }

  return summary;
}

module.exports = { createRisk, updateRisk, reviewRisk, getRisksForMBR, getRiskSummary };
