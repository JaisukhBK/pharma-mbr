// server/services/genealogyService.js — Batch Genealogy (fixed for M-004 schema)
const { query } = require('../db/pool');

// ═══ BATCHES (EBRs) ═══

async function listBatches(filters = {}) {
  let sql = `SELECT e.id, e.ebr_code as code, e.batch_number, e.product_name, e.status, e.batch_size,
    e.started_at, e.completed_at,
    (SELECT COUNT(*) FROM batch_genealogy bg WHERE bg.ebr_id=e.id) as material_count,
    (SELECT COUNT(*) FROM ebr_deviations ed WHERE ed.ebr_id=e.id) as deviation_count
    FROM ebrs e WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND e.status=$${i++}`; params.push(filters.status); }
  if (filters.product_name) { sql += ` AND e.product_name ILIKE $${i++}`; params.push('%' + filters.product_name + '%'); }
  sql += ' ORDER BY e.created_at DESC';
  return (await query(sql, params)).rows;
}

async function getBatch(id) {
  const batch = await query(
    'SELECT e.*, m.product_code FROM ebrs e LEFT JOIN mbrs m ON e.mbr_id=m.id WHERE e.id=$1', [id]);
  if (batch.rows.length === 0) return null;
  const materials = await query('SELECT * FROM batch_genealogy WHERE ebr_id=$1 ORDER BY created_at', [id]);
  const deviations = await query('SELECT * FROM ebr_deviations WHERE ebr_id=$1', [id]);
  return { ...batch.rows[0], materials: materials.rows, deviations: deviations.rows };
}

// ═══ MATERIAL LOTS ═══

async function listMaterials(filters = {}) {
  let sql = 'SELECT * FROM material_lots WHERE 1=1';
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND status=$${i++}`; params.push(filters.status); }
  sql += ' ORDER BY received_date DESC NULLS LAST';
  return (await query(sql, params)).rows;
}

async function createMaterialLot(data) {
  const { material_code, material_name, lot_number, supplier, received_date, expiry_date, quantity, unit, coa_number } = data;
  const r = await query(
    `INSERT INTO material_lots (material_code, material_name, lot_number, supplier, received_date, expiry_date, quantity, unit, coa_number, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [material_code, material_name, lot_number, supplier, received_date, expiry_date, quantity, unit, coa_number, data.created_by]);
  return r.rows[0];
}

async function releaseLot(lotId) {
  const r = await query("UPDATE material_lots SET status='Released', updated_at=NOW() WHERE id=$1 RETURNING *", [lotId]);
  return r.rows[0];
}

// ═══ GENEALOGY LINKS ═══

async function linkMaterialToBatch(data) {
  const { ebr_id, material_lot_id, lot_number, material_name, qty_dispensed, unit, step_name } = data;
  const batch = await query('SELECT batch_number FROM ebrs WHERE id=$1', [ebr_id]);
  const batchNumber = batch.rows[0]?.batch_number || '';
  const r = await query(
    `INSERT INTO batch_genealogy (ebr_id, material_lot_id, lot_number, material_name, qty_dispensed, unit, step_name)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [ebr_id, material_lot_id, lot_number, material_name, qty_dispensed, unit, step_name]);
  return r.rows[0];
}

// ═══ TRACEABILITY ═══

async function traceForward(lotNumber) {
  const batches = await query(
    `SELECT bg.*, e.product_name, e.status as batch_status
     FROM batch_genealogy bg LEFT JOIN ebrs e ON bg.ebr_id=e.id WHERE bg.lot_number=$1 ORDER BY bg.created_at`, [lotNumber]);
  return { lot_number: lotNumber, used_in_batches: batches.rows, count: batches.rows.length };
}

async function traceBackward(batchNumber) {
  const ebr = await query('SELECT id FROM ebrs WHERE batch_number=$1', [batchNumber]);
  if (ebr.rows.length === 0) return { batch_number: batchNumber, input_materials: [], count: 0 };
  const materials = await query(
    `SELECT bg.*, ml.supplier, ml.expiry_date, ml.status as lot_status
     FROM batch_genealogy bg LEFT JOIN material_lots ml ON bg.material_lot_id=ml.id WHERE bg.ebr_id=$1 ORDER BY bg.created_at`, [ebr.rows[0].id]);
  return { batch_number: batchNumber, input_materials: materials.rows, count: materials.rows.length };
}

// ═══ RECALLS ═══

async function simulateRecall(lotNumber) {
  const forward = await traceForward(lotNumber);
  const lot = await query('SELECT * FROM material_lots WHERE lot_number=$1', [lotNumber]);
  return {
    recall_lot: lot.rows[0] || { lot_number: lotNumber },
    affected_batches: forward.used_in_batches,
    affected_count: forward.count,
  };
}

async function getGenealogyStats() {
  const batches = await query("SELECT COUNT(*) as total FROM ebrs");
  const lots = await query("SELECT status, COUNT(*) as cnt FROM material_lots GROUP BY status");
  const links = await query("SELECT COUNT(*) as cnt FROM batch_genealogy");
  return {
    total_batches: parseInt(batches.rows[0].total),
    material_lots: lots.rows,
    genealogy_links: parseInt(links.rows[0].cnt),
  };
}

module.exports = { listBatches, getBatch, listMaterials, createMaterialLot, releaseLot, linkMaterialToBatch, traceForward, traceBackward, simulateRecall, getGenealogyStats };
