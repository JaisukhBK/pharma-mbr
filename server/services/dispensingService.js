// server/services/dispensingService.js — Electronic Weighing & Dispensing
// 21 CFR 211.101 — Charge-in of components shall be weighed and verified

const { query } = require('../db/pool');

const toNum = (v) => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);

// ════════════════════════════════════════════════════════════════
// DISPENSING ORDERS — create from BOM per batch
// ════════════════════════════════════════════════════════════════

async function createOrdersFromBOM(ebrId, batchNumber, mbrId) {
  // Get BOM items for this MBR
  const bom = await query(
    `SELECT b.*, mm.id as mat_master_id FROM mbr_bom_items b 
     LEFT JOIN material_master mm ON mm.material_code=b.material_code OR mm.material_name=b.material_name
     WHERE b.mbr_id=$1 ORDER BY b.dispensing_sequence, b.sort_order`, [mbrId]);

  const orders = [];
  for (const item of bom.rows) {
    const r = await query(
      `INSERT INTO dispensing_orders (ebr_id, batch_number, material_id, material_code, material_name, target_quantity, tolerance_pct, unit, dispensing_sequence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [ebrId, batchNumber, item.mat_master_id, item.material_code, item.material_name,
       item.quantity_per_batch, item.tolerance_pct || 2.0, item.unit || 'kg', item.dispensing_sequence || 0]);
    orders.push(r.rows[0]);
  }
  return orders;
}

async function listOrders(filters = {}) {
  let sql = `SELECT o.*, 
    u1.full_name as dispensed_by_name, u2.full_name as verified_by_name,
    (SELECT COUNT(*) FROM dispensing_records WHERE order_id=o.id) as record_count
    FROM dispensing_orders o 
    LEFT JOIN users u1 ON o.dispensed_by=u1.id
    LEFT JOIN users u2 ON o.verified_by=u2.id
    WHERE 1=1`;
  const p = []; let i = 1;
  if (filters.batch_number) { sql += ` AND o.batch_number=$${i++}`; p.push(filters.batch_number); }
  if (filters.status) { sql += ` AND o.status=$${i++}`; p.push(filters.status); }
  if (filters.ebr_id) { sql += ` AND o.ebr_id=$${i++}`; p.push(filters.ebr_id); }
  sql += ' ORDER BY o.dispensing_sequence, o.created_at';
  return (await query(sql, p)).rows;
}

async function getOrder(orderId) {
  const o = await query('SELECT * FROM dispensing_orders WHERE id=$1', [orderId]);
  if (o.rows.length === 0) return null;
  const records = await query(
    `SELECT r.*, u1.full_name as operator_name, u2.full_name as verifier_name
     FROM dispensing_records r 
     LEFT JOIN users u1 ON r.operator_id=u1.id 
     LEFT JOIN users u2 ON r.verifier_id=u2.id
     WHERE r.order_id=$1 ORDER BY r.created_at`, [orderId]);
  return { ...o.rows[0], records: records.rows };
}

// ════════════════════════════════════════════════════════════════
// LOT SELECTION — FEFO (First Expiry First Out)
// ════════════════════════════════════════════════════════════════

async function getAvailableLots(materialId, requiredQty) {
  const lots = await query(
    `SELECT l.*, m.material_name, m.material_code
     FROM material_lots l JOIN material_master m ON l.material_id=m.id
     WHERE l.material_id=$1 AND l.status='Released' AND l.quantity_available > 0
     ORDER BY l.expiry_date ASC NULLS LAST, l.received_date ASC`, [materialId]);

  // Recommend FEFO allocation
  const recommended = [];
  let remaining = requiredQty;
  for (const lot of lots.rows) {
    if (remaining <= 0) break;
    const allocate = Math.min(parseFloat(lot.quantity_available), remaining);
    recommended.push({ ...lot, recommended_qty: allocate });
    remaining -= allocate;
  }

  return {
    available_lots: lots.rows,
    recommended_allocation: recommended,
    total_available: lots.rows.reduce((s, l) => s + parseFloat(l.quantity_available), 0),
    sufficient: remaining <= 0,
  };
}

// ════════════════════════════════════════════════════════════════
// WEIGHING — record tare/gross/net with tolerance check
// ════════════════════════════════════════════════════════════════

async function recordWeighing(orderId, data) {
  const order = await query('SELECT * FROM dispensing_orders WHERE id=$1', [orderId]);
  if (order.rows.length === 0) throw new Error('Dispensing order not found');
  const ord = order.rows[0];

  const tare = toNum(data.tare_weight) || 0;
  const gross = toNum(data.gross_weight);
  if (!gross) throw new Error('gross_weight is required');
  const net = gross - tare;

  // Calculate tolerance bounds
  const target = parseFloat(ord.target_quantity);
  const tolPct = parseFloat(ord.tolerance_pct) || 2.0;
  const tolMin = target * (1 - tolPct / 100);
  const tolMax = target * (1 + tolPct / 100);
  const withinTolerance = net >= tolMin && net <= tolMax;

  const r = await query(
    `INSERT INTO dispensing_records 
       (order_id, lot_id, lot_number, tare_weight, gross_weight, net_weight, unit,
        balance_id, balance_name, tolerance_min, tolerance_max, within_tolerance,
        operator_id, environment_temp, environment_rh, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [orderId, data.lot_id, data.lot_number, tare, gross, net, ord.unit,
     data.balance_id, data.balance_name, tolMin, tolMax, withinTolerance,
     data.operator_id, toNum(data.environment_temp), toNum(data.environment_rh), data.notes]);

  // Update order with dispensed info
  await query(
    `UPDATE dispensing_orders SET status='Completed', dispensed_quantity=$1, 
     assigned_lot_id=$2, assigned_lot_number=$3, dispensed_by=$4, dispensed_at=NOW(), updated_at=NOW()
     WHERE id=$5`,
    [net, data.lot_id, data.lot_number, data.operator_id, orderId]);

  // Deduct from lot
  await query('UPDATE material_lots SET quantity_available=quantity_available-$1, updated_at=NOW() WHERE id=$2', [net, data.lot_id]);

  // Log transaction
  await query(
    `INSERT INTO material_transactions (lot_id, material_id, transaction_type, quantity, unit, batch_number, performed_by, reason)
     VALUES ($1,$2,'Dispense',$3,$4,$5,$6,$7)`,
    [data.lot_id, ord.material_id, net, ord.unit, ord.batch_number, data.operator_id,
     `Dispensed for batch ${ord.batch_number}`]);

  return {
    record: r.rows[0],
    net_weight: net,
    target: target,
    tolerance: { min: tolMin, max: tolMax, pct: tolPct },
    within_tolerance: withinTolerance,
  };
}

async function verifyWeighing(recordId, verifierId) {
  // 21 CFR 211.101 — dual verification: verifier must be different from operator
  const rec = await query('SELECT * FROM dispensing_records WHERE id=$1', [recordId]);
  if (rec.rows.length === 0) throw new Error('Record not found');
  if (rec.rows[0].verifier_id) throw new Error('Already verified');
  if (rec.rows[0].operator_id === verifierId) {
    throw new Error('Dual verification required (21 CFR 211.101): verifier must be a different person than the operator who dispensed');
  }

  const r = await query(
    `UPDATE dispensing_records SET verifier_id=$1, verified_at=NOW() WHERE id=$2 RETURNING *`,
    [verifierId, recordId]);

  // Also update the order verified_by
  await query(
    `UPDATE dispensing_orders SET verified_by=$1, verified_at=NOW(), updated_at=NOW() WHERE id=$2`,
    [verifierId, r.rows[0].order_id]);

  return r.rows[0];
}

// ════════════════════════════════════════════════════════════════
// STATS
// ════════════════════════════════════════════════════════════════

async function getStats() {
  const [total, byStatus, outOfTol, todayCount] = await Promise.all([
    query('SELECT COUNT(*) as cnt FROM dispensing_orders'),
    query('SELECT status, COUNT(*) as cnt FROM dispensing_orders GROUP BY status'),
    query('SELECT COUNT(*) as cnt FROM dispensing_records WHERE within_tolerance=false'),
    query(`SELECT COUNT(*) as cnt FROM dispensing_orders WHERE created_at >= CURRENT_DATE`),
  ]);
  return {
    total_orders: parseInt(total.rows[0].cnt),
    by_status: byStatus.rows,
    out_of_tolerance: parseInt(outOfTol.rows[0].cnt),
    today: parseInt(todayCount.rows[0].cnt),
    pending: (byStatus.rows.find(s => s.status === 'Pending')?.cnt || 0),
    completed: (byStatus.rows.find(s => s.status === 'Completed')?.cnt || 0),
  };
}

module.exports = {
  createOrdersFromBOM, listOrders, getOrder,
  getAvailableLots, recordWeighing, verifyWeighing,
  getStats,
};
