// server/services/trainingService.js — Training Management (fixed for M-001 schema)
const { query } = require('../db/pool');

async function getRequiredCurricula(role) {
  const r = await query(
    "SELECT * FROM training_curricula WHERE is_active=true AND $1=ANY(required_for_roles) ORDER BY course_code",
    [role]
  );
  return r.rows;
}

async function getTrainingStatus(userId, role) {
  const curricula = await getRequiredCurricula(role);
  const results = [];
  for (const c of curricula) {
    const rec = await query(
      'SELECT * FROM training_records WHERE curriculum_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1',
      [c.id, userId]
    );
    const record = rec.rows[0] || null;
    let status = 'missing';
    if (record) {
      if (record.status === 'Completed' || record.status === 'Waived') {
        status = (record.expiry_date && new Date(record.expiry_date) < new Date()) ? 'expired' : 'complete';
      } else if (record.status === 'Expired') {
        status = 'expired';
      } else {
        status = 'pending';
      }
    }
    results.push({
      curriculum: { id: c.id, course_code: c.course_code, course_name: c.course_name, validity_months: c.validity_months },
      record, status,
    });
  }
  return results;
}

async function isTrainingComplete(userId, role) {
  const statuses = await getTrainingStatus(userId, role);
  const missing = statuses.filter(s => s.status === 'missing').map(s => s.curriculum);
  const expired = statuses.filter(s => s.status === 'expired').map(s => s.curriculum);
  const pending = statuses.filter(s => s.status === 'pending').map(s => s.curriculum);
  return {
    compliant: missing.length === 0 && expired.length === 0 && pending.length === 0,
    total_required: statuses.length,
    completed: statuses.filter(s => s.status === 'complete').length,
    missing, expired, pending,
  };
}

function requireTrainingComplete() {
  return async (req, res, next) => {
    if (!req.session?.userId || !req.session?.role) return next();
    try {
      const result = await isTrainingComplete(req.session.userId, req.session.role);
      if (!result.compliant) {
        const missingNames = [...result.missing, ...result.expired, ...result.pending].map(c => c.course_name);
        return res.status(403).json({
          error: 'Training requirement not met (21 CFR Part 11 §11.10(i))',
          message: `Complete all required training. ${result.completed}/${result.total_required} done.`,
          missing_training: missingNames,
        });
      }
      next();
    } catch (err) { console.error('[TRAINING] Gate check error:', err.message); next(); }
  };
}

async function assignTraining(curriculumId, userId, assignedBy, dueDate) {
  const existing = await query(
    "SELECT id FROM training_records WHERE curriculum_id=$1 AND user_id=$2 AND status IN ('Pending','In Progress')",
    [curriculumId, userId]
  );
  if (existing.rows.length > 0) return { error: 'Training already assigned', existing_id: existing.rows[0].id };
  const r = await query(
    "INSERT INTO training_records (curriculum_id, user_id, assigned_by, due_date, status) VALUES ($1,$2,$3,$4,'Pending') RETURNING *",
    [curriculumId, userId, assignedBy, dueDate]
  );
  return r.rows[0];
}

async function completeTraining(recordId, completedBy, score, evidenceNotes) {
  const rec = await query(
    'SELECT tr.*, tc.validity_months FROM training_records tr JOIN training_curricula tc ON tr.curriculum_id=tc.id WHERE tr.id=$1',
    [recordId]
  );
  if (rec.rows.length === 0) return { error: 'Training record not found' };
  if (rec.rows[0].status === 'Completed') return { error: 'Already completed' };
  const exp = new Date(); exp.setMonth(exp.getMonth() + (rec.rows[0].validity_months || 12));
  const r = await query(
    "UPDATE training_records SET status='Completed', completed_at=NOW(), completed_by=$1, expiry_date=$2, score=$3, evidence_notes=$4, updated_at=NOW() WHERE id=$5 RETURNING *",
    [completedBy, exp.toISOString(), score, evidenceNotes, recordId]
  );
  return r.rows[0];
}

async function getExpiringTraining(daysAhead = 30) {
  const future = new Date(); future.setDate(future.getDate() + daysAhead);
  const r = await query(
    `SELECT tr.*, tc.course_code, tc.course_name, u.full_name, u.email
     FROM training_records tr JOIN training_curricula tc ON tr.curriculum_id=tc.id JOIN users u ON tr.user_id=u.id
     WHERE tr.status='Completed' AND tr.expiry_date IS NOT NULL AND tr.expiry_date <= $1 ORDER BY tr.expiry_date ASC`,
    [future.toISOString()]
  );
  return r.rows;
}

async function expireOverdueTraining() {
  const r = await query(
    "UPDATE training_records SET status='Expired', updated_at=NOW() WHERE status='Completed' AND expiry_date < NOW() RETURNING id, user_id, curriculum_id"
  );
  return r.rows;
}

async function getTrainingMatrix() {
  // Use group_id/title/status instead of role/department/is_active
  const users = await query(
    "SELECT id, email, full_name, group_id as role, title as department FROM users WHERE status='Active' ORDER BY full_name"
  );
  const curricula = await query(
    "SELECT * FROM training_curricula WHERE is_active=true ORDER BY course_code"
  );
  const matrix = [];
  for (const user of users.rows) {
    const row = { user_id: user.id, full_name: user.full_name, email: user.email, role: user.role, department: user.department, courses: [], compliant: true };
    for (const course of curricula.rows) {
      const isRequired = course.required_for_roles && course.required_for_roles.includes(user.role);
      if (!isRequired) { row.courses.push({ course_code: course.course_code, course_name: course.course_name, required: false, status: 'N/A' }); continue; }
      const rec = await query('SELECT * FROM training_records WHERE curriculum_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1', [course.id, user.id]);
      const record = rec.rows[0];
      let status = 'Missing';
      if (record) {
        if ((record.status === 'Completed' || record.status === 'Waived') && (!record.expiry_date || new Date(record.expiry_date) >= new Date())) { status = 'Complete'; }
        else if ((record.expiry_date && new Date(record.expiry_date) < new Date()) || record.status === 'Expired') { status = 'Expired'; row.compliant = false; }
        else { status = record.status; row.compliant = false; }
      } else { row.compliant = false; }
      row.courses.push({ course_code: course.course_code, course_name: course.course_name, required: true, status, completed_at: record?.completed_at, expiry_date: record?.expiry_date });
    }
    matrix.push(row);
  }
  return {
    generated_at: new Date().toISOString(), total_users: users.rows.length, total_courses: curricula.rows.length,
    compliant_users: matrix.filter(r => r.compliant).length, non_compliant_users: matrix.filter(r => !r.compliant).length, matrix,
  };
}

module.exports = { getRequiredCurricula, getTrainingStatus, isTrainingComplete, requireTrainingComplete, assignTraining, completeTraining, getExpiringTraining, expireOverdueTraining, getTrainingMatrix };
