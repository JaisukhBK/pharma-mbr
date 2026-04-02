// server/services/ebrService.js — EBR Execution Engine
// SCHEMA AUDIT: ebrs=M-004, ebr_parameter_values=M-004, all others=M-007
// M-004 ebrs: id,ebr_code,batch_number,mbr_id,mbr_code,product_name,product_code,batch_size,status,line,operator_id,started_at,completed_at,phases_data,material_consumption,outputs,created_by,created_at,updated_at
// M-004 ebr_parameter_values: id,ebr_id,phase_id,step_id,param_id,param_name,target_value(DECIMAL),lower_limit,upper_limit,actual_value(DECIMAL),unit,is_oos,is_cpp,recorded_by,recorded_at
// M-007 ebr_step_executions: id,ebr_id,mbr_step_id,step_number,step_name,phase_name,instruction,is_critical,is_gmp_critical,duration_min,actual_duration_min,status,operator_id,verifier_id,started_at,completed_at,verified_at,deviation_notes,created_at
// M-007 ebr_equipment_usage: NO equipment_type column
// M-007 ebr_release_signatures: NO decision or notes columns — has signature_role,signer_id,signer_email,signature_meaning,password_verified,signed_at

const { query } = require('../db/pool');

// ════════════════════════════════════════════════════════════════
// 1. CREATE EBR FROM EFFECTIVE MBR
// ════════════════════════════════════════════════════════════════

async function createEBR(mbrId, batchNumber, operatorId) {
  const mbr = await query('SELECT * FROM mbrs WHERE id=$1', [mbrId]);
  if (mbr.rows.length === 0) return { error: 'MBR not found' };
  // PAS-X style: allow trial batches from Draft/Approved MBRs, production from Effective
  const mbrStatus = mbr.rows[0].status;
  const isTrial = mbrStatus !== 'Effective';
  if (mbrStatus === 'Obsolete' || mbrStatus === 'Superseded') return { error: `Cannot create batch from ${mbrStatus} MBR` };

  const dup = await query('SELECT id FROM ebrs WHERE batch_number=$1', [batchNumber]);
  if (dup.rows.length > 0) return { error: 'Batch number already exists' };

  const batchType = isTrial ? 'Trial' : 'Production';
  const code = `EBR-${isTrial ? 'TRL-' : ''}${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${batchNumber}`;

  const ebr = await query(
    `INSERT INTO ebrs (ebr_code, mbr_id, mbr_code, batch_number, product_name, product_code, batch_size, status, line, operator_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Ready',$8,$9,$9) RETURNING *`,
    [code, mbrId, mbr.rows[0].mbr_code, batchNumber, mbr.rows[0].product_name, mbr.rows[0].product_code, mbr.rows[0].batch_size, batchType, operatorId]
  );

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
        [ebr.rows[0].id, step.id, stepNum, step.step_name || 'Step '+stepNum, phase.phase_name, step.instruction || '',
         step.is_critical || false, step.is_gmp_critical || false, step.duration_min ? Math.round(parseFloat(step.duration_min)) : null]
      );

      // M-004 ebr_parameter_values: step_id(VARCHAR), param_id(VARCHAR), target_value(DECIMAL), is_oos, is_cpp — NO step_execution_id, NO is_cqa, NO created_at
      const params = await query('SELECT * FROM mbr_step_parameters WHERE step_id=$1', [step.id]);
      for (const p of params.rows) {
        const tv = parseFloat(p.target_value);
        await query(
          'INSERT INTO ebr_parameter_values (ebr_id, step_id, param_id, param_name, target_value, unit, lower_limit, upper_limit, is_cpp) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [ebr.rows[0].id, exec.rows[0].id, p.id, p.param_name, isNaN(tv) ? null : tv, p.unit, p.lower_limit, p.upper_limit, p.is_cpp || false]
        );
      }
    }
  }

  return ebr.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 2. STEP EXECUTION
// ════════════════════════════════════════════════════════════════

