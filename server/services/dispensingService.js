// server/services/dispensingService.js — Electronic Weighing & Dispensing
// 21 CFR 211.101 — Charge-in of components shall be weighed and verified
// 21 CFR 211.137 — Expired components must not be used

const { query } = require('../db/pool');

const toNum = (v) => (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) ? null : parseFloat(v);

// Error with an HTTP status, so routes can return 4xx instead of 500
function httpError(status, message) {
  const e = new Error(message);
  e.status = status;
  return e;
}

// A lot is usable only if Released, has stock, and is not expired.
// Expiry is compared against the database's CURRENT_DATE (UTC on Neon).
// NOTE: lots with NULL expiry_date are allowed. Under GMP every component
// should carry an expiry or retest date — tighten this once your data has them.
const LOT_USABLE_SQL = `
  l.status = 'Released'
  AND l.quantity_available > 0
  AND (l.expiry_date IS NULL OR l.expiry_date > CURRENT_DATE)`;

// ════════════════════════════════════════════════════════════════
// DISPENSING ORDERS — create from BOM per batch
// ════════════════════════════════════════════════════════════════

async function createOrdersFromBOM(ebrId, batchNumber, mbrId) {
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
// LOT SELECTION — FEFO (First Expiry First Out), valid lots only
// ════════════════════════════════════════════════════════════════

async function getAvailableLots(materialId, requiredQty) {
  if (!materialId) {
    return {
      available_lots: [], recommended_allocation: [], excluded_lots: [],
      total_available: 0, sufficient: false,
      warning: 'Order has no linked material master record — lots cannot be selected',
    };
  }

  const [lots, excluded] = await Promise.all([
    query(
      `SELECT l.*, m.material_name, m.material_code
       FROM material_lots l JOIN material_master m ON l.material_id=m.id
       WHERE l.material_id=$1 AND ${LOT_USABLE_SQL}
       ORDER BY l.expiry_date ASC NULLS LAST, l.received_date ASC`, [materialId]),
    // Lots with stock that are NOT usable — returned so the UI can show why
    query(
      `SELECT l.id, l.lot_number, l.status, l.expiry_date, l.quantity_available
       FROM material_lots l
       WHERE l.material_id=$1 AND l.quantity_available > 0 AND NOT (${LOT_USABLE_SQL})
       ORDER BY l.expiry_date ASC NULLS LAST`, [materialId]),
  ]);

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
    excluded_lots: excluded.rows.map(function(l) {
      return { ...l, excluded_reason: l.status !== 'Released' ? 'Status: ' + l.status : 'Expired' };
    }),
    total_available: lots.rows.reduce((s, l) => s + parseFloat(l.quantity_available), 0),
    sufficient: remaining <= 0,
  };
}

// ════════════════════════════════════════════════════════════════
// WEIGHING — validate lot, check tolerance, then record
// ════════════════════════════════════════════════════════════════

