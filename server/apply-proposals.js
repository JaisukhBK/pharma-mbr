// apply-proposals.js — Run from server folder: node apply-proposals.js
// Directly applies accepted proposals that failed to auto-apply
require('dotenv').config();
const pg = require('pg');

async function run() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  console.log('Connected.\n');

  // Find accepted proposals that didn't create phases
  const proposals = await client.query(
    `SELECT p.id, p.mbr_id, p.proposal_type, p.proposed_data, p.reasoning
     FROM co_designer_proposals p
     WHERE p.status = 'accepted' AND p.proposal_type = 'phase'
     ORDER BY p.created_at ASC`
  );

  console.log(`Found ${proposals.rows.length} accepted phase proposals.\n`);

  for (const prop of proposals.rows) {
    const data = typeof prop.proposed_data === 'string' ? JSON.parse(prop.proposed_data) : prop.proposed_data;
    const mbrId = prop.mbr_id;

    console.log(`--- Proposal ${prop.id.substring(0, 8)} ---`);
    console.log(`  MBR: ${mbrId}`);
    console.log(`  Phase: ${data.phase_name || '(missing)'}`);
    console.log(`  Steps: ${(data.steps || []).length}`);
    console.log(`  Full data keys: ${Object.keys(data).join(', ')}`);

    if (!data.phase_name) {
      console.log('  ⚠ SKIP: No phase_name in data\n');
      continue;
    }

    // Check if phase already exists for this MBR
    const existing = await client.query(
      'SELECT id FROM mbr_phases WHERE mbr_id=$1 AND phase_name=$2',
      [mbrId, data.phase_name]
    );
    if (existing.rows.length > 0) {
      console.log(`  ⚠ SKIP: Phase "${data.phase_name}" already exists (${existing.rows[0].id})\n`);
      continue;
    }

    try {
      // Create phase
      const phCnt = await client.query('SELECT COALESCE(MAX(phase_number),0)+1 as n FROM mbr_phases WHERE mbr_id=$1', [mbrId]);
      const phaseNum = data.sequence || phCnt.rows[0].n;
      const newPhase = await client.query(
        'INSERT INTO mbr_phases (mbr_id, phase_number, phase_name, description, sort_order) VALUES ($1,$2,$3,$4,$2) RETURNING id',
        [mbrId, phaseNum, data.phase_name, data.description || '']
      );
      const phaseId = newPhase.rows[0].id;
      console.log(`  ✓ Phase created: ${data.phase_name} (${phaseId})`);

      // Create nested steps
      for (const step of (data.steps || [])) {
        const stCnt = await client.query('SELECT COALESCE(MAX(step_number),0)+1 as n FROM mbr_steps WHERE phase_id=$1', [phaseId]);
        const newStep = await client.query(
          'INSERT INTO mbr_steps (phase_id, mbr_id, step_number, step_name, instruction, step_type, duration_min, is_critical, is_gmp_critical, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$3) RETURNING id',
          [phaseId, mbrId, stCnt.rows[0].n, step.step_name, step.instruction, step.step_type || 'Processing', step.duration_min, step.is_critical || false, step.is_gmp_critical || false]
        );
        const stepId = newStep.rows[0].id;
        console.log(`    ✓ Step: ${step.step_name} (${stepId})`);

        for (const p of (step.parameters || [])) {
          await client.query(
            'INSERT INTO mbr_step_parameters (step_id, mbr_id, param_name, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [stepId, mbrId, p.param_name, p.target_value, p.unit, p.lower_limit, p.upper_limit, p.is_cpp || false, p.is_cqa || false]
          );
          console.log(`      ✓ Param: ${p.param_name} = ${p.target_value} ${p.unit || ''}`);
        }

        for (const e of (step.equipment || [])) {
          await client.query(
            'INSERT INTO mbr_step_equipment (step_id, mbr_id, equipment_code, equipment_name, equipment_type, capacity, is_primary) VALUES ($1,$2,$3,$4,$5,$6,true)',
            [stepId, mbrId, null, e.equipment_name, e.equipment_type || 'Blender', e.capacity]
          );
          console.log(`      ✓ Equipment: ${e.equipment_name}`);
        }

        for (const m of (step.materials || [])) {
          await client.query(
            'INSERT INTO mbr_step_materials (step_id, mbr_id, material_code, material_name, material_type, quantity, unit, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [stepId, mbrId, m.material_code, m.material_name, m.material_type || 'Raw Material', m.quantity, m.unit, m.is_active || false]
          );
          console.log(`      ✓ Material: ${m.material_name}`);
        }

        for (const c of (step.ipc_checks || [])) {
          await client.query(
            'INSERT INTO mbr_ipc_checks (step_id, mbr_id, check_name, check_type, specification, frequency) VALUES ($1,$2,$3,$4,$5,$6)',
            [stepId, mbrId, c.check_name, c.check_type, c.specification, c.frequency]
          );
          console.log(`      ✓ IPC: ${c.check_name}`);
        }
      }

      console.log('');
    } catch (err) {
      console.error(`  ✗ ERROR: ${err.message}`);
      console.error(`  SQL detail: ${err.detail || 'none'}`);
      console.error(`  Data was: ${JSON.stringify(data).substring(0, 300)}\n`);
    }
  }

  // Final verification
  console.log('=== VERIFICATION ===');
  const mbrs = await client.query("SELECT id, mbr_code, product_name FROM mbrs WHERE product_name LIKE '%Copy%' OR product_name LIKE '%Omeprazole%' ORDER BY created_at DESC LIMIT 5");
  for (const mbr of mbrs.rows) {
    const phases = await client.query('SELECT phase_number, phase_name FROM mbr_phases WHERE mbr_id=$1 ORDER BY phase_number', [mbr.id]);
    const steps = await client.query('SELECT step_name FROM mbr_steps WHERE mbr_id=$1', [mbr.id]);
    console.log(`${mbr.mbr_code}: ${phases.rows.length} phases, ${steps.rows.length} steps`);
    phases.rows.forEach(p => console.log(`  ${p.phase_number}. ${p.phase_name}`));
  }

  await client.end();
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
