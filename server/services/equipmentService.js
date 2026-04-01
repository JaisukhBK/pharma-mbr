// server/services/equipmentService.js — Equipment Management
// 21 CFR Part 11 | EU Annex 15 | GAMP5 — Equipment Qualification & Calibration

const { query } = require('../db/pool');

// ════════════════════════════════════════════════════════════════
// LIST & GET
// ════════════════════════════════════════════════════════════════

async function listEquipment(filters = {}) {
  let sql = `SELECT e.*,
    (SELECT COUNT(*) FROM equipment_calibrations WHERE equipment_id=e.id) as calibration_count,
    (SELECT result FROM equipment_calibrations WHERE equipment_id=e.id ORDER BY calibration_date DESC LIMIT 1) as last_cal_result
    FROM equipment e WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status)         { sql += ` AND e.status=$${i++}`;          params.push(filters.status); }
  if (filters.equipment_type) { sql += ` AND e.equipment_type=$${i++}`;  params.push(filters.equipment_type); }
  if (filters.area)           { sql += ` AND e.area=$${i++}`;            params.push(filters.area); }
  if (filters.gmp_critical)   { sql += ` AND e.gmp_critical=$${i++}`;    params.push(filters.gmp_critical === 'true'); }
  if (filters.search) {
    sql += ` AND (e.equipment_name ILIKE $${i} OR e.equipment_code ILIKE $${i})`;
    params.push('%' + filters.search + '%'); i++;
  }
  sql += ' ORDER BY e.equipment_code';
  return (await query(sql, params)).rows;
}

async function getEquipment(id) {
  const eq = await query('SELECT * FROM equipment WHERE id=$1', [id]);
  if (eq.rows.length === 0) return null;
  const cals = await query(
    'SELECT * FROM equipment_calibrations WHERE equipment_id=$1 ORDER BY calibration_date DESC',
    [id]
  );
  return { ...eq.rows[0], calibrations: cals.rows };
}

// ════════════════════════════════════════════════════════════════
// CREATE & UPDATE
// ════════════════════════════════════════════════════════════════

async function createEquipment(data) {
  const {
    equipment_code, equipment_name, equipment_type,
    manufacturer, model, serial_number, location, area,
    calibration_interval_days, gmp_critical, description,
  } = data;
  const r = await query(
    `INSERT INTO equipment
       (equipment_code, equipment_name, equipment_type, manufacturer, model,
        serial_number, location, area, calibration_interval_days, gmp_critical)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [equipment_code, equipment_name, equipment_type, manufacturer, model,
     serial_number, location, area,
     calibration_interval_days || 365, gmp_critical || false]
  );
  return r.rows[0];
}

async function updateEquipment(id, data) {
  const { status, location, area, clean_status, calibration_due, qualification_status } = data;
  const r = await query(
    `UPDATE equipment SET
       status                = COALESCE($1, status),
       location              = COALESCE($2, location),
       area                  = COALESCE($3, area),
       clean_status          = COALESCE($4, clean_status),
       calibration_due       = COALESCE($5, calibration_due),
       qualification_status  = COALESCE($6, qualification_status),
       updated_at            = NOW()
     WHERE id=$7 RETURNING *`,
    [status, location, area, clean_status, calibration_due, qualification_status, id]
  );
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// CALIBRATION
// ════════════════════════════════════════════════════════════════

async function recordCalibration(equipmentId, data) {
  const { calibration_date, next_due, performed_by, certificate_ref, result, notes } = data;

  const cal = await query(
    `INSERT INTO equipment_calibrations
       (equipment_id, calibration_date, next_due, performed_by, certificate_ref, result, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [equipmentId, calibration_date, next_due, performed_by,
     certificate_ref, result || 'Pass', notes]
  );

  // Update equipment master record
  await query(
    `UPDATE equipment
     SET last_calibration    = $1,
         calibration_due     = $2,
         qualification_status = CASE WHEN qualification_status = 'Not Qualified'
                                     THEN 'Calibrated' ELSE qualification_status END,
         status              = CASE WHEN status = 'Out of Service'
                                    THEN 'Available' ELSE status END,
         updated_at          = NOW()
     WHERE id = $3`,
    [calibration_date, next_due, equipmentId]
  );

  return cal.rows[0];
}

async function getCalibrationHistory(equipmentId) {
  const r = await query(
    `SELECT * FROM equipment_calibrations
     WHERE equipment_id = $1
     ORDER BY calibration_date DESC`,
    [equipmentId]
  );
  return r.rows;
}

async function getOverdueCalibrations() {
  const r = await query(
    `SELECT e.*, ec.calibration_date as last_cal_date, ec.next_due,
            ec.result as last_cal_result
     FROM equipment e
     LEFT JOIN equipment_calibrations ec ON ec.id = (
       SELECT id FROM equipment_calibrations
       WHERE equipment_id = e.id
       ORDER BY calibration_date DESC LIMIT 1
     )
     WHERE e.calibration_due < NOW()
       AND e.status != 'Retired'
     ORDER BY e.calibration_due ASC`
  );
  return r.rows;
}

// ════════════════════════════════════════════════════════════════
// QUALIFICATION (IQ / OQ / PQ)
// ════════════════════════════════════════════════════════════════

async function updateQualificationStatus(equipmentId, qualStatus, userId, notes) {
  const validStatuses = ['Not Qualified', 'IQ', 'OQ', 'PQ',
                          'Qualified', 'Requalification', 'Retired'];
  if (!validStatuses.includes(qualStatus)) {
    return { error: 'Invalid qualification status: ' + qualStatus };
  }

  // Map qual status to equipment status
  const equipmentStatus = qualStatus === 'Qualified' || qualStatus === 'PQ Complete'
    ? 'Available'
    : qualStatus === 'Retired'
    ? 'Retired'
    : 'Under Qualification';

  const r = await query(
    `UPDATE equipment
     SET qualification_status = $1,
         status               = $2,
         updated_at           = NOW()
     WHERE id = $3 RETURNING *`,
    [qualStatus, equipmentStatus, equipmentId]
  );

  if (r.rows.length === 0) return { error: 'Equipment not found' };
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// STATS & DASHBOARD
// ════════════════════════════════════════════════════════════════

async function getEquipmentStats() {
  const [byStatus, calOverdue, calDueSoon, gmpCritical, byType] = await Promise.all([
    query(`SELECT status, COUNT(*) as cnt FROM equipment GROUP BY status`),
    query(`SELECT COUNT(*) as cnt FROM equipment
           WHERE calibration_due < NOW() AND status != 'Retired'`),
    query(`SELECT COUNT(*) as cnt FROM equipment
           WHERE calibration_due BETWEEN NOW() AND NOW() + INTERVAL '30 days'
             AND status != 'Retired'`),
    query(`SELECT COUNT(*) as cnt FROM equipment WHERE gmp_critical = true`),
    query(`SELECT equipment_type, COUNT(*) as cnt FROM equipment GROUP BY equipment_type`),
  ]);

  return {
    total:              byStatus.rows.reduce((s, r) => s + parseInt(r.cnt), 0),
    by_status:          byStatus.rows,
    by_type:            byType.rows,
    calibration_overdue: parseInt(calOverdue.rows[0].cnt),
    calibration_due_30d: parseInt(calDueSoon.rows[0].cnt),
    gmp_critical:        parseInt(gmpCritical.rows[0].cnt),
  };
}

module.exports = {
  listEquipment,
  getEquipment,
  createEquipment,
  updateEquipment,
  recordCalibration,
  getCalibrationHistory,
  getOverdueCalibrations,
  updateQualificationStatus,
  getEquipmentStats,
};