async function recordWeighing(orderId, data) {
  const order = await query('SELECT * FROM dispensing_orders WHERE id=$1', [orderId]);
  if (order.rows.length === 0) throw httpError(404, 'Dispensing order not found');
  const ord = order.rows[0];

  if (ord.status === 'Completed') {
    throw httpError(409, 'Order already dispensed — a second weighing would deduct the lot twice');
  }
  if (!ord.material_id) {
    throw httpError(422, 'Order has no linked material master record — lot cannot be verified');
  }

  // ── Weights ──
  const tare = toNum(data.tare_weight) || 0;
  const gross = toNum(data.gross_weight);
  if (gross === null) throw httpError(400, 'gross_weight is required');
  if (tare < 0) throw httpError(400, 'tare_weight cannot be negative');
  const net = gross - tare;
  if (net <= 0) throw httpError(400, 'Net weight must be greater than 0 (gross must exceed tare)');

  // ── Tolerance — out-of-tolerance material is not accepted ──
  const target = parseFloat(ord.target_quantity);
  const tolPct = parseFloat(ord.tolerance_pct) || 2.0;
  const tolMin = target * (1 - tolPct / 100);
  const tolMax = target * (1 + tolPct / 100);
  const withinTolerance = net >= tolMin && net <= tolMax;
  if (!withinTolerance) {
    throw httpError(422,
      'Net weight ' + net.toFixed(4) + ' ' + ord.unit + ' is outside tolerance (' +
      tolMin.toFixed(4) + '–' + tolMax.toFixed(4) + '). Adjust the material and re-weigh.');
  }

  // ── Lot validation (never trust the client's lot choice) ──
  const lotRes = await query(
    `SELECT l.*, (l.expiry_date IS NOT NULL AND l.expiry_date <= CURRENT_DATE) AS is_expired
     FROM material_lots l WHERE l.id=$1`, [data.lot_id]);
  if (lotRes.rows.length === 0) throw httpError(404, 'Lot not found');
  const lot = lotRes.rows[0];

  if (lot.material_id !== ord.material_id) {
    throw httpError(422, 'Lot ' + lot.lot_number + ' belongs to a different material than this order');
  }
  if (lot.status !== 'Released') {
    throw httpError(422, 'Lot ' + lot.lot_number + ' is not released (status: ' + lot.status + ')');
  }
  if (lot.is_expired) {
    throw httpError(422, 'Lot ' + lot.lot_number + ' is expired and cannot be dispensed (21 CFR 211.137)');
  }
  if (parseFloat(lot.quantity_available) < net) {
    throw httpError(422, 'Lot ' + lot.lot_number + ' has only ' + lot.quantity_available + ' ' + ord.unit + ' available');
  }

  // ── Atomic deduction: re-checks every rule in one statement, so two
  //    simultaneous weighings cannot both pass the checks above ──
  const deduct = await query(
    `UPDATE material_lots l SET quantity_available = quantity_available - $1, updated_at=NOW()
     WHERE l.id=$2 AND l.material_id=$3 AND l.quantity_available >= $1 AND ${LOT_USABLE_SQL}
     RETURNING l.id`,
    [net, lot.id, ord.material_id]);
  if (deduct.rows.length === 0) {
    throw httpError(409, 'Lot ' + lot.lot_number + ' changed during weighing (stock, status or expiry). Reload and retry.');
  }

  // Lot number comes from the database, not the request body
  const r = await query(
    `INSERT INTO dispensing_records
       (order_id, lot_id, lot_number, tare_weight, gross_weight, net_weight, unit,
        balance_id, balance_name, tolerance_min, tolerance_max, within_tolerance,
        operator_id, environment_temp, environment_rh, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING *`,
    [orderId, lot.id, lot.lot_number, tare, gross, net, ord.unit,
     data.balance_id, data.balance_name, tolMin, tolMax, withinTolerance,
     data.operator_id, toNum(data.environment_temp), toNum(data.environment_rh), data.notes]);

  await query(
    `UPDATE dispensing_orders SET status='Completed', dispensed_quantity=$1,
     assigned_lot_id=$2, assigned_lot_number=$3, dispensed_by=$4, dispensed_at=NOW(), updated_at=NOW()
     WHERE id=$5`,
    [net, lot.id, lot.lot_number, data.operator_id, orderId]);

  await query(
    `INSERT INTO material_transactions (lot_id, material_id, transaction_type, quantity, unit, batch_number, performed_by, reason)
     VALUES ($1,$2,'Dispense',$3,$4,$5,$6,$7)`,
    [lot.id, ord.material_id, net, ord.unit, ord.batch_number, data.operator_id,
     'Dispensed for batch ' + ord.batch_number]);

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
  if (rec.rows.length === 0) throw httpError(404, 'Record not found');
  if (rec.rows[0].verifier_id) throw httpError(409, 'Already verified');
  if (rec.rows[0].operator_id === verifierId) {
    throw httpError(403, 'Dual verification required (21 CFR 211.101): verifier must be a different person than the operator who dispensed');
  }

  const r = await query(
    `UPDATE dispensing_records SET verifier_id=$1, verified_at=NOW() WHERE id=$2 RETURNING *`,
    [verifierId, recordId]);

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
