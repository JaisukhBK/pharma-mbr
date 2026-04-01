// server/services/aiGovernanceService.js — AI/ML Governance Controls
// GAMP5 D11 | ISPE GAMP Guide: Artificial Intelligence (2025)

const crypto = require('crypto');
const { query } = require('../db/pool');

// ═══ MODEL REGISTRY ═══

async function registerModel({ modelName, modelVersion, provider, promptVersion, description, riskLevel, validatedBy }) {
  const promptHash = promptVersion ? crypto.createHash('sha256').update(promptVersion).digest('hex') : null;
  const r = await query(
    `INSERT INTO ai_model_registry (model_name, model_version, provider, prompt_hash, prompt_version, description, risk_level, validated_by, validated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW()) RETURNING *`,
    [modelName, modelVersion, provider, promptHash, promptVersion, description, riskLevel || 'Medium', validatedBy]
  );
  return r.rows[0];
}

async function getModels(status) {
  let sql = 'SELECT * FROM ai_model_registry';
  const params = [];
  if (status) { sql += ' WHERE status=$1'; params.push(status); }
  sql += ' ORDER BY created_at DESC';
  const r = await query(sql, params);
  return r.rows;
}

async function updateModelStatus(modelId, status, userId) {
  const r = await query(
    'UPDATE ai_model_registry SET status=$1, updated_at=NOW() WHERE id=$2 RETURNING *',
    [status, modelId]
  );
  return r.rows[0];
}

// ═══ PERFORMANCE METRICS ═══

async function recordMetrics(modelId, periodStart, periodEnd) {
  // Calculate from co_designer_proposals
  const r = await query(
    `SELECT
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status='accepted') as accepted,
       COUNT(*) FILTER (WHERE status='rejected') as rejected,
       COUNT(*) FILTER (WHERE status='modified') as modified,
       AVG(confidence) as avg_confidence
     FROM co_designer_proposals
     WHERE created_at >= $1 AND created_at < $2`,
    [periodStart, periodEnd]
  );

  const data = r.rows[0];
  const total = parseInt(data.total) || 0;
  const acceptanceRate = total > 0 ? (parseInt(data.accepted) || 0) / total : 0;

  const ins = await query(
    `INSERT INTO ai_performance_metrics (model_id, period_start, period_end, total_proposals, accepted, rejected, modified, avg_confidence, acceptance_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [modelId, periodStart, periodEnd, total, data.accepted || 0, data.rejected || 0, data.modified || 0, data.avg_confidence, acceptanceRate]
  );
  return ins.rows[0];
}

async function getMetricsHistory(modelId) {
  const r = await query(
    'SELECT * FROM ai_performance_metrics WHERE model_id=$1 ORDER BY period_start DESC',
    [modelId]
  );
  return r.rows;
}

// ═══ DRIFT DETECTION ═══

async function detectDrift(modelId, thresholdDrop = 0.1) {
  const metrics = await query(
    'SELECT * FROM ai_performance_metrics WHERE model_id=$1 ORDER BY period_start DESC LIMIT 6',
    [modelId]
  );
  if (metrics.rows.length < 2) return { drift_detected: false, reason: 'Insufficient data (need 2+ periods)' };

  const latest = metrics.rows[0];
  const previous = metrics.rows[1];

  const rateDrop = (parseFloat(previous.acceptance_rate) || 0) - (parseFloat(latest.acceptance_rate) || 0);
  const confDrop = (parseFloat(previous.avg_confidence) || 0) - (parseFloat(latest.avg_confidence) || 0);

  const driftDetected = rateDrop > thresholdDrop || confDrop > thresholdDrop;

  return {
    drift_detected: driftDetected,
    latest_period: { start: latest.period_start, end: latest.period_end, acceptance_rate: latest.acceptance_rate, avg_confidence: latest.avg_confidence },
    previous_period: { start: previous.period_start, end: previous.period_end, acceptance_rate: previous.acceptance_rate, avg_confidence: previous.avg_confidence },
    acceptance_rate_drop: rateDrop.toFixed(3),
    confidence_drop: confDrop.toFixed(3),
    threshold: thresholdDrop,
    recommendation: driftDetected ? 'Model performance has degraded. Review prompt engineering, training data, or consider model update.' : 'Performance within acceptable range.',
  };
}

module.exports = { registerModel, getModels, updateModelStatus, recordMetrics, getMetricsHistory, detectDrift };
