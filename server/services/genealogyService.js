// server/services/genealogyService.js — Material Genealogy & Traceability
// 21 CFR 211.184 — Component, container, closure records
// Forward trace: material lot → which batches used it
// Backward trace: batch → which material lots went into it

const { query } = require('../db/pool');

// Sanitize form values: empty strings → null for DB columns
const toInt = (v) => (v === '' || v === null || v === undefined || isNaN(parseInt(v))) ? null : parseInt(v);
const toNum = (v) => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);
const toStr = (v) => (v === '' || v === null || v === undefined) ? null : String(v);

// ════════════════════════════════════════════════════════════════
// MATERIAL MASTER
// ════════════════════════════════════════════════════════════════

async function listMaterials(filters = {}) {
  let sql = `SELECT m.*, 
    (SELECT COUNT(*) FROM material_lots WHERE material_id=m.id) as lot_count,
    (SELECT COALESCE(SUM(quantity_available),0) FROM material_lots WHERE material_id=m.id AND status='Released') as stock_available
    FROM material_master m WHERE 1=1`;
  const p = []; let i = 1;
  if (filters.material_type) { sql += ` AND m.material_type=$${i++}`; p.push(filters.material_type); }
  if (filters.search) { sql += ` AND (m.material_name ILIKE $${i} OR m.material_code ILIKE $${i})`; p.push('%'+filters.search+'%'); i++; }
  if (filters.is_active !== undefined) { sql += ` AND m.is_active=$${i++}`; p.push(filters.is_active === 'true'); }
  sql += ' ORDER BY m.material_code';
  return (await query(sql, p)).rows;
}

async function getMaterial(id) {
  const m = await query('SELECT * FROM material_master WHERE id=$1', [id]);
  if (m.rows.length === 0) return null;
  const lots = await query('SELECT * FROM material_lots WHERE material_id=$1 ORDER BY received_date DESC', [id]);
  return { ...m.rows[0], lots: lots.rows };
}

