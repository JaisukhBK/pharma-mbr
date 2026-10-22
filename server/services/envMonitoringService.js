// server/services/envMonitoringService.js — Environmental Monitoring
// EU GMP Annex 1 | 21 CFR 211.42 | ISO 14644
// BMS/EMS integration via REST API ingestion and polling

const { query } = require('../db/pool');
const toNum = (v) => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);

// ════════════════════════════════════════════════════════════════
// ZONES
// ════════════════════════════════════════════════════════════════

async function listZones(filters = {}) {
  let sql = `SELECT z.*,
    (SELECT COUNT(*) FROM env_sensors WHERE zone_id=z.id) as sensor_count,
    (SELECT COUNT(*) FROM env_alerts WHERE zone_id=z.id AND resolved_at IS NULL) as active_alerts
    FROM env_zones z WHERE z.is_active=true`;
  const p = []; let i = 1;
  if (filters.zone_type) { sql += ` AND z.zone_type=$${i++}`; p.push(filters.zone_type); }
  if (filters.building) { sql += ` AND z.building=$${i++}`; p.push(filters.building); }
  sql += ' ORDER BY z.zone_code';
  return (await query(sql, p)).rows;
}

async function getZone(id) {
  const z = await query('SELECT * FROM env_zones WHERE id=$1', [id]);
  if (z.rows.length === 0) return null;
  const sensors = await query(
    `SELECT s.*, 
      (SELECT value FROM env_readings WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1) as current_value,
      (SELECT recorded_at FROM env_readings WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1) as current_reading_at
     FROM env_sensors s WHERE s.zone_id=$1 AND s.is_active=true ORDER BY s.parameter_type`, [id]);
  const alerts = await query(
    'SELECT a.*, u.full_name as acknowledged_by_name FROM env_alerts a LEFT JOIN users u ON a.acknowledged_by=u.id WHERE a.zone_id=$1 ORDER BY a.created_at DESC LIMIT 20', [id]);
  return { ...z.rows[0], sensors: sensors.rows, alerts: alerts.rows };
}

async function createZone(data) {
  const r = await query(
    `INSERT INTO env_zones (zone_code, zone_name, zone_type, iso_class, gmp_grade, parent_zone_id, building, floor, area_sqm)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [data.zone_code, data.zone_name, data.zone_type || 'Production', data.iso_class, data.gmp_grade,
     data.parent_zone_id, data.building, data.floor, toNum(data.area_sqm)]);
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// SENSORS
// ════════════════════════════════════════════════════════════════

async function createSensor(zoneId, data) {
  const r = await query(
    `INSERT INTO env_sensors (zone_id, sensor_code, sensor_name, parameter_type, unit, low_limit, high_limit, low_alert, high_alert, reading_interval_sec, bms_tag, bms_source, is_critical)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [zoneId, data.sensor_code, data.sensor_name, data.parameter_type, data.unit,
     toNum(data.low_limit), toNum(data.high_limit), toNum(data.low_alert), toNum(data.high_alert),
     parseInt(data.reading_interval_sec) || 300, data.bms_tag, data.bms_source, data.is_critical || false]);
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// READING INGESTION — from BMS/EMS push or manual entry
// ════════════════════════════════════════════════════════════════

async function ingestReading(data) {
  const { sensor_id, sensor_code, bms_tag, value, source, bms_timestamp } = data;

  // Resolve sensor by ID, code, or BMS tag
  let sensor;
  if (sensor_id) {
    sensor = (await query('SELECT * FROM env_sensors WHERE id=$1', [sensor_id])).rows[0];
  } else if (sensor_code) {
    sensor = (await query('SELECT * FROM env_sensors WHERE sensor_code=$1', [sensor_code])).rows[0];
  } else if (bms_tag) {
    sensor = (await query('SELECT * FROM env_sensors WHERE bms_tag=$1', [bms_tag])).rows[0];
  }
  if (!sensor) throw new Error('Sensor not found');

  const numVal = toNum(value);
  if (numVal === null) throw new Error('Invalid reading value');

  // Check spec limits
  const inSpec = (sensor.low_limit === null || numVal >= parseFloat(sensor.low_limit)) &&
                 (sensor.high_limit === null || numVal <= parseFloat(sensor.high_limit));

  // Insert reading
  const r = await query(
    `INSERT INTO env_readings (sensor_id, zone_id, value, unit, source, in_spec, bms_timestamp)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sensor.id, sensor.zone_id, numVal, sensor.unit, source || 'BMS', inSpec, bms_timestamp || new Date().toISOString()]);

  // Update sensor current state
  const newStatus = inSpec ? 'Normal' :
    ((sensor.low_alert !== null && numVal < parseFloat(sensor.low_alert)) ||
     (sensor.high_alert !== null && numVal > parseFloat(sensor.high_alert))) ? 'Alarm' : 'Warning';

  await query('UPDATE env_sensors SET last_reading=$1, last_reading_at=NOW(), status=$2, updated_at=NOW() WHERE id=$3',
    [numVal, newStatus, sensor.id]);

  // Trigger alert if out of spec
  let alert = null;
  if (!inSpec) {
    const limitBreached = (sensor.low_limit !== null && numVal < parseFloat(sensor.low_limit)) ? 'Low Limit' :
                          (sensor.high_limit !== null && numVal > parseFloat(sensor.high_limit)) ? 'High Limit' : 'Unknown';
    const limitValue = limitBreached === 'Low Limit' ? sensor.low_limit : sensor.high_limit;

    alert = (await query(
      `INSERT INTO env_alerts (sensor_id, zone_id, alert_type, parameter_type, value, limit_breached, limit_value)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [sensor.id, sensor.zone_id, newStatus === 'Alarm' ? 'Alarm' : 'Warning',
       sensor.parameter_type, numVal, limitBreached, limitValue])).rows[0];
  }

  return { reading: r.rows[0], sensor_status: newStatus, in_spec: inSpec, alert };
}

