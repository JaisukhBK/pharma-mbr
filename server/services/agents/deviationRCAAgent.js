// server/services/agents/deviationRCAAgent.js
// PharmaMES.AI — Deviation Root Cause Analysis Agent
// Fires automatically when an OOS parameter is recorded.
// Uses Groq/Llama to reason over equipment history, material lots,
// and process parameter context — returns structured root cause + CAPA actions.
// GAMP5 D11 — AI-assisted quality decisions require human review.

'use strict';

const Groq   = require('groq-sdk');
const { query } = require('../../db/pool');
const { logAudit } = require('../../middleware/middleware');

const MODEL = 'llama-3.3-70b-versatile';

function getGroq() {
  if (!process.env.GROQ_API_KEY) return null;
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// ── System prompt ─────────────────────────────────────────────────────────────
const RCA_SYSTEM_PROMPT = `You are a pharmaceutical manufacturing Root Cause Analysis (RCA) expert 
with deep knowledge of ICH Q9 (Quality Risk Management), GAMP5, and 21 CFR Part 211.

When given an out-of-specification (OOS) event with supporting context, you must:
1. Identify the most probable root cause using the 6M framework (Man, Machine, Method, Material, Measurement, Mother Nature/Environment)
2. Provide a structured 5-Why analysis drilling into the highest probability cause
3. Suggest specific, actionable CAPA recommendations

Always respond in valid JSON only. No markdown, no preamble.`;

const RCA_SCHEMA = `{
  "root_causes": [
    {
      "cause": "specific root cause description",
      "category": "Machine|Method|Material|Man|Measurement|Environment",
      "probability": "High|Medium|Low",
      "evidence": "specific data point supporting this cause",
      "confidence_score": 0.0-1.0
    }
  ],
  "five_why": [
    { "why": 1, "question": "Why did X happen?", "answer": "Because Y" },
    { "why": 2, "question": "Why did Y happen?", "answer": "Because Z" },
    { "why": 3, "question": "...", "answer": "..." },
    { "why": 4, "question": "...", "answer": "..." },
    { "why": 5, "question": "...", "answer": "Root cause identified" }
  ],
  "capa_recommendations": [
    {
      "action": "specific corrective/preventive action",
      "type": "Corrective|Preventive",
      "priority": "Critical|High|Medium|Low",
      "owner": "Production|QA|Engineering|Management",
      "timeframe": "Immediate|Within 7 days|Within 30 days|Within 90 days",
      "rationale": "why this action addresses the root cause"
    }
  ],
  "risk_assessment": {
    "patient_safety_risk": "High|Medium|Low",
    "product_quality_risk": "High|Medium|Low",
    "regulatory_risk": "High|Medium|Low",
    "immediate_actions_required": true|false
  },
  "summary": "2-3 sentence executive summary of the RCA findings"
}`;

// ── Build context for the agent ───────────────────────────────────────────────
async function buildContext(ebrId, paramName, actualValue, limits, equipmentId) {
  const ctx = {};

  // EBR details
  try {
    const ebr = await query(
      `SELECT e.*, m.product_name as mbr_product, m.dosage_form
       FROM ebrs e LEFT JOIN mbrs m ON e.mbr_id = m.id
       WHERE e.id = $1`,
      [ebrId]
    );
    if (ebr.rows.length) ctx.batch = ebr.rows[0];
  } catch (_) {}

  // Equipment history — recent calibrations and deviations
  if (equipmentId) {
    try {
      const eq = await query('SELECT * FROM equipment WHERE id = $1', [equipmentId]);
      const recentCals = await query(
        `SELECT * FROM equipment_calibrations
         WHERE equipment_id = $1 ORDER BY calibration_date DESC LIMIT 3`,
        [equipmentId]
      );
      const eqDevs = await query(
        `SELECT ed.description, ed.severity, ed.created_at
         FROM ebr_deviations ed
         JOIN ebr_step_executions ese ON ed.step_execution_id = ese.id
         JOIN ebrs e ON ese.ebr_id = e.id
         WHERE e.id = $1 OR ed.description ILIKE $2
         ORDER BY ed.created_at DESC LIMIT 5`,
        [ebrId, '%' + paramName + '%']
      );
      ctx.equipment = {
        details:         eq.rows[0] || null,
        calibrations:    recentCals.rows,
        recent_deviations: eqDevs.rows,
      };
    } catch (_) {}
  }

  // Material lots used in this batch
  try {
    const mats = await query(
      `SELECT mc.material_name, mc.lot_number, mc.quantity_required,
              mc.quantity_dispensed, mc.unit, mc.expiry_date,
              ml.supplier, ml.status as lot_status
       FROM ebr_material_consumptions mc
       LEFT JOIN material_lots ml ON mc.lot_number = ml.lot_number
       WHERE mc.ebr_id = $1`,
      [ebrId]
    );
    ctx.materials = mats.rows;
  } catch (_) {}

  // Historical OOS for same parameter on same product
  try {
    const hist = await query(
      `SELECT epv.param_name, epv.actual_value, epv.lower_limit, epv.upper_limit,
              epv.in_spec, e.batch_number, e.product_name, epv.recorded_at
       FROM ebr_parameter_values epv
       JOIN ebrs e ON epv.ebr_id = e.id
       WHERE epv.param_name = $1 AND epv.in_spec = false
         AND e.id != $2
       ORDER BY epv.recorded_at DESC LIMIT 5`,
      [paramName, ebrId]
    );
    ctx.historical_oos = hist.rows;
  } catch (_) {}

  // All parameter values in the current step (trend context)
  try {
    const stepParams = await query(
      `SELECT epv.param_name, epv.actual_value, epv.target_value,
              epv.lower_limit, epv.upper_limit, epv.unit, epv.in_spec
       FROM ebr_parameter_values epv
       WHERE epv.ebr_id = $1
       ORDER BY epv.recorded_at`,
      [ebrId]
    );
    ctx.step_parameters = stepParams.rows;
  } catch (_) {}

  return ctx;
}

// ── Main agent function ───────────────────────────────────────────────────────
async function runRCAAgent(ebrId, deviationId, paramName, actualValue, limits, equipmentId) {
  const groq = getGroq();
  if (!groq) {
    console.log('[RCA-AGENT] Skipped — GROQ_API_KEY not set');
    return null;
  }

  console.log(`[RCA-AGENT] Starting analysis for EBR ${ebrId} — ${paramName}: ${actualValue}`);

  const ctx = await buildContext(ebrId, paramName, actualValue, limits, equipmentId);

  const userPrompt = `OOS EVENT:
Parameter: ${paramName}
Actual Value: ${actualValue}
Specification Limits: ${JSON.stringify(limits)}
Batch: ${ctx.batch?.batch_number || ebrId}
Product: ${ctx.batch?.product_name || 'Unknown'}

EQUIPMENT CONTEXT:
${ctx.equipment ? JSON.stringify(ctx.equipment, null, 2) : 'No equipment data available'}

MATERIAL LOTS USED:
${ctx.materials?.length ? JSON.stringify(ctx.materials, null, 2) : 'No material data'}

HISTORICAL OOS FOR THIS PARAMETER:
${ctx.historical_oos?.length ? JSON.stringify(ctx.historical_oos, null, 2) : 'No historical OOS found — first occurrence'}

ALL PARAMETERS IN THIS STEP:
${ctx.step_parameters?.length ? JSON.stringify(ctx.step_parameters, null, 2) : 'No parameter data'}

Respond ONLY with JSON matching this schema:
${RCA_SCHEMA}`;

  try {
    const completion = await groq.chat.completions.create({
      model:       MODEL,
      messages:    [
        { role: 'system', content: RCA_SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      temperature:    0.2,
      max_tokens:     2000,
      response_format: { type: 'json_object' },
    });

    const raw    = completion.choices[0].message.content;
    const result = JSON.parse(raw);

    // Store RCA result on the deviation record
    await query(
      `UPDATE ebr_deviations
       SET root_cause = $1, updated_at = NOW()
       WHERE id = $2`,
      [
        JSON.stringify({
          ai_analysis:    result,
          analyzed_at:    new Date().toISOString(),
          model:          MODEL,
          requires_review: true,
        }),
        deviationId,
      ]
    );

    logAudit({
      userId:       'SYSTEM',
      action:       'AI_RCA',
      resourceType: 'EBR_DEVIATION',
      resourceId:   deviationId,
      details:      `RCA Agent: ${result.root_causes?.[0]?.cause?.substring(0, 100) || 'Analysis complete'} — ${result.root_causes?.length || 0} causes identified`,
      aiGenerated:  true,
    });

    console.log(`[RCA-AGENT] Analysis complete for deviation ${deviationId} — ${result.root_causes?.length || 0} root causes identified`);
    return result;

  } catch (err) {
    console.error('[RCA-AGENT] Error:', err.message);
    return null;
  }
}

module.exports = { runRCAAgent };