async function createMaterial(data) {
  const r = await query(
    `INSERT INTO material_master (material_code, material_name, material_type, cas_number, grade, supplier, supplier_code, unit, retest_interval_days, shelf_life_months, storage_conditions, min_stock, is_controlled, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [
      data.material_code,
      data.material_name,
      data.material_type || 'Raw Material',
      toStr(data.cas_number),
      toStr(data.grade),
      toStr(data.supplier),
      toStr(data.supplier_code),
      data.unit || 'kg',
      toInt(data.retest_interval_days),
      toInt(data.shelf_life_months),
      toStr(data.storage_conditions),
      toNum(data.min_stock),
      data.is_controlled || false,
      data.created_by,
    ]
  );
  return r.rows[0];
}

async function updateMaterial(id, data) {
  const r = await query(
    `UPDATE material_master SET 
       material_name=COALESCE($1,material_name), material_type=COALESCE($2,material_type),
       cas_number=COALESCE($3,cas_number), grade=COALESCE($4,grade),
       supplier=COALESCE($5,supplier), supplier_code=COALESCE($6,supplier_code),
       unit=COALESCE($7,unit), retest_interval_days=COALESCE($8,retest_interval_days),
       shelf_life_months=COALESCE($9,shelf_life_months), storage_conditions=COALESCE($10,storage_conditions),
       min_stock=COALESCE($11,min_stock), is_controlled=COALESCE($12,is_controlled),
       is_active=COALESCE($13,is_active), updated_at=NOW()
     WHERE id=$14 RETURNING *`,
    [
      toStr(data.material_name), toStr(data.material_type), toStr(data.cas_number),
      toStr(data.grade), toStr(data.supplier), toStr(data.supplier_code),
      toStr(data.unit), toInt(data.retest_interval_days), toInt(data.shelf_life_months),
      toStr(data.storage_conditions), toNum(data.min_stock),
      data.is_controlled, data.is_active, id,
    ]
  );
  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// MATERIAL LOTS
// ════════════════════════════════════════════════════════════════

async function createLot(materialId, data) {
  const qty = toNum(data.quantity_received);
  if (!qty || qty <= 0) throw new Error('quantity_received must be a positive number');

  const r = await query(
    `INSERT INTO material_lots 
       (material_id, lot_number, supplier_lot, quantity_received, quantity_available, unit,
        received_date, manufacture_date, expiry_date, retest_date,
        coa_reference, coa_status, status, warehouse_location, notes, received_by)
     VALUES ($1,$2,$3,$4,$4,$5,$6,$7,$8,$9,$10,'Pending','Quarantine',$11,$12,$13) RETURNING *`,
    [
      materialId,
      data.lot_number,
      toStr(data.supplier_lot),
      qty,
      data.unit || 'kg',
      toStr(data.received_date) || new Date().toISOString().split('T')[0],
      toStr(data.manufacture_date),
      toStr(data.expiry_date),
      toStr(data.retest_date),
      toStr(data.coa_reference),
      toStr(data.warehouse_location),
      toStr(data.notes),
      data.received_by,
    ]
  );

  // Log the receive transaction
  await query(
    `INSERT INTO material_transactions (lot_id, material_id, transaction_type, quantity, unit, performed_by, reason)
     VALUES ($1,$2,'Receive',$3,$4,$5,'Initial receipt')`,
    [r.rows[0].id, materialId, qty, data.unit || 'kg', data.received_by]
  );

  return r.rows[0];
}

async function updateLotStatus(lotId, status, userId, notes) {
  let r;
  if (status === 'Released') {
    r = await query(
      `UPDATE material_lots 
       SET status='Released', released_by=$1, released_at=NOW(), notes=COALESCE($2,notes), updated_at=NOW() 
       WHERE id=$3 RETURNING *`,
      [userId, toStr(notes), lotId]
    );
  } else {
    r = await query(
      `UPDATE material_lots 
       SET status=$1, notes=COALESCE($2,notes), updated_at=NOW() 
       WHERE id=$3 RETURNING *`,
      [status, toStr(notes), lotId]
    );
  }
  return r.rows[0];
}

async function getLotTransactions(lotId) {
  const r = await query(
    `SELECT t.*, u.full_name as performed_by_name 
     FROM material_transactions t LEFT JOIN users u ON t.performed_by=u.id 
     WHERE t.lot_id=$1 ORDER BY t.created_at DESC`, [lotId]);
  return r.rows;
}

// ════════════════════════════════════════════════════════════════
// TRANSACTIONS
// ════════════════════════════════════════════════════════════════

async function recordTransaction(data) {
  const qty = toNum(data.quantity);
  if (!qty || qty <= 0) throw new Error('quantity must be a positive number');

  const txn = await query(
    `INSERT INTO material_transactions (lot_id, material_id, transaction_type, quantity, unit, batch_number, ebr_id, mbr_step_id, performed_by, reason) 
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [data.lot_id, data.material_id, data.transaction_type, qty, data.unit || 'kg',
     toStr(data.batch_number), toStr(data.ebr_id), toStr(data.mbr_step_id), data.performed_by, toStr(data.reason)]
  );

  // Update lot available quantity based on transaction type
  if (['Dispense', 'Consume', 'Sample'].includes(data.transaction_type)) {
    await query('UPDATE material_lots SET quantity_available=quantity_available-$1, updated_at=NOW() WHERE id=$2', [qty, data.lot_id]);
  } else if (data.transaction_type === 'Return') {
    await query('UPDATE material_lots SET quantity_available=quantity_available+$1, updated_at=NOW() WHERE id=$2', [qty, data.lot_id]);
  }

  return txn.rows[0];
}

// ════════════════════════════════════════════════════════════════
// GENEALOGY — TRACE
// ════════════════════════════════════════════════════════════════

