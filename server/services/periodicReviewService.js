// server/services/periodicReviewService.js — Periodic Review Scheduler
// GAMP5 D10 | EU Annex 11 §11

const { query } = require('../db/pool');

async function getReviews(filters = {}) {
  let sql = `SELECT pr.*, u1.full_name as assigned_to_name, u2.full_name as completed_by_name
             FROM periodic_reviews pr
             LEFT JOIN users u1 ON pr.assigned_to=u1.id
             LEFT JOIN users u2 ON pr.completed_by=u2.id WHERE 1=1`;
  const params = []; let i = 1;
  if (filters.status) { sql += ` AND pr.status=$${i++}`; params.push(filters.status); }
  if (filters.review_type) { sql += ` AND pr.review_type=$${i++}`; params.push(filters.review_type); }
  sql += ' ORDER BY pr.next_due ASC';
  const r = await query(sql, params);
  return r.rows;
}

async function createReview({ reviewType, title, description, frequencyMonths, nextDue, assignedTo, createdBy }) {
  const r = await query(
    `INSERT INTO periodic_reviews (review_type, title, description, frequency_months, next_due, assigned_to, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [reviewType, title, description, frequencyMonths || 12, nextDue, assignedTo, createdBy]
  );
  return r.rows[0];
}

async function completeReview(reviewId, userId, findings, correctiveActions) {
  const rev = await query('SELECT * FROM periodic_reviews WHERE id=$1', [reviewId]);
  if (rev.rows.length === 0) return { error: 'Review not found' };
  if (rev.rows[0].status === 'Completed') return { error: 'Review already completed' };

  const freq = rev.rows[0].frequency_months || 12;
  const nextDue = new Date();
  nextDue.setMonth(nextDue.getMonth() + freq);

  const r = await query(
    `UPDATE periodic_reviews SET status='Completed', completed_by=$1, completed_at=NOW(),
     findings=$2, corrective_actions=$3, last_completed=NOW(), next_due=$4, updated_at=NOW()
     WHERE id=$5 RETURNING *`,
    [userId, findings, correctiveActions, nextDue.toISOString(), reviewId]
  );

  // Auto-schedule next occurrence (reset status)
  await query(
    'UPDATE periodic_reviews SET status=$1 WHERE id=$2',
    ['Scheduled', reviewId]
  );

  return r.rows[0];
}

async function getOverdueReviews() {
  const r = await query(
    "SELECT * FROM periodic_reviews WHERE status IN ('Scheduled','In Progress') AND next_due < NOW() ORDER BY next_due ASC"
  );
  // Mark as overdue
  for (const rev of r.rows) {
    await query("UPDATE periodic_reviews SET status='Overdue', updated_at=NOW() WHERE id=$1 AND status != 'Overdue'", [rev.id]);
  }
  return r.rows;
}

async function getUpcomingReviews(daysAhead = 30) {
  const future = new Date();
  future.setDate(future.getDate() + daysAhead);
  const r = await query(
    "SELECT * FROM periodic_reviews WHERE status IN ('Scheduled','In Progress') AND next_due <= $1 ORDER BY next_due ASC",
    [future.toISOString()]
  );
  return r.rows;
}

async function getDashboard() {
  const all = await query('SELECT * FROM periodic_reviews ORDER BY next_due ASC');
  const now = new Date();
  return {
    total: all.rows.length,
    overdue: all.rows.filter(r => ['Scheduled', 'In Progress'].includes(r.status) && new Date(r.next_due) < now).length,
    upcoming_30d: all.rows.filter(r => {
      const due = new Date(r.next_due);
      const in30 = new Date(); in30.setDate(in30.getDate() + 30);
      return ['Scheduled', 'In Progress'].includes(r.status) && due >= now && due <= in30;
    }).length,
    completed_this_year: all.rows.filter(r => r.completed_at && new Date(r.completed_at).getFullYear() === now.getFullYear()).length,
    reviews: all.rows,
  };
}

module.exports = { getReviews, createReview, completeReview, getOverdueReviews, getUpcomingReviews, getDashboard };
