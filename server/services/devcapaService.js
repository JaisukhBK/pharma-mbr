// server/services/devcapaService.js — Deviation & CAPA Management (fixed for M-005 schema)
const { query } = require('../db/pool');

// ═══ DEVIATIONS ═══

async function listDeviations(filters = {}) {
  let sql = `SELECT d.*, u1.full_name as created_by_name, u2.full_name as assigned_to_name
    FROM deviations d LEFT JOIN users u1 ON d.created_by=u1.id LEFT JOIN users u2 ON d.assigned_to=u2.id WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND d.status=$${i++}`; params.push(filters.status); }
  if (filters.severity) { sql += ` AND d.severity=$${i++}`; params.push(filters.severity); }
  if (filters.batch_number) { sql += ` AND d.batch_number=$${i++}`; params.push(filters.batch_number); }
  sql += ' ORDER BY d.created_at DESC';
  return (await query(sql, params)).rows;
}

async function getDeviation(id) {
  const d = await query(
    `SELECT d.*, u1.full_name as created_by_name, u2.full_name as assigned_to_name
     FROM deviations d LEFT JOIN users u1 ON d.created_by=u1.id LEFT JOIN users u2 ON d.assigned_to=u2.id WHERE d.id=$1`, [id]);
  if (d.rows.length === 0) return null;
  // CAPAs via junction table
  const capas = await query(
    `SELECT c.* FROM capas c JOIN deviation_capas dc ON c.id=dc.capa_id WHERE dc.deviation_id=$1 ORDER BY c.created_at`, [id]);
  return { ...d.rows[0], capas: capas.rows };
}

async function createDeviation(data) {
  const { title, description, severity, category, batch_number, area, assigned_to, created_by } = data;
  const r = await query(
    `INSERT INTO deviations (title, description, severity, category, batch_number, area, assigned_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [title, description, severity || 'Major', category || 'Process', batch_number, area, assigned_to, created_by]);
  return r.rows[0];
}

async function updateDeviation(id, data) {
  const { title, description, severity, root_cause, status, assigned_to } = data;
  const r = await query(
    `UPDATE deviations SET title=COALESCE($1,title), description=COALESCE($2,description), severity=COALESCE($3,severity),
     root_cause=COALESCE($4,root_cause), status=COALESCE($5,status), assigned_to=COALESCE($6,assigned_to), updated_at=NOW()
     WHERE id=$7 RETURNING *`,
    [title, description, severity, root_cause, status, assigned_to, id]);
  return r.rows[0];
}

async function closeDeviation(id) {
  const r = await query(
    "UPDATE deviations SET status='Closed', closed_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING *", [id]);
  return r.rows[0];
}

// ═══ CAPAs ═══

async function listCAPAs(filters = {}) {
  let sql = `SELECT c.*, u.full_name as assigned_to_name,
    (SELECT d.dev_number FROM deviations d JOIN deviation_capas dc ON d.id=dc.deviation_id WHERE dc.capa_id=c.id LIMIT 1) as dev_number,
    (SELECT d.title FROM deviations d JOIN deviation_capas dc ON d.id=dc.deviation_id WHERE dc.capa_id=c.id LIMIT 1) as deviation_title
    FROM capas c LEFT JOIN users u ON c.assigned_to=u.id WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND c.status=$${i++}`; params.push(filters.status); }
  if (filters.capa_type) { sql += ` AND c.capa_type=$${i++}`; params.push(filters.capa_type); }
  sql += ' ORDER BY c.created_at DESC';
  return (await query(sql, params)).rows;
}

async function getCAPA(id) {
  const r = await query(
    `SELECT c.* FROM capas c WHERE c.id=$1`, [id]);
  if (!r.rows[0]) return null;
  const devs = await query(
    `SELECT d.dev_number, d.title FROM deviations d JOIN deviation_capas dc ON d.id=dc.deviation_id WHERE dc.capa_id=$1`, [id]);
  return { ...r.rows[0], deviations: devs.rows };
}

async function createCAPA(data) {
  const { deviation_id, title, description, capa_type, priority, assigned_to, due_date, created_by } = data;
  const r = await query(
    `INSERT INTO capas (title, description, capa_type, priority, assigned_to, due_date, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [title, description, capa_type || 'Corrective', priority || 'High', assigned_to, due_date, created_by]);
  // Link to deviation via junction table
  if (deviation_id) {
    await query('INSERT INTO deviation_capas (deviation_id, capa_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [deviation_id, r.rows[0].id]);
    await query("UPDATE deviations SET status='Pending CAPA', updated_at=NOW() WHERE id=$1", [deviation_id]);
  }
  return r.rows[0];
}

async function updateCAPA(id, data) {
  const { status, description, effectiveness } = data;
  const r = await query(
    `UPDATE capas SET status=COALESCE($1,status), description=COALESCE($2,description), effectiveness=COALESCE($3,effectiveness), updated_at=NOW() WHERE id=$4 RETURNING *`,
    [status, description, effectiveness, id]);
  return r.rows[0];
}

async function verifyCAPA(id, userId) {
  const r = await query(
    "UPDATE capas SET status='Effective', verified_by=$1, updated_at=NOW() WHERE id=$2 RETURNING *", [userId, id]);
  return r.rows[0];
}

async function getDevCAPAStats() {
  const devs = await query("SELECT status, severity, COUNT(*) as cnt FROM deviations GROUP BY status, severity");
  const capas = await query("SELECT status, capa_type, COUNT(*) as cnt FROM capas GROUP BY status, capa_type");
  return {
    deviations: { total: devs.rows.reduce((s, r) => s + parseInt(r.cnt), 0), by_status: devs.rows },
    capas: { total: capas.rows.reduce((s, r) => s + parseInt(r.cnt), 0), by_status: capas.rows },
  };
}

module.exports = { listDeviations, getDeviation, createDeviation, updateDeviation, closeDeviation, listCAPAs, getCAPA, createCAPA, updateCAPA, verifyCAPA, getDevCAPAStats };