async function forwardTrace(lotId) {
  const lot = await query(
    `SELECT l.*, m.material_name, m.material_code, m.material_type 
     FROM material_lots l JOIN material_master m ON l.material_id=m.id 
     WHERE l.id=$1`, [lotId]);
  if (lot.rows.length === 0) return { error: 'Lot not found' };

  const batches = await query(
    `SELECT DISTINCT t.batch_number, t.ebr_id, t.quantity, t.unit, t.created_at,
       e.product_name, e.status as batch_status, e.ebr_code
     FROM material_transactions t
     LEFT JOIN ebrs e ON t.ebr_id=e.id
     WHERE t.lot_id=$1 AND t.transaction_type IN ('Consume','Dispense')
     ORDER BY t.created_at DESC`, [lotId]);

  const genealogy = await query(
    `SELECT g.*, e.ebr_code, e.status as batch_status 
     FROM batch_genealogy g LEFT JOIN ebrs e ON g.ebr_id=e.id 
     WHERE g.lot_id=$1 ORDER BY g.consumed_at DESC`, [lotId]);

  const allBatchNumbers = new Set([
    ...batches.rows.map(b => b.batch_number).filter(Boolean),
    ...genealogy.rows.map(g => g.batch_number).filter(Boolean),
  ]);

  return {
    lot: lot.rows[0],
    affected_batches: batches.rows,
    genealogy_records: genealogy.rows,
    total_batches: allBatchNumbers.size,
  };
}

async function backwardTrace(batchNumber) {
  const txns = await query(
    `SELECT t.*, m.material_name, m.material_code, m.material_type, 
       l.lot_number, l.supplier_lot, l.expiry_date, l.coa_reference, l.status as lot_status
     FROM material_transactions t
     JOIN material_master m ON t.material_id=m.id
     JOIN material_lots l ON t.lot_id=l.id
     WHERE t.batch_number=$1 AND t.transaction_type IN ('Consume','Dispense')
     ORDER BY t.created_at ASC`, [batchNumber]);

  const genealogy = await query(
    `SELECT g.*, m.material_name, m.material_code, m.material_type, 
       l.lot_number, l.supplier_lot, l.expiry_date, l.status as lot_status
     FROM batch_genealogy g
     JOIN material_master m ON g.material_id=m.id
     JOIN material_lots l ON g.lot_id=l.id
     WHERE g.batch_number=$1 ORDER BY g.consumed_at ASC`, [batchNumber]);

  const allMaterials = [...txns.rows, ...genealogy.rows];
  const unique = [...new Map(allMaterials.map(m => [(m.lot_number || '') + (m.material_code || ''), m])).values()];

  return {
    batch_number: batchNumber,
    materials: unique,
    total_materials: unique.length,
    total_lots: new Set(unique.map(m => m.lot_number).filter(Boolean)).size,
  };
}

// ════════════════════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════════════════════

async function getStats() {
  const [total, byType, lowStock, expiringSoon, quarantine] = await Promise.all([
    query('SELECT COUNT(*) as cnt FROM material_master WHERE is_active=true'),
    query('SELECT material_type, COUNT(*) as cnt FROM material_master WHERE is_active=true GROUP BY material_type'),
    query(`SELECT COUNT(*) as cnt FROM material_master m 
           WHERE m.min_stock IS NOT NULL AND m.is_active=true 
           AND (SELECT COALESCE(SUM(quantity_available),0) FROM material_lots WHERE material_id=m.id AND status='Released') < m.min_stock`),
    query(`SELECT COUNT(*) as cnt FROM material_lots 
           WHERE expiry_date BETWEEN NOW() AND NOW() + INTERVAL '90 days' AND status='Released'`),
    query(`SELECT COUNT(*) as cnt FROM material_lots WHERE status='Quarantine'`),
  ]);
  return {
    total_materials: parseInt(total.rows[0].cnt),
    by_type: byType.rows,
    low_stock: parseInt(lowStock.rows[0].cnt),
    expiring_90d: parseInt(expiringSoon.rows[0].cnt),
    in_quarantine: parseInt(quarantine.rows[0].cnt),
  };
}

async function getExpiringLots(days) {
  const d = parseInt(days) || 90;
  const r = await query(
    `SELECT l.*, m.material_name, m.material_code, m.material_type
     FROM material_lots l JOIN material_master m ON l.material_id=m.id
     WHERE l.expiry_date BETWEEN NOW() AND NOW() + INTERVAL '1 day' * $1
       AND l.status = 'Released'
     ORDER BY l.expiry_date ASC`, [d]);
  return r.rows;
}

module.exports = {
  listMaterials, getMaterial, createMaterial, updateMaterial,
  createLot, updateLotStatus, getLotTransactions, recordTransaction,
  forwardTrace, backwardTrace,
  getStats, getExpiringLots,
};
