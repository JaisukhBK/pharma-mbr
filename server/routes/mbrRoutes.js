// server/routes/mbrRoutes.js — MBR CRUD + Extended Features (unified)
// Merged from: mbrRoutes.js + mbrFeaturesRoutes.js
// Every endpoint maps to the client apiService.js mbrService + featuresService
const { Router } = require('express');
const crypto = require('crypto');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { query, transaction } = require('../db/pool');
const { authenticate, authorize, verifyPasswordForSignature } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
const { exportMBRToXML, importMBRFromXML } = require('../services/xmlService');
const { evaluateFormula, runTrial } = require('../services/formulaService');
const { requireTrainingComplete } = require('../services/trainingService');
const { checkSignaturePrerequisites, assertEditable, requireEditable, logTransition, getTransitions, getNextRequiredSignature } = require('../services/stateMachine');

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// Training gate — blocks untrained users (Part 11 §11.10(i))
router.use(requireTrainingComplete());

// Edit lock middleware instance (Part 11 §11.10(f) + GAMP5 D8)
const editLock = requireEditable();

// Multer config for attachments + XML import
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => cb(null, `doc-${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ═══ LIST MBRs ═══
router.get('/', async (req, res) => {
  try {
    const { status, search, page = 1, limit = 50 } = req.query;
    let sql = `SELECT m.*, u.full_name as created_by_name,
      (SELECT COUNT(*) FROM mbr_phases WHERE mbr_id=m.id) as phase_count,
      (SELECT COUNT(*) FROM mbr_steps WHERE mbr_id=m.id) as step_count,
      (SELECT COUNT(*) FROM ebrs WHERE mbr_id=m.id) as ebr_count
      FROM mbrs m LEFT JOIN users u ON m.created_by=u.id WHERE 1=1`;
    const p = []; let i = 1;
    if (status) { sql += ` AND m.status=$${i++}`; p.push(status); }
    if (search && search !== 'undefined') { sql += ` AND (m.product_name ILIKE $${i} OR m.mbr_code ILIKE $${i})`; p.push(`%${search}%`); i++; }
    sql += ` ORDER BY m.updated_at DESC LIMIT $${i++} OFFSET $${i++}`;
    p.push(parseInt(limit), (parseInt(page)-1)*parseInt(limit));
    const r = await query(sql, p);
    res.json({ data: r.rows });
  } catch (err) { console.error('[MBR] List:', err); res.status(500).json({ error: 'Failed to list MBRs' }); }
});

// ═══ GET MBR with full nested hierarchy ═══
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const mbrR = await query('SELECT * FROM mbrs WHERE id=$1', [id]);
    if (mbrR.rows.length === 0) return res.status(404).json({ error: 'MBR not found' });
    const phasesR = await query('SELECT * FROM mbr_phases WHERE mbr_id=$1 ORDER BY sort_order,phase_number', [id]);
    const stepsR = await query('SELECT * FROM mbr_steps WHERE mbr_id=$1 ORDER BY sort_order,step_number', [id]);
    const [paramsR, matsR, eqR, ipcR] = await Promise.all([
      query('SELECT * FROM mbr_step_parameters WHERE mbr_id=$1', [id]),
      query('SELECT * FROM mbr_step_materials WHERE mbr_id=$1', [id]),
      query('SELECT * FROM mbr_step_equipment WHERE mbr_id=$1', [id]),
      query('SELECT * FROM mbr_ipc_checks WHERE mbr_id=$1', [id]),
    ]);
    const [bomR, sigR, formulasR, attachR] = await Promise.all([
      query('SELECT * FROM mbr_bom_items WHERE mbr_id=$1 ORDER BY sort_order', [id]),
      query('SELECT s.*,u.full_name as signer_name FROM mbr_signatures s LEFT JOIN users u ON s.signer_id=u.id WHERE s.mbr_id=$1 ORDER BY s.signed_at', [id]),
      query('SELECT * FROM mbr_formulas WHERE mbr_id=$1 ORDER BY created_at', [id]),
      query('SELECT id,filename,file_type,file_size,uploaded_by,created_at FROM mbr_attachments WHERE mbr_id=$1 ORDER BY created_at DESC', [id]),
    ]);
    const phases = phasesR.rows.map(ph => ({
      ...ph,
      steps: stepsR.rows.filter(s => s.phase_id === ph.id).map(st => ({
        ...st,
        parameters: paramsR.rows.filter(p => p.step_id === st.id),
        materials: matsR.rows.filter(m => m.step_id === st.id),
        equipment: eqR.rows.filter(e => e.step_id === st.id),
        ipc_checks: ipcR.rows.filter(c => c.step_id === st.id),
      })),
    }));
    res.json({ ...mbrR.rows[0], phases, bom: bomR.rows, signatures: sigR.rows, formulas: formulasR.rows, attachments: attachR.rows });
  } catch (err) { console.error('[MBR] Get:', err); res.status(500).json({ error: 'Failed' }); }
});

// ═══ DELETE MBR ═══
router.delete('/:id', authorize('mbr:write'), async (req, res) => {
  try {
    const { id } = req.params;
    // Check if MBR has active EBRs
    const ebrs = await query("SELECT COUNT(*) as cnt FROM ebrs WHERE mbr_id=$1 AND status IN ('In Progress','Ready')", [id]);
    if (parseInt(ebrs.rows[0].cnt) > 0) return res.status(400).json({ error: 'Cannot delete: MBR has active batch records' });
    // Delete cascades (phases → steps → params etc.)
    const r = await query('DELETE FROM mbrs WHERE id=$1 RETURNING mbr_code, product_name', [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'MBR not found' });
    // Also delete from master_batch_records (legacy FK table)
    await query('DELETE FROM master_batch_records WHERE id=$1', [id]).catch(() => {});
    await req.audit({ action: 'DELETE', resourceType: 'MBR', resourceId: id, details: 'Deleted: ' + r.rows[0].mbr_code + ' — ' + r.rows[0].product_name });
    res.json({ deleted: true, mbr_code: r.rows[0].mbr_code });
  } catch (err) { console.error('[MBR] Delete:', err); res.status(500).json({ error: 'Delete failed: ' + err.message }); }
});

// ═══ CREATE MBR ═══
router.post('/', authorize('mbr:write'), async (req, res) => {
  try {
    const { product_name, product_code, dosage_form, batch_size, batch_size_unit, description, strength, market, batch_type, sap_recipe_id, sap_material_number } = req.body;
    if (!product_name) return res.status(400).json({ error: 'product_name required' });
    const code = 'MBR-' + Date.now().toString(36).toUpperCase();
    const r = await query(
      `INSERT INTO mbrs (mbr_code,product_name,product_code,dosage_form,batch_size,batch_size_unit,description,strength,market,batch_type,sap_recipe_id,sap_material_number,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
      [code, product_name, product_code, dosage_form||'Tablet', batch_size, batch_size_unit||'kg', description, strength, market, batch_type||'Production', sap_recipe_id, sap_material_number, req.session.userId]
    );
    // Also insert into master_batch_records (M-002 FK target) — mbr_phases references this table
    try {
      await query(
        `INSERT INTO master_batch_records (id, mbr_code, product_name, product_code, dosage_form, batch_size, batch_size_unit, description, status, current_version, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [r.rows[0].id, code, product_name, product_code, dosage_form||'Tablet', batch_size, batch_size_unit||'kg', description, 'Draft', 1, req.session.userId]
      );
    } catch (fkErr) { console.log('[MBR] master_batch_records sync:', fkErr.message); }
    await req.audit({ action:'CREATE', resourceType:'MBR', resourceId:r.rows[0].id, details:`Created MBR: ${code}` });
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ UPDATE MBR ═══
router.put('/:id', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const cur = await query('SELECT * FROM mbrs WHERE id=$1', [req.params.id]);
    if (cur.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const { product_name, product_code, dosage_form, batch_size, batch_size_unit, description, strength, market, batch_type, sap_recipe_id, sap_material_number, change_reason } = req.body;
    const r = await query(
      `UPDATE mbrs SET product_name=COALESCE($1,product_name),product_code=COALESCE($2,product_code),dosage_form=COALESCE($3,dosage_form),batch_size=COALESCE($4,batch_size),batch_size_unit=COALESCE($5,batch_size_unit),description=COALESCE($6,description),strength=COALESCE($7,strength),market=COALESCE($8,market),batch_type=COALESCE($9,batch_type),sap_recipe_id=COALESCE($10,sap_recipe_id),sap_material_number=COALESCE($11,sap_material_number),updated_at=NOW() WHERE id=$12 RETURNING *`,
      [product_name, product_code, dosage_form, batch_size, batch_size_unit, description, strength, market, batch_type, sap_recipe_id, sap_material_number, req.params.id]
    );
    await req.audit({ action:'UPDATE', resourceType:'MBR', resourceId:req.params.id, details:`Updated MBR`, changeReason:change_reason });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ PHASES ═══
router.post('/:mbrId/phases', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const cnt = await query('SELECT COALESCE(MAX(phase_number),0)+1 as n FROM mbr_phases WHERE mbr_id=$1', [req.params.mbrId]);
    const n = cnt.rows[0].n;
    const r = await query('INSERT INTO mbr_phases (mbr_id,phase_number,phase_name,description,sort_order) VALUES ($1,$2,$3,$4,$2) RETURNING *',
      [req.params.mbrId, n, req.body.phase_name||'New Unit Procedure', req.body.description]);
    await req.audit({ action:'CREATE', resourceType:'PHASE', resourceId:r.rows[0].id, details:`Phase #${n}: ${req.body.phase_name}` });
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/:mbrId/phases/:phaseId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { phase_name, description, sort_order } = req.body;
    const r = await query('UPDATE mbr_phases SET phase_name=COALESCE($1,phase_name),description=COALESCE($2,description),sort_order=COALESCE($3,sort_order),updated_at=NOW() WHERE id=$4 RETURNING *',
      [phase_name, description, sort_order, req.params.phaseId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/:mbrId/phases/:phaseId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const r = await query('DELETE FROM mbr_phases WHERE id=$1 RETURNING *', [req.params.phaseId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    await req.audit({ action:'DELETE', resourceType:'PHASE', resourceId:req.params.phaseId, details:`Deleted: ${r.rows[0].phase_name}` });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ STEPS ═══
router.post('/:mbrId/phases/:phaseId/steps', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const cnt = await query('SELECT COALESCE(MAX(step_number),0)+1 as n FROM mbr_steps WHERE phase_id=$1', [req.params.phaseId]);
    const n = cnt.rows[0].n;
    const { step_name, instruction, step_type, duration_min, is_critical, is_gmp_critical } = req.body;
    const r = await query(
      'INSERT INTO mbr_steps (phase_id,mbr_id,step_number,step_name,instruction,step_type,duration_min,is_critical,is_gmp_critical,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$3) RETURNING *',
      [req.params.phaseId, req.params.mbrId, n, step_name||'New Operation', instruction, step_type||'Processing', duration_min, is_critical||false, is_gmp_critical||false]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/:mbrId/steps/:stepId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { step_name, instruction, step_type, duration_min, is_critical, is_gmp_critical, sort_order, weighing_config, sampling_plan, yield_config, hold_config, env_config, l2_config } = req.body;
    const r = await query(
      `UPDATE mbr_steps SET step_name=COALESCE($1,step_name),instruction=COALESCE($2,instruction),step_type=COALESCE($3,step_type),duration_min=COALESCE($4,duration_min),is_critical=COALESCE($5,is_critical),is_gmp_critical=COALESCE($6,is_gmp_critical),sort_order=COALESCE($7,sort_order),weighing_config=COALESCE($8,weighing_config),sampling_plan=COALESCE($9,sampling_plan),yield_config=COALESCE($10,yield_config),hold_config=COALESCE($11,hold_config),env_config=COALESCE($12,env_config),l2_config=COALESCE($13,l2_config),updated_at=NOW() WHERE id=$14 RETURNING *`,
      [step_name, instruction, step_type, duration_min, is_critical, is_gmp_critical, sort_order,
       weighing_config?JSON.stringify(weighing_config):null, sampling_plan?JSON.stringify(sampling_plan):null,
       yield_config?JSON.stringify(yield_config):null, hold_config?JSON.stringify(hold_config):null,
       env_config?JSON.stringify(env_config):null, l2_config?JSON.stringify(l2_config):null, req.params.stepId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { console.error('[MBR] Step update:', err); res.status(500).json({ error: 'Failed' }); }
});

router.delete('/:mbrId/steps/:stepId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const r = await query('DELETE FROM mbr_steps WHERE id=$1 RETURNING *', [req.params.stepId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ PARAMETERS ═══
router.post('/:mbrId/steps/:stepId/parameters', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { param_name, param_type, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa } = req.body;
    const r = await query('INSERT INTO mbr_step_parameters (step_id,mbr_id,param_name,param_type,target_value,unit,lower_limit,upper_limit,is_cpp,is_cqa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *',
      [req.params.stepId, req.params.mbrId, param_name, param_type||'numeric', target_value, unit, lower_limit, upper_limit, is_cpp||false, is_cqa||false]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/:mbrId/parameters/:paramId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { param_name, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa } = req.body;
    const r = await query('UPDATE mbr_step_parameters SET param_name=COALESCE($1,param_name),target_value=COALESCE($2,target_value),unit=COALESCE($3,unit),lower_limit=$4,upper_limit=$5,is_cpp=COALESCE($6,is_cpp),is_cqa=COALESCE($7,is_cqa),updated_at=NOW() WHERE id=$8 RETURNING *',
      [param_name, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa, req.params.paramId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/:mbrId/parameters/:paramId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const r = await query('DELETE FROM mbr_step_parameters WHERE id=$1 RETURNING *', [req.params.paramId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ MATERIALS ═══
router.post('/:mbrId/steps/:stepId/materials', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { material_code, material_name, material_type, quantity, unit, is_active } = req.body;
    const r = await query('INSERT INTO mbr_step_materials (step_id,mbr_id,material_code,material_name,material_type,quantity,unit,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [req.params.stepId, req.params.mbrId, material_code, material_name, material_type||'Raw Material', quantity, unit||'kg', is_active||false]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/:mbrId/materials/:materialId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const r = await query('DELETE FROM mbr_step_materials WHERE id=$1 RETURNING *', [req.params.materialId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ EQUIPMENT ═══
router.post('/:mbrId/steps/:stepId/equipment', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { equipment_code, equipment_name, equipment_type, capacity, is_primary } = req.body;
    const r = await query('INSERT INTO mbr_step_equipment (step_id,mbr_id,equipment_code,equipment_name,equipment_type,capacity,is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [req.params.stepId, req.params.mbrId, equipment_code, equipment_name, equipment_type||'Reactor', capacity, is_primary!==false]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ IPC CHECKS ═══
router.post('/:mbrId/steps/:stepId/ipc-checks', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { check_name, check_type, specification, frequency } = req.body;
    const r = await query('INSERT INTO mbr_ipc_checks (step_id,mbr_id,check_name,check_type,specification,frequency) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [req.params.stepId, req.params.mbrId, check_name, check_type||'Visual', specification, frequency]);
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ BOM ═══
router.put('/:mbrId/bom', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { items } = req.body;
    await query('DELETE FROM mbr_bom_items WHERE mbr_id=$1', [req.params.mbrId]);
    for (const item of items) {
      await query('INSERT INTO mbr_bom_items (mbr_id,material_code,material_name,quantity_per_batch,unit,tolerance_pct,tolerance_type,overage_pct,supplier,grade,is_active_ingredient,dispensing_sequence,phase_used,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
        [req.params.mbrId, item.material_code, item.material_name, item.quantity_per_batch, item.unit, item.tolerance_pct, item.tolerance_type, item.overage_pct, item.supplier, item.grade, item.is_active_ingredient, item.dispensing_sequence, item.phase_used, item.sort_order]);
    }
    await req.audit({ action:'UPDATE', resourceType:'BOM', resourceId:req.params.mbrId, details:`BOM updated: ${items.length} items` });
    const r = await query('SELECT * FROM mbr_bom_items WHERE mbr_id=$1 ORDER BY sort_order', [req.params.mbrId]);
    res.json(r.rows);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ REORDER ═══
router.put('/:mbrId/reorder/phases', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    for (let i = 0; i < req.body.ordered_ids.length; i++)
      await query('UPDATE mbr_phases SET sort_order=$1,phase_number=$2,updated_at=NOW() WHERE id=$3', [i+1, i+1, req.body.ordered_ids[i]]);
    res.json({ reordered: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.put('/:mbrId/reorder/steps/:phaseId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    for (let i = 0; i < req.body.ordered_ids.length; i++)
      await query('UPDATE mbr_steps SET sort_order=$1,step_number=$2,updated_at=NOW() WHERE id=$3', [i+1, i+1, req.body.ordered_ids[i]]);
    res.json({ reordered: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ E-SIGNATURES (Part 11 §11.50/§11.200 + §11.10(f) State Machine) ═══
router.post('/:mbrId/sign', authorize('mbr:sign'), async (req, res) => {
  try {
    const { signature_role, signature_meaning, password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password re-entry required (§11.200)' });
    const valid = await verifyPasswordForSignature(req.session.userId, password);
    if (!valid) {
      await req.audit({ action:'SIGN', resourceType:'MBR', resourceId:req.params.mbrId, details:`E-sig FAILED: ${signature_role}` });
      return res.status(401).json({ error: 'Password verification failed' });
    }

    // §11.10(f) — State machine: check signature sequencing prerequisites
    const prereq = await checkSignaturePrerequisites(req.params.mbrId, signature_role);
    if (!prereq.allowed) {
      await req.audit({ action:'SIGN', resourceType:'MBR', resourceId:req.params.mbrId, details:`E-sig BLOCKED (sequencing): ${signature_role} — ${prereq.error}` });
      return res.status(400).json({ error: prereq.error, missing: prereq.missing });
    }

    const mbrState = await query('SELECT * FROM mbrs WHERE id=$1', [req.params.mbrId]);
    if (mbrState.rows.length === 0) return res.status(404).json({ error: 'MBR not found' });
    const contentHash = crypto.createHash('sha256').update(JSON.stringify(mbrState.rows[0])+req.session.userId+signature_role).digest('hex');

    // Get or create version record (required by M-002 FK)
    let versionId = null;
    const hasVerCol = await query("SELECT column_name FROM information_schema.columns WHERE table_name='mbr_signatures' AND column_name='version_id' LIMIT 1");
    if (hasVerCol.rows.length > 0) {
      const verCol2 = (await query("SELECT column_name FROM information_schema.columns WHERE table_name='mbr_versions' AND column_name='version_number' LIMIT 1")).rows.length > 0 ? 'version_number' : 'version';
      const snapCol2 = verCol2 === 'version_number' ? 'snapshot_data' : 'snapshot';
      const existVer = await query(`SELECT id FROM mbr_versions WHERE mbr_id=$1 AND ${verCol2}=$2`, [req.params.mbrId, mbrState.rows[0].current_version]);
      if (existVer.rows.length > 0) {
        versionId = existVer.rows[0].id;
      } else {
        const snap = JSON.stringify(mbrState.rows[0]);
        const newVer = await query(`INSERT INTO mbr_versions (mbr_id,${verCol2},change_reason,${snapCol2},content_hash,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [req.params.mbrId, mbrState.rows[0].current_version, 'Auto-created for signature', snap, contentHash, req.session.userId]);
        versionId = newVer.rows[0].id;
      }
    }

    const sigCols = versionId
      ? 'mbr_id,version_id,signer_id,signer_email,signature_role,signature_meaning,content_hash,password_verified,ip_address'
      : 'mbr_id,signer_id,signer_email,signature_role,signature_meaning,content_hash,password_verified,ip_address';
    const sigVals = versionId
      ? '$1,$2,$3,$4,$5,$6,$7,true,$8'
      : '$1,$2,$3,$4,$5,$6,true,$7';
    const sigParams = versionId
      ? [req.params.mbrId, versionId, req.session.userId, req.session.email, signature_role, signature_meaning, contentHash, req.ip]
      : [req.params.mbrId, req.session.userId, req.session.email, signature_role, signature_meaning, contentHash, req.ip];
    const r = await query(`INSERT INTO mbr_signatures (${sigCols}) VALUES (${sigVals}) RETURNING *`, sigParams);

    // State machine: apply status transition if this signature triggers one
    const oldStatus = mbrState.rows[0].status;
    const newStatus = prereq.next_status || oldStatus;
    if (newStatus !== oldStatus) {
      await query('UPDATE mbrs SET status=$1,approved_by=$2,approved_at=NOW(),updated_at=NOW() WHERE id=$3', [newStatus, req.session.userId, req.params.mbrId]);
      await logTransition(req.params.mbrId, oldStatus, newStatus, signature_role, req.session.userId, `${signature_role} signature by ${req.session.fullName}`);
    }

    const nextRequired = await getNextRequiredSignature(req.params.mbrId);
    await req.audit({ action:'SIGN', resourceType:'MBR', resourceId:req.params.mbrId, details:`E-sig: ${signature_role} by ${req.session.fullName}` });
    res.status(201).json({ signature: r.rows[0], mbr_status: newStatus, content_hash: contentHash, next_signature: nextRequired });
  } catch (err) { console.error('[MBR] Sign:', err); res.status(500).json({ error: 'Failed' }); }
});

// ═══ TRANSITION HISTORY (§11.10(f) audit evidence) ═══
router.get('/:mbrId/transitions', authorize('audit:read'), async (req, res) => {
  try {
    const transitions = await getTransitions(req.params.mbrId);
    const nextRequired = await getNextRequiredSignature(req.params.mbrId);
    res.json({ data: transitions, next_signature: nextRequired });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ VERSIONING ═══
router.post('/:mbrId/new-version', authorize('mbr:write'), async (req, res) => {
  try {
    if (!req.body.change_reason) return res.status(400).json({ error: 'change_reason required' });
    const mbr = await query('SELECT * FROM mbrs WHERE id=$1', [req.params.mbrId]);
    if (mbr.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    const ver = mbr.rows[0].current_version;
    const snap = JSON.stringify(mbr.rows[0]);
    const hash = crypto.createHash('sha256').update(snap).digest('hex');
    // Detect column names (M-002 vs M-007)
    const hasCol = await query("SELECT column_name FROM information_schema.columns WHERE table_name='mbr_versions' AND column_name='version_number' LIMIT 1");
    const verCol = hasCol.rows.length > 0 ? 'version_number' : 'version';
    const snapCol = hasCol.rows.length > 0 ? 'snapshot_data' : 'snapshot';
    await query(`INSERT INTO mbr_versions (mbr_id,${verCol},change_reason,${snapCol},content_hash,created_by) VALUES ($1,$2,$3,$4,$5,$6)`, [req.params.mbrId, ver, req.body.change_reason, snap, hash, req.session.userId]);
    await query(`UPDATE mbrs SET current_version=$1,status='Draft',approved_by=NULL,approved_at=NULL,updated_at=NOW() WHERE id=$2`, [ver+1, req.params.mbrId]);
    res.json({ new_version: ver+1, previous: ver });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ VERSION HISTORY ═══
router.get('/:mbrId/versions', authorize('mbr:read'), async (req, res) => {
  try {
    // M-002 uses version_number/snapshot_data, M-007 uses version/snapshot — handle both
    const hasCol = await query("SELECT column_name FROM information_schema.columns WHERE table_name='mbr_versions' AND column_name='version_number' LIMIT 1");
    const verCol = hasCol.rows.length > 0 ? 'version_number' : 'version';
    const snapCol = hasCol.rows.length > 0 ? 'snapshot_data' : 'snapshot';
    const r = await query(
      `SELECT v.id, v.mbr_id, v.${verCol} as version, v.change_reason, v.${snapCol} as snapshot, v.content_hash, v.created_by, v.created_at, u.full_name as created_by_name
       FROM mbr_versions v LEFT JOIN users u ON v.created_by=u.id
       WHERE v.mbr_id=$1 ORDER BY v.${verCol} DESC`, [req.params.mbrId]);
    const mbr = await query('SELECT current_version, status FROM mbrs WHERE id=$1', [req.params.mbrId]);
    res.json({ data: r.rows, current_version: mbr.rows[0]?.current_version, current_status: mbr.rows[0]?.status });
  } catch (err) { console.error('[MBR] Versions error:', err.message); res.status(500).json({ error: 'Failed to get versions' }); }
});

// ═══ SIGNATURES LIST ═══
router.get('/:mbrId/signatures', authorize('mbr:read'), async (req, res) => {
  try {
    const r = await query(
      `SELECT s.*, u.full_name as signer_name 
       FROM mbr_signatures s LEFT JOIN users u ON s.signer_id=u.id 
       WHERE s.mbr_id=$1 ORDER BY s.signed_at`, [req.params.mbrId]);
    const next = await getNextRequiredSignature(req.params.mbrId);
    res.json({ data: r.rows, next_signature: next });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ AUDIT TRAIL ═══
router.get('/:mbrId/audit', authorize('audit:read'), async (req, res) => {
  try {
    const { limit=100, offset=0 } = req.query;
    const r = await query('SELECT at.*,u.full_name as user_name FROM audit_trail at LEFT JOIN users u ON at.user_id=u.id WHERE at.resource_id=$1 ORDER BY at.created_at DESC LIMIT $2 OFFSET $3', [req.params.mbrId, parseInt(limit), parseInt(offset)]);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ BATCH SAVE (single transaction for entire designer state) ═══
router.post('/:mbrId/batch-save', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { mbr: mbrData, phases, bom } = req.body;
    await transaction(async (cl) => {
      if (mbrData) await cl.query('UPDATE mbrs SET product_name=$1,product_code=$2,dosage_form=$3,batch_size=$4,batch_size_unit=$5,description=$6,updated_at=NOW() WHERE id=$7',
        [mbrData.product_name, mbrData.product_code, mbrData.dosage_form, mbrData.batch_size, mbrData.batch_size_unit, mbrData.description, req.params.mbrId]);
      if (bom) {
        await cl.query('DELETE FROM mbr_bom_items WHERE mbr_id=$1', [req.params.mbrId]);
        for (const it of bom) await cl.query('INSERT INTO mbr_bom_items (mbr_id,material_code,material_name,quantity_per_batch,unit,tolerance_pct,tolerance_type,overage_pct,supplier,grade,is_active_ingredient,dispensing_sequence,phase_used,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',
          [req.params.mbrId,it.material_code,it.material_name,it.quantity_per_batch,it.unit,it.tolerance_pct,it.tolerance_type,it.overage_pct,it.supplier,it.grade,it.is_active_ingredient,it.dispensing_sequence,it.phase_used,it.sort_order]);
      }
    });
    await req.audit({ action:'UPDATE', resourceType:'MBR', resourceId:req.params.mbrId, details:'Batch save from Designer' });
    const r = await query('SELECT * FROM mbrs WHERE id=$1', [req.params.mbrId]);
    res.json(r.rows[0]);
  } catch (err) { console.error('[MBR] Batch save:', err); res.status(500).json({ error: 'Batch save failed' }); }
});


// ═══════════════════════════════════════════════════════════════════════
// EXTENDED FEATURES (was mbrFeaturesRoutes.js)
// ═══════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════
// FEATURE 1: XML EXPORT & IMPORT
// ═══════════════════════════════════════════════════════════════════════

// Export MBR as XML download
router.get('/:mbrId/export/xml', authorize('mbr:read'), async (req, res) => {
  try {
    const xml = await exportMBRToXML(req.params.mbrId);
    const mbr = await query('SELECT mbr_code FROM mbrs WHERE id=$1', [req.params.mbrId]);
    const filename = `${mbr.rows[0]?.mbr_code || 'MBR'}_v${Date.now()}.xml`;

    await req.audit({ action: 'READ', resourceType: 'MBR', resourceId: req.params.mbrId, details: `XML exported: ${filename}` });

    res.set({ 'Content-Type': 'application/xml', 'Content-Disposition': `attachment; filename="${filename}"` });
    res.send(xml);
  } catch (err) { console.error('[XML Export]', err); res.status(500).json({ error: err.message }); }
});

// Import MBR from XML
router.post('/import/xml', authorize('mbr:write'), upload.single('xml'), async (req, res) => {
  try {
    let xmlText;
    if (req.file) {
      xmlText = fs.readFileSync(req.file.path, 'utf8');
    } else if (req.body.xml_content) {
      xmlText = req.body.xml_content;
    } else {
      return res.status(400).json({ error: 'XML file or xml_content required' });
    }

    const mbr = await importMBRFromXML(xmlText, req.session.userId);
    await req.audit({ action: 'CREATE', resourceType: 'MBR', resourceId: mbr.id, details: `MBR imported from XML: ${mbr.mbr_code}` });
    res.status(201).json(mbr);
  } catch (err) { console.error('[XML Import]', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// FEATURE 2: DUPLICATE MBR / PHASE / STEP
// ═══════════════════════════════════════════════════════════════════════

// Duplicate entire MBR
router.post('/:mbrId/duplicate', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const src = await query('SELECT * FROM mbrs WHERE id=$1', [req.params.mbrId]);
    if (src.rows.length === 0) return res.status(404).json({ error: 'MBR not found' });
    const s = src.rows[0];

    const newCode = s.mbr_code + '-COPY-' + Date.now().toString(36).toUpperCase().slice(-4);
    const newMbr = await query(
      `INSERT INTO mbrs (mbr_code,product_name,product_code,dosage_form,batch_size,batch_size_unit,description,strength,market,batch_type,target_yield,sap_recipe_id,sap_material_number,created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
      [newCode, s.product_name + ' (Copy)', s.product_code, s.dosage_form, s.batch_size, s.batch_size_unit, s.description, s.strength, s.market, s.batch_type, s.target_yield, s.sap_recipe_id, s.sap_material_number, req.session.userId]
    );
    const newId = newMbr.rows[0].id;

    // Deep copy phases → steps → children
    await deepCopyMBR(req.params.mbrId, newId);

    await req.audit({ action: 'CREATE', resourceType: 'MBR', resourceId: newId, details: `Duplicated from ${s.mbr_code}` });
    res.status(201).json(newMbr.rows[0]);
  } catch (err) { console.error('[Duplicate MBR]', err); res.status(500).json({ error: err.message }); }
});

// Duplicate a single phase within same MBR
router.post('/:mbrId/phases/:phaseId/duplicate', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const ph = await query('SELECT * FROM mbr_phases WHERE id=$1', [req.params.phaseId]);
    if (ph.rows.length === 0) return res.status(404).json({ error: 'Phase not found' });
    const p = ph.rows[0];
    const cnt = await query('SELECT COALESCE(MAX(phase_number),0)+1 as n FROM mbr_phases WHERE mbr_id=$1', [req.params.mbrId]);

    const newPh = await query(
      'INSERT INTO mbr_phases (mbr_id,phase_number,phase_name,description,sort_order) VALUES ($1,$2,$3,$4,$2) RETURNING *',
      [req.params.mbrId, cnt.rows[0].n, p.phase_name + ' (Copy)', p.description]
    );

    // Copy steps and children
    await copyPhaseChildren(req.params.phaseId, newPh.rows[0].id, req.params.mbrId);

    await req.audit({ action: 'CREATE', resourceType: 'PHASE', resourceId: newPh.rows[0].id, details: `Duplicated from ${p.phase_name}` });
    res.status(201).json(newPh.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Duplicate a single step within same phase
router.post('/:mbrId/steps/:stepId/duplicate', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const st = await query('SELECT * FROM mbr_steps WHERE id=$1', [req.params.stepId]);
    if (st.rows.length === 0) return res.status(404).json({ error: 'Step not found' });
    const s = st.rows[0];
    const cnt = await query('SELECT COALESCE(MAX(step_number),0)+1 as n FROM mbr_steps WHERE phase_id=$1', [s.phase_id]);

    const newSt = await query(
      `INSERT INTO mbr_steps (phase_id,mbr_id,step_number,step_name,viscosity,step_type,duration_min,is_critical,is_gmp_critical,sort_order,weighing_config,sampling_plan,yield_config,hold_config,env_config,l2_config)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [s.phase_id, req.params.mbrId, cnt.rows[0].n, s.step_name + ' (Copy)', s.instruction, s.step_type, s.duration_min, s.is_critical, s.is_gmp_critical, cnt.rows[0].n, s.weighing_config, s.sampling_plan, s.yield_config, s.hold_config, s.env_config, s.l2_config]
    );

    // Copy params, materials, equipment, IPC
    await copyStepChildren(req.params.stepId, newSt.rows[0].id, req.params.mbrId);

    res.status(201).json(newSt.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// FEATURE 3: MULTI-DOCUMENT UPLOAD & ANALYSIS
// ═══════════════════════════════════════════════════════════════════════

router.post('/:mbrId/attachments', authorize('mbr:write'), editLock, upload.array('files', 20), async (req, res) => {
  try {
    const results = [];
    for (const file of (req.files || [])) {
      const ext = path.extname(file.originalname).toLowerCase().replace('.', '');
      const buf = fs.readFileSync(file.path);
      const hash = crypto.createHash('sha256').update(buf).digest('hex');

      // Extract text from text-based files
      let contentText = null;
      if (['txt', 'csv', 'xml'].includes(ext)) {
        contentText = buf.toString('utf8');
      }

      const r = await query(
        `INSERT INTO mbr_attachments (mbr_id,filename,file_type,file_size,file_hash,file_path,content_text,uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [req.params.mbrId, file.originalname, ext, file.size, hash, file.path, contentText, req.session.userId]
      );
      results.push(r.rows[0]);
    }

    await req.audit({ action: 'CREATE', resourceType: 'ATTACHMENT', resourceId: req.params.mbrId, details: `${results.length} files uploaded` });
    res.status(201).json({ data: results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/:mbrId/attachments', authorize('mbr:read'), async (req, res) => {
  try {
    const r = await query('SELECT id,mbr_id,filename,file_type,file_size,file_hash,uploaded_by,created_at FROM mbr_attachments WHERE mbr_id=$1 ORDER BY created_at DESC', [req.params.mbrId]);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.delete('/:mbrId/attachments/:attId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const r = await query('DELETE FROM mbr_attachments WHERE id=$1 RETURNING *', [req.params.attId]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    // Remove file from disk
    if (r.rows[0].file_path && fs.existsSync(r.rows[0].file_path)) fs.unlinkSync(r.rows[0].file_path);
    res.json({ deleted: true });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══════════════════════════════════════════════════════════════════════
// FEATURE 8: SUPERSEDE PHASE
// ═══════════════════════════════════════════════════════════════════════

router.post('/:mbrId/phases/:phaseId/supersede', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json({ error: 'Supersede reason required' });

    const old = await query('SELECT * FROM mbr_phases WHERE id=$1', [req.params.phaseId]);
    if (old.rows.length === 0) return res.status(404).json({ error: 'Phase not found' });

    // Create new version of the phase
    const newVer = (old.rows[0].phase_version || 1) + 1;
    const newPh = await query(
      `INSERT INTO mbr_phases (mbr_id,phase_number,phase_name,description,sort_order,phase_version,phase_status)
       VALUES ($1,$2,$3,$4,$5,$6,'Active') RETURNING *`,
      [req.params.mbrId, old.rows[0].phase_number, old.rows[0].phase_name, req.body.description || old.rows[0].description, old.rows[0].sort_order, newVer]
    );

    // Copy children to new phase
    await copyPhaseChildren(req.params.phaseId, newPh.rows[0].id, req.params.mbrId);

    // Mark old as superseded
    await query(
      `UPDATE mbr_phases SET phase_status='Superseded', superseded_by=$1, superseded_at=NOW(), supersede_reason=$2 WHERE id=$3`,
      [newPh.rows[0].id, reason, req.params.phaseId]
    );

    await req.audit({ action: 'UPDATE', resourceType: 'PHASE', resourceId: req.params.phaseId, details: `Superseded: ${reason}. New version: ${newVer}` });
    res.json({ old_phase: req.params.phaseId, new_phase: newPh.rows[0], reason });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// FEATURE 10: FORMULA CRUD + TRIAL
// ═══════════════════════════════════════════════════════════════════════

router.get('/:mbrId/formulas', authorize('mbr:read'), async (req, res) => {
  try {
    const r = await query('SELECT * FROM mbr_formulas WHERE mbr_id=$1 ORDER BY created_at', [req.params.mbrId]);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

router.post('/:mbrId/formulas', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { formula_name, formula_type, expression, variables, result_unit, description, step_id } = req.body;
    if (!formula_name || !expression) return res.status(400).json({ error: 'formula_name and expression required' });

    const r = await query(
      `INSERT INTO mbr_formulas (mbr_id,step_id,formula_name,formula_type,expression,variables,result_unit,description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [req.params.mbrId, step_id, formula_name, formula_type || 'simple', expression, JSON.stringify(variables || {}), result_unit, description]
    );
    res.status(201).json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:mbrId/formulas/:formulaId', authorize('mbr:write'), editLock, async (req, res) => {
  try {
    const { formula_name, formula_type, expression, variables, result_unit, description } = req.body;
    const r = await query(
      `UPDATE mbr_formulas SET formula_name=COALESCE($1,formula_name),formula_type=COALESCE($2,formula_type),expression=COALESCE($3,expression),variables=COALESCE($4,variables),result_unit=COALESCE($5,result_unit),description=COALESCE($6,description),updated_at=NOW() WHERE id=$7 RETURNING *`,
      [formula_name, formula_type, expression, variables ? JSON.stringify(variables) : null, result_unit, description, req.params.formulaId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Trial: evaluate formula with test variables
router.post('/:mbrId/formulas/:formulaId/trial', authorize('mbr:read'), async (req, res) => {
  try {
    const result = await runTrial(req.params.formulaId, req.body.variables || {});
    await req.audit({ action: 'UPDATE', resourceType: 'FORMULA', resourceId: req.params.formulaId, details: `Formula trial: ${result.valid ? 'PASS' : 'FAIL'} = ${result.result}` });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Quick evaluate (no save)
router.post('/:mbrId/formulas/evaluate', authorize('mbr:read'), async (req, res) => {
  try {
    const { expression, variables } = req.body;
    if (!expression) return res.status(400).json({ error: 'expression required' });
    const result = evaluateFormula(expression, variables || {});
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════════════
// HELPERS: Deep copy functions
// ═══════════════════════════════════════════════════════════════════════

async function deepCopyMBR(srcMbrId, destMbrId) {
  // Copy BOM
  const bom = await query('SELECT * FROM mbr_bom_items WHERE mbr_id=$1', [srcMbrId]);
  for (const b of bom.rows) {
    await query('INSERT INTO mbr_bom_items (mbr_id,material_number,material_code,material_name,quantity_per_batch,unit,tolerance_pct,tolerance_type,overage_pct,supplier,grade,is_active_ingredient,shelf_life_months,storage_conditions,retest_interval_months,dispensing_sequence,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)',
      [destMbrId, b.material_number, b.material_code, b.material_name, b.quantity_per_batch, b.unit, b.tolerance_pct, b.tolerance_type, b.overage_pct, b.supplier, b.grade, b.is_active_ingredient, b.shelf_life_months, b.storage_conditions, b.retest_interval_months, b.dispensing_sequence, b.sort_order]);
  }
  // Copy phases
  const phases = await query('SELECT * FROM mbr_phases WHERE mbr_id=$1 ORDER BY sort_order', [srcMbrId]);
  for (const p of phases.rows) {
    const np = await query('INSERT INTO mbr_phases (mbr_id,phase_number,phase_name,description,sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id', [destMbrId, p.phase_number, p.phase_name, p.description, p.sort_order]);
    await copyPhaseChildren(p.id, np.rows[0].id, destMbrId);
  }
  // Copy formulas
  const formulas = await query('SELECT * FROM mbr_formulas WHERE mbr_id=$1', [srcMbrId]);
  for (const f of formulas.rows) {
    await query('INSERT INTO mbr_formulas (mbr_id,formula_name,formula_type,expression,variables,result_unit,description) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [destMbrId, f.formula_name, f.formula_type, f.expression, JSON.stringify(f.variables), f.result_unit, f.description]);
  }
}

async function copyPhaseChildren(srcPhaseId, destPhaseId, mbrId) {
  const steps = await query('SELECT * FROM mbr_steps WHERE phase_id=$1 ORDER BY sort_order', [srcPhaseId]);
  for (const s of steps.rows) {
    const ns = await query(
      'INSERT INTO mbr_steps (phase_id,mbr_id,step_number,step_name,instruction,step_type,duration_min,is_critical,is_gmp_critical,sort_order,weighing_config,sampling_plan,yield_config,hold_config,env_config,l2_config) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id',
      [destPhaseId, mbrId, s.step_number, s.step_name, s.instruction, s.step_type, s.duration_min, s.is_critical, s.is_gmp_critical, s.sort_order, JSON.stringify(s.weighing_config), JSON.stringify(s.sampling_plan), JSON.stringify(s.yield_config), JSON.stringify(s.hold_config), JSON.stringify(s.env_config), JSON.stringify(s.l2_config)]
    );
    await copyStepChildren(s.id, ns.rows[0].id, mbrId);
  }
}

async function copyStepChildren(srcStepId, destStepId, mbrId) {
  const params = await query('SELECT * FROM mbr_step_parameters WHERE step_id=$1', [srcStepId]);
  for (const p of params.rows) await query('INSERT INTO mbr_step_parameters (step_id,mbr_id,param_name,param_type,target_value,unit,lower_limit,upper_limit,is_cpp,is_cqa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [destStepId, mbrId, p.param_name, p.param_type, p.target_value, p.unit, p.lower_limit, p.upper_limit, p.is_cpp, p.is_cqa]);

  const mats = await query('SELECT * FROM mbr_step_materials WHERE step_id=$1', [srcStepId]);
  for (const m of mats.rows) await query('INSERT INTO mbr_step_materials (step_id,mbr_id,material_code,material_name,material_type,quantity,unit,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [destStepId, mbrId, m.material_code, m.material_name, m.material_type, m.quantity, m.unit, m.is_active]);

  const eqs = await query('SELECT * FROM mbr_step_equipment WHERE step_id=$1', [srcStepId]);
  for (const e of eqs.rows) await query('INSERT INTO mbr_step_equipment (step_id,mbr_id,equipment_code,equipment_name,equipment_type,capacity,is_primary) VALUES ($1,$2,$3,$4,$5,$6,$7)', [destStepId, mbrId, e.equipment_code, e.equipment_name, e.equipment_type, e.capacity, e.is_primary]);

  const ipcs = await query('SELECT * FROM mbr_ipc_checks WHERE step_id=$1', [srcStepId]);
  for (const c of ipcs.rows) await query('INSERT INTO mbr_ipc_checks (step_id,mbr_id,check_name,check_type,specification,frequency) VALUES ($1,$2,$3,$4,$5,$6)', [destStepId, mbrId, c.check_name, c.check_type, c.specification, c.frequency]);
}



module.exports = router;