// Batch ingest — BMS pushes multiple readings at once
async function ingestBatch(readings) {
  const results = [];
  for (const r of readings) {
    try { results.push(await ingestReading(r)); }
    catch (e) { results.push({ error: e.message, input: r }); }
  }
  return { processed: results.length, results };
}

// ════════════════════════════════════════════════════════════════
// READING HISTORY — for charts
// ════════════════════════════════════════════════════════════════

async function getReadingHistory(sensorId, hours = 24) {
  const r = await query(
    `SELECT value, unit, in_spec, source, recorded_at FROM env_readings
     WHERE sensor_id=$1 AND recorded_at >= NOW() - INTERVAL '1 hour' * $2
     ORDER BY recorded_at ASC`, [sensorId, hours]);
  return r.rows;
}

async function getZoneSnapshot(zoneId) {
  const sensors = await query(
    `SELECT s.*, 
      (SELECT value FROM env_readings WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1) as current_value,
      (SELECT in_spec FROM env_readings WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1) as current_in_spec,
      (SELECT recorded_at FROM env_readings WHERE sensor_id=s.id ORDER BY recorded_at DESC LIMIT 1) as last_read
     FROM env_sensors s WHERE s.zone_id=$1 AND s.is_active=true ORDER BY s.parameter_type`, [zoneId]);
  return sensors.rows;
}

// ════════════════════════════════════════════════════════════════
// ALERTS
// ════════════════════════════════════════════════════════════════

async function acknowledgeAlert(alertId, userId, notes) {
  const r = await query(
    'UPDATE env_alerts SET acknowledged_by=$1, acknowledged_at=NOW(), notes=COALESCE($2,notes) WHERE id=$3 RETURNING *',
    [userId, notes, alertId]);
  return r.rows[0];
}

async function resolveAlert(alertId, notes) {
  const r = await query(
    'UPDATE env_alerts SET resolved_at=NOW(), notes=COALESCE($1,notes) WHERE id=$2 RETURNING *',
    [notes, alertId]);
  return r.rows[0];
}

async function getActiveAlerts() {
  const r = await query(
    `SELECT a.*, s.sensor_name, s.parameter_type as sensor_type, s.unit, z.zone_name, z.zone_code
     FROM env_alerts a
     JOIN env_sensors s ON a.sensor_id=s.id
     JOIN env_zones z ON a.zone_id=z.id
     WHERE a.resolved_at IS NULL
     ORDER BY a.created_at DESC`);
  return r.rows;
}

// ════════════════════════════════════════════════════════════════
// BMS CONNECTION MANAGEMENT
// ════════════════════════════════════════════════════════════════

async function listConnections() {
  return (await query('SELECT * FROM env_bms_connections ORDER BY connection_name')).rows;
}

