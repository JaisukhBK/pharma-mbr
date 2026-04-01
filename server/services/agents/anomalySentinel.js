// server/services/agents/anomalySentinel.js
// PharmaMES.AI — EBR Anomaly Sentinel Agent
// Fires automatically on step completion.
// Scans all recorded parameter values for the step and flags:
//   - Values approaching limits (within 10% of spec boundary)
//   - Trends across multiple parameters suggesting process drift
//   - Equipment condition correlation with parameter excursions
// Stores findings in Neon. Does NOT create deviations — only flags warnings.

'use strict';

const Groq   = require('groq-sdk');
const { query } = require('../../db/pool');
const { logAudit } = require('../../middleware/middleware');

const MODEL = 'llama-3.3-70b-versatile';

function getGroq() {
  if (!process.env.GROQ_API_KEY) return null;
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

const SENTINEL_SYSTEM_PROMPT = `You are a pharmaceutical manufacturing process monitoring AI sentinel.
Your role is to detect anomalies and early warning signs BEFORE they become OOS events.

Analyze the provided step execution data and identify:
1. Parameters approaching specification limits (trending toward OOS)
2. Unusual parameter combinations that suggest process drift
3. Equipment-related risk factors
4. Comparisons to historical batch performance

You are a MONITORING system only — you flag concerns for human review, never make production decisions.
Always respond in valid JSON only.`;

const SENTINEL_SCHEMA = `{
  "anomaly_detected": true|false,
  "risk_level": "Critical|High|Medium|Low|None",
  "findings": [
    {
      "type": "ApproachingLimit|ProcessDrift|EquipmentRisk|MaterialRisk|Trend",
      "parameter": "parameter name",
      "observation": "what was observed",
      "actual_value": "value",
      "limit": "which limit and value",
      "proximity_pct": 0-100,
      "recommendation": "specific action to take"
    }
  ],
  "process_stability": "Stable|Monitor|Unstable",
  "recommended_actions": ["action 1", "action 2"],
  "summary": "1-2 sentence summary for the operator"
}`;

// ── Compute proximity to spec limits ─────────────────────────────────────────
function computeProximity(actual, lower, upper) {
  const val = parseFloat(actual);
  if (isNaN(val)) return null;

  const lo = lower !== null ? parseFloat(lower) : null;
  const hi = upper !== null ? parseFloat(upper) : null;

  if (lo === null && hi === null) return null;

  const range = (hi !== null && lo !== null) ? hi - lo : null;
  if (!range) return null;

  // How close to either boundary (0 = at boundary, 100 = at center)
  const distToLo = lo !== null ? Math.abs(val - lo) : Infinity;
  const distToHi = hi !== null ? Math.abs(val - hi) : Infinity;
  const minDist  = Math.min(distToLo, distToHi);

  return Math.round((1 - minDist / (range / 2)) * 100);
}

// ── Main sentinel function ────────────────────────────────────────────────────
async function runAnomalySentinel(ebrId, stepExecId, stepName) {
  const groq = getGroq();
  if (!groq) return null;

  console.log(`[SENTINEL] Scanning step "${stepName}" (EBR ${ebrId})`);

  // Get all parameter values for this step
  let params = [];
  try {
    const r = await query(
      `SELECT * FROM ebr_parameter_values
       WHERE step_execution_id = $1
       ORDER BY recorded_at`,
      [stepExecId]
    );
    params = r.rows;
  } catch (_) {}

  if (!params.length) {
    console.log('[SENTINEL] No parameters to scan');
    return null;
  }

  // Pre-screen: check for near-limit values (within 15% of spec range)
  const nearLimit = params.filter(p => {
    if (!p.actual_value) return false;
    const proximity = computeProximity(p.actual_value, p.lower_limit, p.upper_limit);
    return proximity !== null && proximity >= 75; // 75%+ means within 25% of boundary
  });

  // Get EBR context
  let ebrContext = {};
  try {
    const ebr = await query(
      `SELECT e.batch_number, e.product_name, e.status,
              m.dosage_form, m.batch_size
       FROM ebrs e LEFT JOIN mbrs m ON e.mbr_id = m.id
       WHERE e.id = $1`,
      [ebrId]
    );
    if (ebr.rows.length) ebrContext = ebr.rows[0];
  } catch (_) {}

  // Get historical step data for same step name on same product
  let historicalData = [];
  try {
    const hist = await query(
      `SELECT epv.param_name, epv.actual_value, epv.in_spec,
              e.batch_number, ese.completed_at
       FROM ebr_parameter_values epv
       JOIN ebr_step_executions ese ON epv.step_execution_id = ese.id
       JOIN ebrs e ON ese.ebr_id = e.id
       WHERE ese.step_name = $1
         AND e.product_name = $2
         AND e.id != $3
       ORDER BY ese.completed_at DESC
       LIMIT 20`,
      [stepName, ebrContext.product_name || '', ebrId]
    );
    historicalData = hist.rows;
  } catch (_) {}

  // Build enriched parameter list with proximity scores
  const enrichedParams = params.map(p => ({
    name:         p.param_name,
    target:       p.target_value,
    actual:       p.actual_value,
    lower_limit:  p.lower_limit,
    upper_limit:  p.upper_limit,
    unit:         p.unit,
    in_spec:      p.in_spec,
    is_cpp:       p.is_cpp,
    proximity_to_limit_pct: computeProximity(p.actual_value, p.lower_limit, p.upper_limit),
  }));

  const userPrompt = `STEP COMPLETION ANALYSIS:
Step: ${stepName}
Batch: ${ebrContext.batch_number || ebrId}
Product: ${ebrContext.product_name || 'Unknown'}

PARAMETER VALUES RECORDED:
${JSON.stringify(enrichedParams, null, 2)}

PARAMETERS NEAR SPEC LIMITS (>75% proximity to boundary):
${nearLimit.length ? JSON.stringify(nearLimit.map(p => p.param_name), null, 2) : 'None'}

HISTORICAL DATA (last 20 same-step executions for this product):
${historicalData.length ? JSON.stringify(historicalData.slice(0, 10), null, 2) : 'No historical data available'}

Analyze for anomalies and respond ONLY with JSON matching this schema:
${SENTINEL_SCHEMA}`;

  try {
    const completion = await groq.chat.completions.create({
      model:       MODEL,
      messages:    [
        { role: 'system', content: SENTINEL_SYSTEM_PROMPT },
        { role: 'user',   content: userPrompt },
      ],
      temperature:     0.1,
      max_tokens:      1500,
      response_format: { type: 'json_object' },
    });

    const result = JSON.parse(completion.choices[0].message.content);

    // Only persist if anomaly detected or risk is not None/Low
    if (result.anomaly_detected || ['Critical', 'High', 'Medium'].includes(result.risk_level)) {
      // Store as a step note on the execution record
      await query(
        `UPDATE ebr_step_executions
         SET deviation_notes = COALESCE(deviation_notes || ' | ', '') || $1
         WHERE id = $2`,
        [
          `[AI-SENTINEL ${new Date().toISOString()}] ${result.risk_level} risk — ${result.summary}`,
          stepExecId,
        ]
      );

      logAudit({
        userId:       'SYSTEM',
        action:       'AI_SENTINEL',
        resourceType: 'EBR_STEP',
        resourceId:   stepExecId,
        details:      `Anomaly Sentinel: ${result.risk_level} — ${result.summary?.substring(0, 120) || 'Anomaly detected'}`,
        aiGenerated:  true,
      });

      console.log(`[SENTINEL] ${result.risk_level} anomaly detected in step "${stepName}" — ${result.findings?.length || 0} findings`);
    } else {
      console.log(`[SENTINEL] Step "${stepName}" — ${result.process_stability || 'Stable'}, no anomalies`);
    }

    return result;

  } catch (err) {
    console.error('[SENTINEL] Error:', err.message);
    return null;
  }
}

module.exports = { runAnomalySentinel };