async function startStep(stepExecId, operatorId) {
  const step = await query('SELECT ebr_id FROM ebr_step_executions WHERE id=$1', [stepExecId]);
  if (step.rows.length > 0) {
    await query("UPDATE ebrs SET status='In Progress', started_at=COALESCE(started_at, NOW()), updated_at=NOW() WHERE id=$1 AND status='Ready'", [step.rows[0].ebr_id]);
  }
  const r = await query(
    "UPDATE ebr_step_executions SET status='In Progress', operator_id=$1, started_at=NOW() WHERE id=$2 AND status='Pending' RETURNING *",
    [operatorId, stepExecId]);
  return r.rows[0];
}

async function completeStep(stepExecId, operatorId, notes, actualDurationMin) {
  const r = await query(
    `UPDATE ebr_step_executions SET status='Completed', operator_id=COALESCE($1,operator_id),
     completed_at=NOW(), actual_duration_min=$2, deviation_notes=$3 WHERE id=$4 RETURNING *`,
    [operatorId, actualDurationMin, notes, stepExecId]);
  return r.rows[0];
}

async function verifyStep(stepExecId, verifierId) {
  const r = await query(
    "UPDATE ebr_step_executions SET status='Verified', verifier_id=$1, verified_at=NOW() WHERE id=$2 RETURNING *",
    [verifierId, stepExecId]);
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 3. PARAMETER RECORDING
// M-004 ebr_parameter_values: actual_value is DECIMAL, is_oos BOOLEAN
// ════════════════════════════════════════════════════════════════

async function recordParameterValue(paramValueId, actualValue, recordedBy) {
  const param = await query('SELECT * FROM ebr_parameter_values WHERE id=$1', [paramValueId]);
  if (param.rows.length === 0) return { error: 'Parameter not found' };
  const p = param.rows[0];

  const numVal = parseFloat(actualValue);
  const lower = parseFloat(p.lower_limit);
  const upper = parseFloat(p.upper_limit);
  const inSpec = (!isNaN(numVal) && !isNaN(lower) && !isNaN(upper)) ? (numVal >= lower && numVal <= upper) : null;

  // M-004 uses is_oos (inverse of in_spec), actual_value is DECIMAL
  await query(
    'UPDATE ebr_parameter_values SET actual_value=$1, is_oos=$2, recorded_by=$3, recorded_at=NOW() WHERE id=$4',
    [isNaN(numVal) ? null : numVal, inSpec === false, recordedBy, paramValueId]
  );

  return { id: paramValueId, actual_value: actualValue, in_spec: inSpec, is_oos: inSpec === false, is_cpp: p.is_cpp, param_name: p.param_name };
}

// ════════════════════════════════════════════════════════════════
// 4. DEVIATIONS (ebr_deviations = M-007 schema)
// ════════════════════════════════════════════════════════════════

async function createDeviation({ ebrId, step_execution_id, deviation_type, severity, description, immediate_action, reportedBy }) {
  // step_execution_id can be null (for batch-level deviations)
  const r = await query(
    `INSERT INTO ebr_deviations (ebr_id, step_execution_id, deviation_type, severity, description, immediate_action, reported_by, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'Open') RETURNING *`,
    [ebrId, step_execution_id || null, deviation_type || 'Process Deviation', severity || 'Major', description, immediate_action || '', reportedBy]);
  return r.rows[0];
}

async function resolveDeviation(deviationId, rootCause, correctiveAction, resolvedBy) {
  const r = await query(
    "UPDATE ebr_deviations SET status='Resolved', root_cause=$1, corrective_action=$2, resolved_by=$3, resolved_at=NOW() WHERE id=$4 RETURNING *",
    [rootCause, correctiveAction, resolvedBy, deviationId]);
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 5. MATERIAL, EQUIPMENT, IPC
// ════════════════════════════════════════════════════════════════

async function recordMaterialConsumption(data) {
  const { ebrId, step_execution_id, material_code, material_name, lot_number, quantity_dispensed, unit, dispensedBy } = data;
  const r = await query(
    `INSERT INTO ebr_material_consumptions (ebr_id, step_execution_id, material_code, material_name, lot_number, quantity_dispensed, unit, dispensed_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [ebrId, step_execution_id, material_code, material_name, lot_number, quantity_dispensed, unit, dispensedBy]);
  return r.rows[0];
}

async function verifyMaterial(consumptionId, verifierId) {
  const r = await query(
    "UPDATE ebr_material_consumptions SET verified_by=$1, verified_at=NOW() WHERE id=$2 RETURNING *",
    [verifierId, consumptionId]);
  return r.rows[0];
}

// M-007 ebr_equipment_usage: NO equipment_type column
async function logEquipmentUsage(data) {
  const { ebrId, step_execution_id, equipment_code, equipment_name, loggedBy } = data;
  const r = await query(
    `INSERT INTO ebr_equipment_usage (ebr_id, step_execution_id, equipment_code, equipment_name, logged_by)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [ebrId, step_execution_id, equipment_code, equipment_name, loggedBy]);
  return r.rows[0];
}

async function recordIPCResult(data) {
  const { ebrId, step_execution_id, check_name, check_type, specification, actual_result, unit, pass_fail, testedBy } = data;
  const r = await query(
    `INSERT INTO ebr_ipc_results (ebr_id, step_execution_id, check_name, check_type, specification, actual_result, unit, pass_fail, tested_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [ebrId, step_execution_id, check_name, check_type, specification, actual_result, unit, pass_fail, testedBy]);
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 6. BATCH COMPLETION & RELEASE
// M-007 ebr_release_signatures: signature_role, signer_id, signer_email, signature_meaning, password_verified — NO decision, NO notes
// ════════════════════════════════════════════════════════════════

async function completeBatch(ebrId) {
  const steps = await query('SELECT status FROM ebr_step_executions WHERE ebr_id=$1', [ebrId]);
  const pending = steps.rows.filter(s => s.status !== 'Completed' && s.status !== 'Verified');
  if (pending.length > 0) return { error: `${pending.length} steps not completed` };
  const r = await query("UPDATE ebrs SET status='Complete', completed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *", [ebrId]);
  return r.rows[0];
}

async function releaseBatch(ebrId, decision, notes, userId, email) {
  if (!['Released', 'Rejected'].includes(decision)) return { error: 'Decision must be Released or Rejected' };

  // Get email from DB if not provided
  let signerEmail = email;
  if (!signerEmail) {
    const u = await query('SELECT email FROM users WHERE id=$1', [userId]);
    signerEmail = u.rows[0]?.email || 'system@pharmambr.com';
  }

  // Use 'QA_Approver' as signature_role (matches CHECK constraint from earlier migration)
  // Store the actual decision (Released/Rejected) in signature_meaning
  // Try to drop the CHECK constraint first (safe — no error if doesn't exist)
  try { await query("ALTER TABLE ebr_release_signatures DROP CONSTRAINT IF EXISTS ebr_release_signatures_signature_role_check"); } catch {}

  // Insert signature FIRST
  await query(
    `INSERT INTO ebr_release_signatures (ebr_id, signature_role, signer_id, signer_email, signature_meaning, password_verified)
     VALUES ($1,$2,$3,$4,$5,true)`,
    [ebrId, 'QA_Approver', userId, signerEmail, `${decision}: ${notes || 'Batch ' + decision.toLowerCase() + ' by QA'}`]
  );

  // Only update status after signature succeeds
  const r = await query(`UPDATE ebrs SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *`, [decision, ebrId]);
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// 7. QUERIES
// ════════════════════════════════════════════════════════════════

async function getEBR(ebrId) {
  const ebr = await query(
    `SELECT e.*, m.product_code, m.dosage_form, u.full_name as operator_name
     FROM ebrs e LEFT JOIN mbrs m ON e.mbr_id=m.id LEFT JOIN users u ON e.operator_id=u.id WHERE e.id=$1`, [ebrId]);
  if (ebr.rows.length === 0) return null;

  const steps = await query('SELECT * FROM ebr_step_executions WHERE ebr_id=$1 ORDER BY step_number', [ebrId]);
  // M-004 ebr_parameter_values: ORDER BY recorded_at, link via step_id
  const params = await query('SELECT * FROM ebr_parameter_values WHERE ebr_id=$1 ORDER BY recorded_at', [ebrId]);
  const deviations = await query('SELECT * FROM ebr_deviations WHERE ebr_id=$1 ORDER BY created_at', [ebrId]);

  let materials = { rows: [] }, equipment = { rows: [] }, ipc = { rows: [] }, yields = { rows: [] }, signatures = { rows: [] };
  try { materials = await query('SELECT * FROM ebr_material_consumptions WHERE ebr_id=$1 ORDER BY created_at', [ebrId]); } catch {}
  try { equipment = await query('SELECT * FROM ebr_equipment_usage WHERE ebr_id=$1 ORDER BY created_at', [ebrId]); } catch {}
  try { ipc = await query('SELECT * FROM ebr_ipc_results WHERE ebr_id=$1 ORDER BY created_at', [ebrId]); } catch {}
  try { yields = await query('SELECT * FROM ebr_yield_records WHERE ebr_id=$1 ORDER BY created_at', [ebrId]); } catch {}
  try { signatures = await query('SELECT * FROM ebr_release_signatures WHERE ebr_id=$1 ORDER BY signed_at', [ebrId]); } catch {}

  // M-004 uses step_id to link params to steps
  const stepsWithData = steps.rows.map(s => ({
    ...s,
    parameters: params.rows.filter(p => String(p.step_id || p.step_execution_id) === String(s.id)),
    materials: materials.rows.filter(m => String(m.step_execution_id) === String(s.id)),
    equipment: equipment.rows.filter(eq => String(eq.step_execution_id) === String(s.id)),
    ipc_results: ipc.rows.filter(i => String(i.step_execution_id) === String(s.id)),
    deviations: deviations.rows.filter(d => String(d.step_execution_id) === String(s.id)),
  }));

  return {
    ...ebr.rows[0],
    steps: stepsWithData,
    deviations: deviations.rows,
    yields: yields.rows,
    release_signatures: signatures.rows,
    summary: {
      total_steps: steps.rows.length,
      completed_steps: steps.rows.filter(s => s.status === 'Completed' || s.status === 'Verified').length,
      total_params: params.rows.length,
      recorded_params: params.rows.filter(p => p.actual_value !== null).length,
      out_of_spec: params.rows.filter(p => p.is_oos === true).length,
      total_deviations: deviations.rows.length,
      open_deviations: deviations.rows.filter(d => d.status === 'Open').length,
    },
  };
}

async function listEBRs(filters = {}) {
  let sql = `SELECT e.*, u.full_name as operator_name,
    (SELECT COUNT(*) FROM ebr_step_executions WHERE ebr_id=e.id) as total_steps,
    (SELECT COUNT(*) FROM ebr_step_executions WHERE ebr_id=e.id AND status IN ('Completed','Verified')) as completed_steps,
    (SELECT COUNT(*) FROM ebr_deviations WHERE ebr_id=e.id AND status='Open') as open_deviations
    FROM ebrs e LEFT JOIN users u ON e.operator_id=u.id WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND e.status=$${i++}`; params.push(filters.status); }
  if (filters.mbr_id) { sql += ` AND e.mbr_id=$${i++}`; params.push(filters.mbr_id); }
  sql += ' ORDER BY e.created_at DESC';
  return (await query(sql, params)).rows;
}

module.exports = {
  createEBR, startStep, completeStep, verifyStep,
  recordParameterValue, createDeviation, resolveDeviation,
  recordMaterialConsumption, verifyMaterial,
  logEquipmentUsage, recordIPCResult,
  completeBatch, releaseBatch,
  getEBR, listEBRs,
};