async function createConnection(data) {
  const r = await query(
    `INSERT INTO env_bms_connections (connection_name, system_type, endpoint_url, api_key, polling_interval_sec, auth_type)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [data.connection_name, data.system_type, data.endpoint_url, data.api_key,
     parseInt(data.polling_interval_sec) || 300, data.auth_type || 'API_KEY']);
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// STATS — dashboard overview
// ════════════════════════════════════════════════════════════════

async function getStats() {
  const [zones, sensors, alerts, readings24h] = await Promise.all([
    query('SELECT COUNT(*) as cnt FROM env_zones WHERE is_active=true'),
    query(`SELECT status, COUNT(*) as cnt FROM env_sensors WHERE is_active=true GROUP BY status`),
    query('SELECT COUNT(*) as cnt FROM env_alerts WHERE resolved_at IS NULL'),
    query(`SELECT COUNT(*) as cnt FROM env_readings WHERE recorded_at >= NOW() - INTERVAL '24 hours'`),
  ]);

  const sensorRows = sensors.rows;
  return {
    total_zones: parseInt(zones.rows[0].cnt),
    total_sensors: sensorRows.reduce((s, r) => s + parseInt(r.cnt), 0),
    sensors_normal: parseInt(sensorRows.find(s => s.status === 'Normal')?.cnt || 0),
    sensors_warning: parseInt(sensorRows.find(s => s.status === 'Warning')?.cnt || 0),
    sensors_alarm: parseInt(sensorRows.find(s => s.status === 'Alarm')?.cnt || 0),
    sensors_offline: parseInt(sensorRows.find(s => s.status === 'Offline')?.cnt || 0),
    active_alerts: parseInt(alerts.rows[0].cnt),
    readings_24h: parseInt(readings24h.rows[0].cnt),
  };
}

// ════════════════════════════════════════════════════════════════
// EBR ENVIRONMENTAL RECORDING — FR-ENV-007
// Captures and historizes env conditions per step execution
// ════════════════════════════════════════════════════════════════

async function captureStepSnapshot(ebrId, stepId, stepName, zoneId, eventType) {
  // Get zone info
  const zone = await query('SELECT zone_code FROM env_zones WHERE id=$1', [zoneId]);
  const zoneCode = zone.rows[0]?.zone_code || '';

  // Get current readings for all sensors in this zone
  const sensors = await query(
    `SELECT s.id, s.sensor_code, s.parameter_type, s.unit, s.low_limit, s.high_limit, s.last_reading
     FROM env_sensors s WHERE s.zone_id=$1 AND s.is_active=true`, [zoneId]);

  const records = [];
  for (const s of sensors.rows) {
    const currentVal = s.last_reading !== null ? parseFloat(s.last_reading) : null;
    if (currentVal === null) continue; // Skip sensors with no readings

    const inSpec = (s.low_limit === null || currentVal >= parseFloat(s.low_limit)) &&
                   (s.high_limit === null || currentVal <= parseFloat(s.high_limit));

    const r = await query(
      `INSERT INTO ebr_env_records (ebr_id, step_id, step_name, zone_id, zone_code, event_type, sensor_id, sensor_code, parameter_type, value, unit, low_limit, high_limit, in_spec)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [ebrId, stepId, stepName, zoneId, zoneCode, eventType,
       s.id, s.sensor_code, s.parameter_type, currentVal, s.unit,
       s.low_limit, s.high_limit, inSpec]);
    records.push(r.rows[0]);
  }

  return {
    event_type: eventType,
    zone_code: zoneCode,
    zone_id: zoneId,
    step_id: stepId,
    recorded_at: new Date().toISOString(),
    readings: records,
    all_in_spec: records.every(r => r.in_spec),
    out_of_spec_count: records.filter(r => !r.in_spec).length,
  };
}

async function getStepEnvRecords(ebrId, stepId) {
  const r = await query(
    `SELECT * FROM ebr_env_records WHERE ebr_id=$1 AND step_id=$2 ORDER BY event_type, recorded_at`,
    [ebrId, stepId]);

  // Group by event_type
  const grouped = { start_snapshot: [], periodic: [], end_snapshot: [] };
  for (const rec of r.rows) {
    if (grouped[rec.event_type]) grouped[rec.event_type].push(rec);
    else grouped[rec.event_type] = [rec];
  }

  return {
    step_id: stepId,
    total_records: r.rows.length,
    start_snapshot: grouped.start_snapshot,
    periodic: grouped.periodic,
    end_snapshot: grouped.end_snapshot,
    has_start: grouped.start_snapshot.length > 0,
    has_end: grouped.end_snapshot.length > 0,
    all_in_spec: r.rows.every(rec => rec.in_spec),
    oos_count: r.rows.filter(rec => !rec.in_spec).length,
  };
}

async function getEbrEnvSummary(ebrId) {
  const r = await query(
    `SELECT step_id, step_name, zone_code, event_type, parameter_type, value, unit, in_spec, recorded_at
     FROM ebr_env_records WHERE ebr_id=$1 ORDER BY step_id, event_type, recorded_at`, [ebrId]);

  const steps = {};
  for (const rec of r.rows) {
    if (!steps[rec.step_id]) steps[rec.step_id] = { step_name: rec.step_name, zone_code: rec.zone_code, records: [] };
    steps[rec.step_id].records.push(rec);
  }

  return {
    ebr_id: ebrId,
    total_records: r.rows.length,
    steps: Object.entries(steps).map(([stepId, data]) => ({
      step_id: stepId,
      step_name: data.step_name,
      zone_code: data.zone_code,
      record_count: data.records.length,
      all_in_spec: data.records.every(r => r.in_spec),
      oos_count: data.records.filter(r => !r.in_spec).length,
    })),
  };
}

module.exports = {
  listZones, getZone, createZone,
  createSensor,
  ingestReading, ingestBatch,
  getReadingHistory, getZoneSnapshot,
  acknowledgeAlert, resolveAlert, getActiveAlerts,
  listConnections, createConnection,
  getStats,
  captureStepSnapshot, getStepEnvRecords, getEbrEnvSummary,
};
