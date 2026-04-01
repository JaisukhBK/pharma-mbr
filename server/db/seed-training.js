// server/db/seed-training.js — One-time: complete training for all existing users
// Run: node db/seed-training.js

require('dotenv').config();
const { pool, query, initializeDatabase } = require('./pool');

async function seedTraining() {
  await initializeDatabase();

  // Get all active users
  const users = await query('SELECT id, email, full_name, role FROM users WHERE is_active=true');
  console.log(`\n[TRAINING SEED] Found ${users.rows.length} active users\n`);

  // Get all active curricula
  const curricula = await query('SELECT id, course_code, course_name, required_for_roles, validity_months FROM training_curricula WHERE is_active=true');
  console.log(`[TRAINING SEED] Found ${curricula.rows.length} active curricula\n`);

  let assigned = 0;
  let skipped = 0;

  for (const user of users.rows) {
    const requiredCourses = curricula.rows.filter(c =>
      c.required_for_roles && c.required_for_roles.includes(user.role)
    );

    for (const course of requiredCourses) {
      // Check if already has a Completed record
      const existing = await query(
        "SELECT id, status FROM training_records WHERE curriculum_id=$1 AND user_id=$2 AND status='Completed'",
        [course.id, user.id]
      );

      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      // Delete any pending/expired records for this course
      await query(
        "DELETE FROM training_records WHERE curriculum_id=$1 AND user_id=$2 AND status != 'Completed'",
        [course.id, user.id]
      );

      // Create completed record
      const expiry = new Date();
      expiry.setMonth(expiry.getMonth() + (course.validity_months || 12));

      await query(
        `INSERT INTO training_records (curriculum_id, user_id, status, assigned_by, completed_at, completed_by, expiry_date, evidence_notes)
         VALUES ($1, $2, 'Completed', $2, NOW(), $2, $3, $4)`,
        [course.id, user.id, expiry.toISOString(), `Initial training completion — system seed on ${new Date().toISOString().split('T')[0]}`]
      );
      assigned++;

      console.log(`  ✓ ${user.full_name} (${user.role}) — ${course.course_code}: ${course.course_name}`);
    }
  }

  console.log(`\n[TRAINING SEED] Complete: ${assigned} records created, ${skipped} already existed\n`);
  await pool.end();
}

seedTraining().catch(err => { console.error('Failed:', err); process.exit(1); });
