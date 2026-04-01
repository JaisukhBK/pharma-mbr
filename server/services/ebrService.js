// server/services/ebrService.js — Electronic Batch Record Execution
// Shop floor execution engine for pharmaceutical manufacturing

const { query } = require('../db/pool');

// ════════════════════════════════════════════════════════════════
// 1. CREATE EBR FROM EFFECTIVE MBR
// ════════════════════════════════════════════════════════════════

async function createEBR(mbrId, batchNumber, operatorId) {
  // Only Effective MBRs can be executed
  const mbr = await query('SELECT * FROM mbrs WHERE id=$1', [mbrId]);
  if (mbr.rows.length === 0) return { error: 'MBR not found' };
  if (mbr.rows[0].status !== 'Effective') return { error: `MBR must be in Effective status (current: ${mbr.rows[0].status})` };

  // Check batch number uniqueness
  const dup = await query('SELECT id FROM ebrs WHERE batch_number=$1', [batchNumber]);
  if (dup.rows.length > 0) return { error: 'Batch number already exists' };

  // Generate EBR code
  const code = `EBR-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${batchNumber}`;

  const ebr = await query(
    `INSERT INTO ebrs (ebr_code, mbr_id, batch_number, product_name, batch_size, batch_size_unit, mbr_version, theoretical_yield, operator_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Ready') RETURNING *`,
    [code, mbrId, batchNumber, mbr.rows[0].product_name, mbr.rows[0].batch_size, mbr.rows[0].batch_size_unit || 'units',
     mbr.rows[0].current_version, mbr.rows[0].batch_size, operatorId]
  );

  // Pre-populate step executions from MBR phases/steps
  const phases = await query('SELECT * FROM mbr_phases WHERE mbr_id=$1 ORDER BY phase_number', [mbrId]);
  const steps = await query('SELECT * FROM mbr_steps WHERE mbr_id=$1 ORDER BY step_number', [mbrId]);

  let stepNum = 0;
  for (const phase of phases.rows) {
    const phaseSteps = steps.rows.filter(s => s.phase_id === phase.id);
    for (const step of phaseSteps) {
      stepNum++;
      const exec = await query(
        `INSERT INTO ebr_step_executions (ebr_id, mbr_step_id, step_number, step_name, phase_name, instruction, is_critical, is_gmp_critical, duration_min, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'Pending') RETURNING id`,
        [ebr.rows[0].id, step.id, stepNum, step.step_name, phase.phase_name, step.instruction, step.is_critical, step.is_gmp_critical, step.duration_min]
      );

      // Pre-populate parameter values from MBR parameters
      const params = await query('SELECT * FROM mbr_step_parameters WHERE step_id=$1', [step.id]);
      for (const p of params.rows) {
        await query(
          `INSERT INTO ebr_parameter_values (ebr_id, step_execution_id, parameter_id, param_name, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [ebr.rows[0].id, exec.rows[0].id, p.id, p.param_name, p.target_value, p.unit, p.lower_limit, p.upper_limit, p.is_cpp, p.is_cqa]
        );
      }
    }
  }

  return ebr.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 2. STEP-BY-STEP EXECUTION
// ════════════════════════════════════════════════════════════════

async function startStep(stepExecId, operatorId) {
  const r = await query(
    "UPDATE ebr_step_executions SET status='In Progress', operator_id=$1, started_at=NOW() WHERE id=$2 AND status='Pending' RETURNING *",
    [operatorId, stepExecId]
  );
  if (r.rows.length === 0) return { error: 'Step not found or already started' };

  // Start the EBR if this is the first step
  const ebr = await query("UPDATE ebrs SET status='In Progress', started_at=COALESCE(started_at,NOW()), updated_at=NOW() WHERE id=$1 RETURNING id", [r.rows[0].ebr_id]);

  return r.rows[0];
}

async function completeStep(stepExecId, operatorId, notes, actualDurationMin) {
  // Check all parameters are recorded
  const unrecorded = await query(
    "SELECT id FROM ebr_parameter_values WHERE step_execution_id=$1 AND actual_value IS NULL",
    [stepExecId]
  );
  if (unrecorded.rows.length > 0) return { error: `${unrecorded.rows.length} parameter(s) not yet recorded`, unrecorded_count: unrecorded.rows.length };

  // Check for unresolved deviations
  const openDevs = await query(
    "SELECT id FROM ebr_deviations WHERE step_execution_id=$1 AND status='Open'",
    [stepExecId]
  );
  if (openDevs.rows.length > 0) return { error: `${openDevs.rows.length} open deviation(s) must be documented before completing step` };

  const r = await query(
    "UPDATE ebr_step_executions SET status='Completed', completed_at=NOW(), deviation_notes=$1, actual_duration_min=$2 WHERE id=$3 RETURNING *",
    [notes, actualDurationMin, stepExecId]
  );
  if (r.rows.length === 0) return { error: 'Step not found' };
  return r.rows[0];
}

async function verifyStep(stepExecId, verifierId) {
  const r = await query(
    "UPDATE ebr_step_executions SET verifier_id=$1, verified_at=NOW() WHERE id=$2 AND status='Completed' RETURNING *",
    [verifierId, stepExecId]
  );
  if (r.rows.length === 0) return { error: 'Step not found or not completed' };
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 3. PARAMETER VERIFICATION (auto-check limits)
// ════════════════════════════════════════════════════════════════

async function recordParameterValue(paramValueId, actualValue, recordedBy) {
  const param = await query('SELECT * FROM ebr_parameter_values WHERE id=$1', [paramValueId]);
  if (param.rows.length === 0) return { error: 'Parameter not found' };

  const p = param.rows[0];
  let inSpec = true;
  const numVal = parseFloat(actualValue);

  if (!isNaN(numVal)) {
    if (p.lower_limit !== null && numVal < parseFloat(p.lower_limit)) inSpec = false;
    if (p.upper_limit !== null && numVal > parseFloat(p.upper_limit)) inSpec = false;
  }

  const r = await query(
    'UPDATE ebr_parameter_values SET actual_value=$1, in_spec=$2, recorded_by=$3, recorded_at=NOW() WHERE id=$4 RETURNING *',
    [actualValue, inSpec, recordedBy, paramValueId]
  );

  let deviation = null;
  if (!inSpec) {
    // Auto-create deviation for out-of-spec
    deviation = await query(
      `INSERT INTO ebr_deviations (ebr_id, step_execution_id, parameter_value_id, deviation_type, severity, description, expected_value, actual_value, reported_by)
       VALUES ($1,$2,$3,'Out of Spec',$4,$5,$6,$7,$8) RETURNING *`,
      [p.ebr_id, p.step_execution_id, paramValueId,
       (p.is_cpp || p.is_cqa) ? 'Major' : 'Minor',
       `${p.param_name} out of specification: actual ${actualValue} ${p.unit || ''} vs limits [${p.lower_limit || '-'}, ${p.upper_limit || '-'}]`,
       p.target_value, actualValue, recordedBy]
    );
    deviation = deviation.rows[0];
  }

  return { parameter: r.rows[0], in_spec: inSpec, deviation };
}

// ════════════════════════════════════════════════════════════════
// 4. DEVIATION CAPTURE
// ════════════════════════════════════════════════════════════════

async function createDeviation({ ebrId, step_execution_id, deviation_type, severity, description, expected_value, actual_value, immediate_action, reportedBy }) {
  const r = await query(
    `INSERT INTO ebr_deviations (ebr_id, step_execution_id, deviation_type, severity, description, expected_value, actual_value, immediate_action, reported_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [ebrId, step_execution_id, deviation_type || 'Process Deviation', severity || 'Minor', description, expected_value, actual_value, immediate_action, reportedBy]
  );
  return r.rows[0];
}

async function resolveDeviation(deviationId, rootCause, correctiveAction, resolvedBy) {
  const r = await query(
    "UPDATE ebr_deviations SET status='Resolved', root_cause=$1, corrective_action=$2, resolved_by=$3, resolved_at=NOW(), updated_at=NOW() WHERE id=$4 RETURNING *",
    [rootCause, correctiveAction, resolvedBy, deviationId]
  );
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 5. MATERIAL CONSUMPTION
// ════════════════════════════════════════════════════════════════

async function recordMaterialConsumption({ ebrId, step_execution_id, material_code, material_name, lot_number, quantity_required, quantity_dispensed, unit, tare_weight, gross_weight, net_weight, expiry_date, dispensedBy }) {
  const r = await query(
    `INSERT INTO ebr_material_consumptions (ebr_id, step_execution_id, material_code, material_name, lot_number, quantity_required, quantity_dispensed, unit, tare_weight, gross_weight, net_weight, expiry_date, dispensed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [ebrId, step_execution_id, material_code, material_name, lot_number, quantity_required, quantity_dispensed, unit, tare_weight, gross_weight, net_weight, expiry_date, dispensedBy]
  );
  return r.rows[0];
}

async function verifyMaterial(consumptionId, verifierId) {
  const r = await query(
    'UPDATE ebr_material_consumptions SET verified_by=$1, verified_at=NOW() WHERE id=$2 RETURNING *',
    [verifierId, consumptionId]
  );
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 6. EQUIPMENT USAGE
// ════════════════════════════════════════════════════════════════

async function logEquipmentUsage({ ebrId, step_execution_id, equipment_code, equipment_name, equipment_type, calibration_status, calibration_due, clean_status, usage_start, loggedBy }) {
  const r = await query(
    `INSERT INTO ebr_equipment_usage (ebr_id, step_execution_id, equipment_code, equipment_name, equipment_type, calibration_status, calibration_due, clean_status, usage_start, logged_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [ebrId, step_execution_id, equipment_code, equipment_name, equipment_type, calibration_status || 'Verified', calibration_due, clean_status || 'Clean', usage_start, loggedBy]
  );
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 7. IPC CHECK RECORDING
// ════════════════════════════════════════════════════════════════

async function recordIPCResult({ ebrId, step_execution_id, ipc_check_id, check_name, check_type, specification, actual_result, unit, pass_fail, testedBy }) {
  const r = await query(
    `INSERT INTO ebr_ipc_results (ebr_id, step_execution_id, ipc_check_id, check_name, check_type, specification, actual_result, unit, pass_fail, tested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [ebrId, step_execution_id, ipc_check_id, check_name, check_type, specification, actual_result, unit, pass_fail, testedBy]
  );

  // Auto-create deviation for failed IPC
  if (pass_fail === 'Fail') {
    await query(
      `INSERT INTO ebr_deviations (ebr_id, step_execution_id, deviation_type, severity, description, expected_value, actual_value, reported_by)
       VALUES ($1,$2,'Out of Spec','Major',$3,$4,$5,$6)`,
      [ebrId, step_execution_id, `IPC check failed: ${check_name}`, specification, actual_result, testedBy]
    );
  }

  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 8. YIELD CALCULATION
// ════════════════════════════════════════════════════════════════

async function recordYield({ ebrId, phase_name, stage, theoretical_qty, actual_qty, unit, recordedBy }) {
  const r = await query(
    `INSERT INTO ebr_yield_records (ebr_id, phase_name, stage, theoretical_qty, actual_qty, unit, recorded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ebrId, phase_name, stage || 'In Process', theoretical_qty, actual_qty, unit, recordedBy]
  );
  return r.rows[0];
}

async function calculateFinalYield(ebrId) {
  const yields = await query('SELECT * FROM ebr_yield_records WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);
  const final = yields.rows.find(y => y.stage === 'Final') || yields.rows[yields.rows.length - 1];

  if (final) {
    await query(
      'UPDATE ebrs SET actual_yield=$1, yield_pct=$2, updated_at=NOW() WHERE id=$3',
      [final.actual_qty, final.yield_pct, ebrId]
    );
  }

  return { yields: yields.rows, final_yield: final };
}

// ════════════════════════════════════════════════════════════════
// BATCH COMPLETION & RELEASE
// ════════════════════════════════════════════════════════════════

async function completeBatch(ebrId) {
  // Check all steps are completed
  const pending = await query(
    "SELECT id FROM ebr_step_executions WHERE ebr_id=$1 AND status != 'Completed'",
    [ebrId]
  );
  if (pending.rows.length > 0) return { error: `${pending.rows.length} step(s) not yet completed` };

  // Check no open deviations
  const openDevs = await query(
    "SELECT id FROM ebr_deviations WHERE ebr_id=$1 AND status='Open'",
    [ebrId]
  );
  if (openDevs.rows.length > 0) return { error: `${openDevs.rows.length} open deviation(s) must be resolved` };

  await calculateFinalYield(ebrId);

  const r = await query(
    "UPDATE ebrs SET status='Complete', completed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *",
    [ebrId]
  );
  return r.rows[0];
}

async function releaseBatch(ebrId, decision, notes, userId, password, verifyPasswordFn) {
  if (!['Released', 'Rejected'].includes(decision)) return { error: 'Decision must be Released or Rejected' };

  const ebr = await query('SELECT * FROM ebrs WHERE id=$1', [ebrId]);
  if (ebr.rows.length === 0) return { error: 'EBR not found' };
  if (ebr.rows[0].status !== 'Complete') return { error: `Batch must be Complete before release (current: ${ebr.rows[0].status})` };

  // Password re-entry (§11.200)
  if (!password) return { error: 'Password required for batch release (§11.200)' };
  const valid = await verifyPasswordFn(userId, password);
  if (!valid) return { error: 'Password verification failed' };

  const r = await query(
    `UPDATE ebrs SET release_status=$1, released_by=$2, released_at=NOW(), release_notes=$3, status=$1, updated_at=NOW() WHERE id=$4 RETURNING *`,
    [decision, userId, notes, ebrId]
  );

  // Record release signature
  const user = await query('SELECT email FROM users WHERE id=$1', [userId]);
  await query(
    `INSERT INTO ebr_release_signatures (ebr_id, signature_role, signer_id, signer_email, signature_meaning, password_verified)
     VALUES ($1,$2,$3,$4,$5,true)`,
    [ebrId, 'QA Approver', userId, user.rows[0]?.email, `Batch ${decision}: ${notes || 'No comments'}`]
  );

  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// QUERIES — full EBR retrieval
// ════════════════════════════════════════════════════════════════

async function getEBR(ebrId) {
  const ebr = await query(
    `SELECT e.*, m.product_code, m.dosage_form, u.full_name as operator_name
     FROM ebrs e JOIN mbrs m ON e.mbr_id=m.id LEFT JOIN users u ON e.operator_id=u.id WHERE e.id=$1`,
    [ebrId]
  );
  if (ebr.rows.length === 0) return null;

  const steps = await query('SELECT * FROM ebr_step_executions WHERE ebr_id=$1 ORDER BY step_number', [ebrId]);
  const params = await query('SELECT * FROM ebr_parameter_values WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);
  const deviations = await query('SELECT * FROM ebr_deviations WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);
  const materials = await query('SELECT * FROM ebr_material_consumptions WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);
  const equipment = await query('SELECT * FROM ebr_equipment_usage WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);
  const ipc = await query('SELECT * FROM ebr_ipc_results WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);
  const yields = await query('SELECT * FROM ebr_yield_records WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);
  const signatures = await query('SELECT * FROM ebr_release_signatures WHERE ebr_id=$1 ORDER BY signed_at', [ebrId]);

  // Nest params under steps
  const stepsWithParams = steps.rows.map(s => ({
    ...s,
    parameters: params.rows.filter(p => p.step_execution_id === s.id),
    materials: materials.rows.filter(m => m.step_execution_id === s.id),
    equipment: equipment.rows.filter(eq => eq.step_execution_id === s.id),
    ipc_results: ipc.rows.filter(i => i.step_execution_id === s.id),
    deviations: deviations.rows.filter(d => d.step_execution_id === s.id),
  }));

  return {
    ...ebr.rows[0],
    steps: stepsWithParams,
    deviations: deviations.rows,
    yields: yields.rows,
    release_signatures: signatures.rows,
    summary: {
      total_steps: steps.rows.length,
      completed_steps: steps.rows.filter(s => s.status === 'Completed').length,
      total_params: params.rows.length,
      out_of_spec_params: params.rows.filter(p => p.in_spec === false).length,
      total_deviations: deviations.rows.length,
      open_deviations: deviations.rows.filter(d => d.status === 'Open').length,
      ipc_passed: ipc.rows.filter(i => i.pass_fail === 'Pass').length,
      ipc_failed: ipc.rows.filter(i => i.pass_fail === 'Fail').length,
    },
  };
}

async function listEBRs(filters = {}) {
  let sql = `SELECT e.*, m.product_code, m.product_name as mbr_product, u.full_name as operator_name,
    (SELECT COUNT(*) FROM ebr_step_executions WHERE ebr_id=e.id) as total_steps,
    (SELECT COUNT(*) FROM ebr_step_executions WHERE ebr_id=e.id AND status='Completed') as completed_steps,
    (SELECT COUNT(*) FROM ebr_deviations WHERE ebr_id=e.id AND status='Open') as open_deviations
    FROM ebrs e JOIN mbrs m ON e.mbr_id=m.id LEFT JOIN users u ON e.operator_id=u.id WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND e.status=$${i++}`; params.push(filters.status); }
  if (filters.mbr_id) { sql += ` AND e.mbr_id=$${i++}`; params.push(filters.mbr_id); }
  sql += ' ORDER BY e.created_at DESC';
  const r = await query(sql, params);
  return r.rows;
}

module.exports = {
  createEBR, startStep, completeStep, verifyStep,
  recordParameterValue, createDeviation, resolveDeviation,
  recordMaterialConsumption, verifyMaterial,
  logEquipmentUsage, recordIPCResult,
  recordYield, calculateFinalYield,
  completeBatch, releaseBatch,
  getEBR, listEBRs,
};
