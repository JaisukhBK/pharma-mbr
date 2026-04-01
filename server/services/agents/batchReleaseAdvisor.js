// server/services/agents/batchReleaseAdvisor.js
// PharmaMES.AI — Batch Release Advisor Agent
// Fires automatically when a batch is marked Complete.
// Aggregates deviations, IPC results, yield, and parameter OOS count
// then gives QA a structured release recommendation with risk summary.
// The recommendation is advisory only — QA makes the final decision.
// 21 CFR 211.192 — Production record review requirement.

'use strict';

const Groq   = require('groq-sdk');
const { query } = require('../../db/pool');
const { logAudit } = require('../../middleware/middleware');

const MODEL = 'llama-3.3-70b-versatile';

function getGroq() {
  if (!process.env.GROQ_API_KEY) return null;
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

const ADVISOR_SYSTEM_PROMPT = `You are a pharmaceutical Quality Assurance batch release advisor AI.
Your role is to review completed Electronic Batch Records and provide a structured release recommendation
in compliance with 21 CFR 211.192 (Production record review) and ICH Q10.

Review the batch data provided and produce a release recommendation.
You are ADVISORY ONLY — the final release decision must be made by a qualified QA person.
Always respond in valid JSON only.`;

const ADVISOR_SCHEMA = `{
  "recommendation": "Release|Conditional Release|Hold|Reject",
  "confidence": "High|Medium|Low",
  "overall_quality_score": 0-100,
  "checklist": {
    "all_steps_completed": true|false,
    "no_open_deviations": true|false,
    "yield_within_spec": true|false,
    "ipc_all_passed": true|false,
    "materials_all_released": true|false,
    "no_critical_oos": true|false
  },
  "risk_factors": [
    {
      "factor": "description of risk",
      "severity": "Critical|Major|Minor",
      "impact": "impact on patient safety or product quality"
    }
  ],
  "conditions_for_release": ["condition 1 if conditional release", "condition 2"],
  "regulatory_flags": ["any 21 CFR or ICH Q10 considerations"],
  "summary_for_qa": "3-4 sentence professional summary for the QA reviewer",
  "batch_quality_narrative": "narrative of what happened in this batch from quality perspective"
}`;

// ── Gather all batch data ─────────────────────────────────────────────────────
async function gatherBatchData(ebrId) {
  const data = {};

  // Core EBR
  try {
    const ebr = await query(
      `SELECT e.*, m.product_name as mbr_product, m.dosage_form, m.batch_size as target_batch_size,
              u.full_name as operator_name
       FROM ebrs e
       LEFT JOIN mbrs m ON e.mbr_id = m.id
       LEFT JOIN users u ON e.operator_id = u.id
       WHERE e.id = $1`,
      [ebrId]
    );
    data.ebr = ebr.rows[0];
  } catch (_) {}

  // Step execution summary
  try {
    const steps = await query(
      `SELECT step_name, phase_name, status, is_critical, is_gmp_critical,
              started_at, completed_at, actual_duration_min,
              (SELECT COUNT(*) FROM ebr_deviations WHERE step_execution_id=ese.id) as deviations
       FROM ebr_step_executions ese
       WHERE ebr_id = $1
       ORDER BY step_number`,
      [ebrId]
    );
    data.steps = steps.rows;
    data.step_summary = {
      total:       steps.rows.length,
      completed:   steps.rows.filter(s => s.status === 'Completed').length,
      critical_completed: steps.rows.filter(s => s.is_critical && s.status === 'Completed').length,
      critical_total:     steps.rows.filter(s => s.is_critical).length,
    };
  } catch (_) {}

  // Parameter OOS summary
  try {
    const params = await query(
      `SELECT param_name, actual_value, target_value, lower_limit, upper_limit,
              unit, in_spec, is_cpp, is_cqa
       FROM ebr_parameter_values
       WHERE ebr_id = $1`,
      [ebrId]
    );
    data.parameters = {
      total:     params.rows.length,
      oos:       params.rows.filter(p => p.in_spec === false),
      cpp_oos:   params.rows.filter(p => p.in_spec === false && p.is_cpp),
      cqa_oos:   params.rows.filter(p => p.in_spec === false && p.is_cqa),
      all_params: params.rows,
    };
  } catch (_) {}

  // Deviations
  try {
    const devs = await query(
      `SELECT deviation_type, severity, description, status, root_cause,
              corrective_action, created_at
       FROM ebr_deviations
       WHERE ebr_id = $1
       ORDER BY created_at`,
      [ebrId]
    );
    data.deviations = {
      total:    devs.rows.length,
      open:     devs.rows.filter(d => d.status === 'Open').length,
      critical: devs.rows.filter(d => d.severity === 'Critical').length,
      major:    devs.rows.filter(d => d.severity === 'Major').length,
      all:      devs.rows,
    };
  } catch (_) {}

  // IPC results
  try {
    const ipc = await query(
      `SELECT check_name, check_type, specification, actual_result, pass_fail, tested_at
       FROM ebr_ipc_results
       WHERE ebr_id = $1
       ORDER BY tested_at`,
      [ebrId]
    );
    data.ipc = {
      total:  ipc.rows.length,
      passed: ipc.rows.filter(i => i.pass_fail === 'Pass').length,
      failed: ipc.rows.filter(i => i.pass_fail === 'Fail').length,
      all:    ipc.rows,
    };
  } catch (_) {}

  // Yield records
  try {
    const yields = await query(
      `SELECT phase_name, stage, theoretical_qty, actual_qty, yield_pct, unit
       FROM ebr_yield_records
       WHERE ebr_id = $1
       ORDER BY created_at`,
      [ebrId]
    );
    data.yields = yields.rows;
    const finalYield = yields.rows.find(y => y.stage === 'Final') || yields.rows[yields.rows.length - 1];
    data.final_yield_pct = finalYield?.yield_pct || null;
  } catch (_) {}

  // Material lots
  try {
    const mats = await query(
      `SELECT mc.material_name, mc.lot_number, mc.quantity_required,
              mc.quantity_dispensed, mc.unit, mc.expiry_date,
              ml.status as lot_status, ml.supplier
       FROM ebr_material_consumptions mc
       LEFT JOIN material_lots ml ON mc.lot_number = ml.lot_number
       WHERE mc.ebr_id = $1`,
      [ebrId]
    );
    data.materials = {
      all:                  mats.rows,
      unreleased_lots:      mats.rows.filter(m => m.lot_status && m.lot_status !== 'Released'),
      expired_lots:         mats.rows.filter(m => m.expiry_date && new Date(m.expiry_date) < new Date()),
    };
  } catch (_) {}

  return data;
}

// ── Main advisor function ─────────────────────────────────────────────────────
async function runReleaseAdvisor(ebrId) {
  const groq = getGroq();
  if (!groq) {
    console.log('[RELEASE-ADVISOR] Skipped — GROQ_API_KEY not set');
    return null;
  }

  console.log(`[RELEASE-ADVISOR] Generating release recommendation for EBR ${ebrId}`);

  const batchData = await gatherBatchData(ebrId);

  if (!batchData.ebr) {
    console.error('[RELEASE-ADVISOR] EBR not found:', ebrId);
    return null;
  }

  const userPrompt = `BATCH RELEASE REVIEW:

BATCH INFORMATION:
${JSON.stringify({
  batch_number:  batchData.ebr?.batch_number,
  product:       batchData.ebr?.product_name,
  batch_size:    batchData.ebr?.batch_size,
  operator:      batchData.ebr?.operator_name,
  started:       batchData.ebr?.started_at,
  completed:     batchData.ebr?.completed_at,
}, null, 2)}

STEP EXECUTION SUMMARY:
Total steps: ${batchData.step_summary?.total || 0}
Completed: ${batchData.step_summary?.completed || 0}
Critical steps completed: ${batchData.step_summary?.critical_completed || 0}/${batchData.step_summary?.critical_total || 0}

PARAMETER OOS SUMMARY:
Total parameters: ${batchData.parameters?.total || 0}
OOS parameters: ${batchData.parameters?.oos?.length || 0}
CPP (Critical Process Parameter) OOS: ${batchData.parameters?.cpp_oos?.length || 0}
CQA (Critical Quality Attribute) OOS: ${batchData.parameters?.cqa_oos?.length || 0}
OOS Details: ${JSON.stringify(batchData.parameters?.oos || [], null, 2)}

DEVIATIONS:
Total: ${batchData.deviations?.total || 0}
Open (unresolved): ${batchData.deviations?.open || 0}
Critical: ${batchData.deviations?.critical || 0}
Major: ${batchData.deviations?.major || 0}
Details: ${JSON.stringify(batchData.deviations?.all?.slice(0, 10) || [], null, 2)}

IPC RESULTS:
Total: ${batchData.ipc?.total || 0}
Passed: ${batchData.ipc?.passed || 0}
Failed: ${batchData.ipc?.failed || 0}
Failed tests: ${JSON.stringify(batchData.ipc?.all?.filter(i => i.pass_fail === 'Fail') || [], null, 2)}

YIELD:
Final yield: ${batchData.final_yield_pct ? batchData.final_yield_pct + '%' : 'Not recorded'}
Yield records: ${JSON.stringify(batchData.yields || [], null, 2)}

MATERIAL LOTS:
${JSON.stringify({
  unreleased: batchData.materials?.unreleased_lots?.length || 0,
  expired:    batchData.materials?.expired_lots?.length || 0,
}, null, 2)}

Respond ONLY with JSON matching this schema:
${ADVISOR_SCHEMA}`;

  try {
    const completion = await groq.chat.completions.create({
      model:       MODEL,
      messages:    [
        { role: 'system', content: ADVISOR_SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      temperature:     0.2,
      max_tokens:      2000,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0].message.content);

    // Store recommendation on the EBR
    await query(
      `UPDATE ebrs
       SET release_notes = $1, updated_at = NOW()
       WHERE id = $2`,
      [
        JSON.stringify({
          ai_recommendation: result,
          generated_at:      new Date().toISOString(),
          model:             MODEL,
          requires_qa_review: true,
        }),
        ebrId,
      ]
    );

    logAudit({
      userId:       'SYSTEM',
      action:       'AI_RELEASE_ADVISORY',
      resourceType: 'EBR',
      resourceId:   ebrId,
      details:      `Release Advisor: ${result.recommendation} (${result.confidence} confidence) — score ${result.overall_quality_score}/100`,
      aiGenerated:  true,
    });

    console.log(`[RELEASE-ADVISOR] Recommendation: ${result.recommendation} | Score: ${result.overall_quality_score}/100 | Confidence: ${result.confidence}`);
    return result;

  } catch (err) {
    console.error('[RELEASE-ADVISOR] Error:', err.message);
    return null;
  }
}

module.exports = { runReleaseAdvisor };
