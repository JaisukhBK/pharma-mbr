// server/db/block-carlos.js
// Run: node db/block-carlos.js

'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { query, runMigrations } = require('./pool');

(async () => {
  await runMigrations();

  const u = await query("SELECT id, full_name, status, training_status FROM users WHERE email='carlos.martinez@pharmambr.com'");
  if (!u.rows.length) { console.log('User not found'); process.exit(1); }
  const uid = u.rows[0].id;
  console.log('Found:', u.rows[0].full_name, '| Status:', u.rows[0].status, '| Training:', u.rows[0].training_status);

  // 1. Suspend account — login will be rejected with 403
  await query("UPDATE users SET status='Suspended', training_status='Pending', updated_at=NOW() WHERE id=$1", [uid]);
  console.log('\n  Account status  -> Suspended');
  console.log('  Training status -> Pending');

  // 2. Delete completed training records, insert as Pending
  await query('DELETE FROM training_records WHERE user_id=$1', [uid]);
  const curricula = await query("SELECT id, course_code FROM training_curricula WHERE is_active=true AND 'designer'=ANY(required_for_roles)");
  for (const c of curricula.rows) {
    await query(
      "INSERT INTO training_records (curriculum_id, user_id, status, assigned_by, due_date, evidence_notes) VALUES ($1,$2,'Pending',$2, NOW() + INTERVAL '7 days', 'Training incomplete - account suspended')",
      [c.id, uid]
    );
    console.log('  Training pending:', c.course_code);
  }

  console.log('\n  Carlos Martinez is now BLOCKED.');
  console.log('  Login will show: "Account is suspended. Contact your administrator."');
  console.log('  Email: carlos.martinez@pharmambr.com / pharma123');
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
