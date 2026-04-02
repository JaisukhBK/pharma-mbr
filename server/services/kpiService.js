// server/services/kpiService.js — Dashboard KPIs (fixed for M-004 schema)
const { query } = require('../db/pool');

async function getKPIs() {
  const [batches, mbrs, devs, training, equipment] = await Promise.all([
    query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='In Progress') as in_progress, COUNT(*) FILTER (WHERE status='Complete') as completed FROM ebrs"),
    query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='Effective') as effective, COUNT(*) FILTER (WHERE status='Draft') as draft FROM mbrs"),
    query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='Open') as open FROM deviations"),
    query("SELECT COUNT(DISTINCT user_id) as trained_users FROM training_records WHERE status='Completed' AND (expiry_date IS NULL OR expiry_date > NOW())"),
    query("SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status='Available') as available FROM equipment"),
  ]);

  const b = batches.rows[0]; const m = mbrs.rows[0]; const d = devs.rows[0]; const tr = training.rows[0]; const eq = equipment.rows[0];
  return {
    batches: { total: parseInt(b.total), in_progress: parseInt(b.in_progress), completed: parseInt(b.completed) },
    mbrs: { total: parseInt(m.total), effective: parseInt(m.effective), draft: parseInt(m.draft) },
    deviations: { total: parseInt(d.total), open: parseInt(d.open) },
    training: { trained_users: parseInt(tr.trained_users) },
    equipment: { total: parseInt(eq.total), available: parseInt(eq.available) },
  };
}

async function getBatchSummary(filters = {}) {
  let sql = `SELECT e.id, e.ebr_code as batch_id, e.batch_number, e.product_name, e.status, e.batch_size,
    e.started_at, e.completed_at,
    (SELECT COUNT(*) FROM ebr_deviations WHERE ebr_id=e.id) as deviations,
    (SELECT COUNT(*) FROM ebr_step_executions WHERE ebr_id=e.id AND status='Completed') as done_steps,
    (SELECT COUNT(*) FROM ebr_step_executions WHERE ebr_id=e.id) as total_steps
    FROM ebrs e WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND e.status=$${i++}`; params.push(filters.status); }
  if (filters.product_name) { sql += ` AND e.product_name ILIKE $${i++}`; params.push('%' + filters.product_name + '%'); }
  sql += ' ORDER BY e.created_at DESC LIMIT 50';
  return (await query(sql, params)).rows;
}

async function getProducts() {
  return (await query("SELECT DISTINCT product_name, product_code FROM mbrs WHERE product_name IS NOT NULL ORDER BY product_name")).rows;
}

async function getThroughput() {
  return (await query(
    `SELECT DATE(completed_at) as date, COUNT(*) as batches
     FROM ebrs WHERE completed_at IS NOT NULL AND completed_at > NOW() - INTERVAL '30 days'
     GROUP BY DATE(completed_at) ORDER BY date`)).rows;
}

async function getQualityTrend() {
  return (await query(
    `SELECT DATE(created_at) as date, COUNT(*) as deviations,
     COUNT(*) FILTER (WHERE severity='Critical') as critical,
     COUNT(*) FILTER (WHERE severity='Major') as major
     FROM deviations WHERE created_at > NOW() - INTERVAL '30 days'
     GROUP BY DATE(created_at) ORDER BY date`)).rows;
}

module.exports = { getKPIs, getBatchSummary, getProducts, getThroughput, getQualityTrend };
