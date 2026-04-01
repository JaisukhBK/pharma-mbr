// server/services/xmlService.js — MBR XML Export/Import (ISA-88 compliant)

const { query } = require('../db/pool');

// ═══ EXPORT: MBR → XML ═══
async function exportMBRToXML(mbrId) {
  // Fetch full MBR
  const mbrR = await query('SELECT * FROM mbrs WHERE id=$1', [mbrId]);
  if (mbrR.rows.length === 0) throw new Error('MBR not found');
  const mbr = mbrR.rows[0];

  const phasesR = await query('SELECT * FROM mbr_phases WHERE mbr_id=$1 ORDER BY sort_order', [mbrId]);
  const stepsR = await query('SELECT * FROM mbr_steps WHERE mbr_id=$1 ORDER BY sort_order', [mbrId]);
  const [paramsR, matsR, eqR, ipcR, bomR, sigR, formulasR] = await Promise.all([
    query('SELECT * FROM mbr_step_parameters WHERE mbr_id=$1', [mbrId]),
    query('SELECT * FROM mbr_step_materials WHERE mbr_id=$1', [mbrId]),
    query('SELECT * FROM mbr_step_equipment WHERE mbr_id=$1', [mbrId]),
    query('SELECT * FROM mbr_ipc_checks WHERE mbr_id=$1', [mbrId]),
    query('SELECT * FROM mbr_bom_items WHERE mbr_id=$1 ORDER BY sort_order', [mbrId]),
    query('SELECT * FROM mbr_signatures WHERE mbr_id=$1 ORDER BY signed_at', [mbrId]),
    query('SELECT * FROM mbr_formulas WHERE mbr_id=$1', [mbrId]),
  ]);

  let xml = `<?xml version="1.0" encoding="UTF-8"?>\n`;
  xml += `<MasterBatchRecord xmlns="urn:pharma-mbr:isa88:v1" version="1.0">\n`;
  xml += `  <Header>\n`;
  xml += `    <MBRCode>${esc(mbr.mbr_code)}</MBRCode>\n`;
  xml += `    <SlNo>${mbr.sl_no || ''}</SlNo>\n`;
  xml += `    <ProductName>${esc(mbr.product_name)}</ProductName>\n`;
  xml += `    <ProductCode>${esc(mbr.product_code || '')}</ProductCode>\n`;
  xml += `    <Strength>${esc(mbr.strength || '')}</Strength>\n`;
  xml += `    <DosageForm>${esc(mbr.dosage_form || '')}</DosageForm>\n`;
  xml += `    <BatchSize unit="${esc(mbr.batch_size_unit || 'kg')}">${mbr.batch_size || ''}</BatchSize>\n`;
  xml += `    <BatchType>${esc(mbr.batch_type || 'Production')}</BatchType>\n`;
  xml += `    <Market>${esc(mbr.market || '')}</Market>\n`;
  xml += `    <Version>${mbr.current_version}</Version>\n`;
  xml += `    <Status>${mbr.status}</Status>\n`;
  xml += `    <TargetYield>${mbr.target_yield || ''}</TargetYield>\n`;
  xml += `    <Description>${esc(mbr.description || '')}</Description>\n`;
  xml += `    <SAPRecipeId>${esc(mbr.sap_recipe_id || '')}</SAPRecipeId>\n`;
  xml += `    <SAPMaterialNumber>${esc(mbr.sap_material_number || '')}</SAPMaterialNumber>\n`;
  xml += `  </Header>\n`;

  // BOM
  xml += `  <BillOfMaterials count="${bomR.rows.length}">\n`;
  for (const b of bomR.rows) {
    xml += `    <Material>\n`;
    xml += `      <MaterialNumber>${esc(b.material_number || '')}</MaterialNumber>\n`;
    xml += `      <MaterialCode>${esc(b.material_code || '')}</MaterialCode>\n`;
    xml += `      <Name>${esc(b.material_name)}</Name>\n`;
    xml += `      <Quantity unit="${esc(b.unit || 'kg')}">${b.quantity_per_batch || ''}</Quantity>\n`;
    xml += `      <Tolerance type="${esc(b.tolerance_type || '±')}">${b.tolerance_pct || ''}</Tolerance>\n`;
    xml += `      <Supplier>${esc(b.supplier || '')}</Supplier>\n`;
    xml += `      <Grade>${esc(b.grade || '')}</Grade>\n`;
    xml += `      <IsActiveIngredient>${b.is_active_ingredient || false}</IsActiveIngredient>\n`;
    xml += `      <ShelfLifeMonths>${b.shelf_life_months || ''}</ShelfLifeMonths>\n`;
    xml += `      <StorageConditions>${esc(b.storage_conditions || '')}</StorageConditions>\n`;
    xml += `      <RetestIntervalMonths>${b.retest_interval_months || ''}</RetestIntervalMonths>\n`;
    xml += `    </Material>\n`;
  }
  xml += `  </BillOfMaterials>\n`;

  // Phases (ISA-88 Unit Procedures)
  xml += `  <Procedure>\n`;
  for (const phase of phasesR.rows) {
    xml += `    <UnitProcedure sequence="${phase.phase_number}" version="${phase.phase_version || 1}" status="${phase.phase_status || 'Active'}">\n`;
    xml += `      <Name>${esc(phase.phase_name)}</Name>\n`;
    xml += `      <Description>${esc(phase.description || '')}</Description>\n`;

    const phaseSteps = stepsR.rows.filter(s => s.phase_id === phase.id);
    for (const step of phaseSteps) {
      xml += `      <Operation sequence="${step.step_number}" type="${step.step_type}" critical="${step.is_critical}" gmpCritical="${step.is_gmp_critical}">\n`;
      xml += `        <Name>${esc(step.step_name)}</Name>\n`;
      xml += `        <Instruction>${esc(step.instruction || '')}</Instruction>\n`;
      xml += `        <Duration unit="min">${step.duration_min || ''}</Duration>\n`;

      // Parameters
      const stepParams = paramsR.rows.filter(p => p.step_id === step.id);
      if (stepParams.length > 0) {
        xml += `        <Parameters>\n`;
        for (const p of stepParams) {
          xml += `          <Parameter cpp="${p.is_cpp}" cqa="${p.is_cqa}">\n`;
          xml += `            <Name>${esc(p.param_name)}</Name>\n`;
          xml += `            <Target unit="${esc(p.unit || '')}">${esc(p.target_value || '')}</Target>\n`;
          xml += `            <LowerLimit>${p.lower_limit || ''}</LowerLimit>\n`;
          xml += `            <UpperLimit>${p.upper_limit || ''}</UpperLimit>\n`;
          xml += `          </Parameter>\n`;
        }
        xml += `        </Parameters>\n`;
      }

      // Materials
      const stepMats = matsR.rows.filter(m => m.step_id === step.id);
      if (stepMats.length > 0) {
        xml += `        <Materials>\n`;
        for (const m of stepMats) {
          xml += `          <Material type="${m.material_type}" active="${m.is_active}">\n`;
          xml += `            <Code>${esc(m.material_code || '')}</Code>\n`;
          xml += `            <Name>${esc(m.material_name)}</Name>\n`;
          xml += `            <Quantity unit="${esc(m.unit || 'kg')}">${m.quantity || ''}</Quantity>\n`;
          xml += `          </Material>\n`;
        }
        xml += `        </Materials>\n`;
      }

      // Equipment
      const stepEq = eqR.rows.filter(e => e.step_id === step.id);
      if (stepEq.length > 0) {
        xml += `        <Equipment>\n`;
        for (const e of stepEq) {
          xml += `          <Item type="${e.equipment_type}" primary="${e.is_primary}">\n`;
          xml += `            <Code>${esc(e.equipment_code || '')}</Code>\n`;
          xml += `            <Name>${esc(e.equipment_name)}</Name>\n`;
          xml += `            <Capacity>${esc(e.capacity || '')}</Capacity>\n`;
          xml += `          </Item>\n`;
        }
        xml += `        </Equipment>\n`;
      }

      // IPC Checks
      const stepIPC = ipcR.rows.filter(c => c.step_id === step.id);
      if (stepIPC.length > 0) {
        xml += `        <IPCChecks>\n`;
        for (const c of stepIPC) {
          xml += `          <Check type="${esc(c.check_type)}">\n`;
          xml += `            <Name>${esc(c.check_name)}</Name>\n`;
          xml += `            <Specification>${esc(c.specification || '')}</Specification>\n`;
          xml += `            <Frequency>${esc(c.frequency || '')}</Frequency>\n`;
          xml += `          </Check>\n`;
        }
        xml += `        </IPCChecks>\n`;
      }

      xml += `      </Operation>\n`;
    }
    xml += `    </UnitProcedure>\n`;
  }
  xml += `  </Procedure>\n`;

  // Formulas
  if (formulasR.rows.length > 0) {
    xml += `  <Formulas>\n`;
    for (const f of formulasR.rows) {
      xml += `    <Formula type="${f.formula_type}" resultUnit="${esc(f.result_unit || '')}">\n`;
      xml += `      <Name>${esc(f.formula_name)}</Name>\n`;
      xml += `      <Expression><![CDATA[${f.expression}]]></Expression>\n`;
      xml += `      <Variables>${JSON.stringify(f.variables || {})}</Variables>\n`;
      xml += `    </Formula>\n`;
    }
    xml += `  </Formulas>\n`;
  }

  // Signatures
  if (sigR.rows.length > 0) {
    xml += `  <Signatures>\n`;
    for (const s of sigR.rows) {
      xml += `    <Signature role="${s.signature_role}" verified="${s.password_verified}">\n`;
      xml += `      <SignerEmail>${esc(s.signer_email)}</SignerEmail>\n`;
      xml += `      <Meaning>${esc(s.signature_meaning)}</Meaning>\n`;
      xml += `      <ContentHash>${s.content_hash}</ContentHash>\n`;
      xml += `      <SignedAt>${s.signed_at}</SignedAt>\n`;
      xml += `    </Signature>\n`;
    }
    xml += `  </Signatures>\n`;
  }

  xml += `</MasterBatchRecord>\n`;
  return xml;
}

// ═══ IMPORT: XML → MBR ═══
async function importMBRFromXML(xmlText, userId) {
  // Simple XML parser (no external dependency)
  const get = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 's')); return m ? m[1].trim() : ''; };
  const getAttr = (xml, tag, attr) => { const m = xml.match(new RegExp(`<${tag}[^>]*${attr}="([^"]*)"`, 's')); return m ? m[1] : ''; };
  const getAll = (xml, tag) => { const re = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, 'g'); return [...xml.matchAll(re)].map(m => m[0]); };

  // Parse header
  const productName = get(xmlText, 'ProductName');
  if (!productName) throw new Error('Invalid MBR XML: missing ProductName');

  const mbrCode = 'MBR-IMP-' + Date.now().toString(36).toUpperCase();
  const mbrR = await query(
    `INSERT INTO mbrs (mbr_code,product_name,product_code,dosage_form,batch_size,batch_size_unit,strength,market,batch_type,description,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [mbrCode, productName, get(xmlText, 'ProductCode'), get(xmlText, 'DosageForm') || 'Tablet',
     parseFloat(get(xmlText, 'BatchSize')) || null, getAttr(xmlText, 'BatchSize', 'unit') || 'kg',
     get(xmlText, 'Strength'), get(xmlText, 'Market'), get(xmlText, 'BatchType') || 'Production',
     get(xmlText, 'Description'), userId]
  );
  const mbrId = mbrR.rows[0].id;

  // Parse BOM
  const bomItems = getAll(xmlText, 'Material').filter(m => m.includes('<Name>'));
  for (const bomXml of bomItems) {
    if (bomXml.includes('<UnitProcedure') || bomXml.includes('<Operation')) continue; // skip step-level materials
    await query(
      `INSERT INTO mbr_bom_items (mbr_id,material_number,material_code,material_name,quantity_per_batch,unit,tolerance_pct,supplier,grade,is_active_ingredient,shelf_life_months,storage_conditions,sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0)`,
      [mbrId, get(bomXml, 'MaterialNumber'), get(bomXml, 'MaterialCode'), get(bomXml, 'Name'),
       parseFloat(get(bomXml, 'Quantity')) || null, getAttr(bomXml, 'Quantity', 'unit') || 'kg',
       parseFloat(get(bomXml, 'Tolerance')) || null, get(bomXml, 'Supplier'), get(bomXml, 'Grade'),
       get(bomXml, 'IsActiveIngredient') === 'true',
       parseInt(get(bomXml, 'ShelfLifeMonths')) || null, get(bomXml, 'StorageConditions')]
    );
  }

  // Parse Unit Procedures (Phases)
  const unitProcs = getAll(xmlText, 'UnitProcedure');
  for (let pi = 0; pi < unitProcs.length; pi++) {
    const upXml = unitProcs[pi];
    const seq = parseInt(getAttr(upXml, 'UnitProcedure', 'sequence')) || (pi + 1);
    const phR = await query(
      'INSERT INTO mbr_phases (mbr_id,phase_number,phase_name,description,sort_order) VALUES ($1,$2,$3,$4,$2) RETURNING id',
      [mbrId, seq, get(upXml, 'Name'), get(upXml, 'Description')]
    );
    const phaseId = phR.rows[0].id;

    // Parse Operations (Steps)
    const ops = getAll(upXml, 'Operation');
    for (let si = 0; si < ops.length; si++) {
      const opXml = ops[si];
      const stR = await query(
        'INSERT INTO mbr_steps (phase_id,mbr_id,step_number,step_name,instruction,step_type,duration_min,is_critical,is_gmp_critical,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$3) RETURNING id',
        [phaseId, mbrId, si + 1, get(opXml, 'Name'), get(opXml, 'Instruction'),
         getAttr(opXml, 'Operation', 'type') || 'Processing',
         parseInt(get(opXml, 'Duration')) || null,
         getAttr(opXml, 'Operation', 'critical') === 'true',
         getAttr(opXml, 'Operation', 'gmpCritical') === 'true']
      );
      const stepId = stR.rows[0].id;

      // Parameters
      const paramXmls = getAll(opXml, 'Parameter');
      for (const px of paramXmls) {
        await query(
          'INSERT INTO mbr_step_parameters (step_id,mbr_id,param_name,target_value,unit,lower_limit,upper_limit,is_cpp,is_cqa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [stepId, mbrId, get(px, 'Name'), get(px, 'Target'), getAttr(px, 'Target', 'unit'),
           parseFloat(get(px, 'LowerLimit')) || null, parseFloat(get(px, 'UpperLimit')) || null,
           getAttr(px, 'Parameter', 'cpp') === 'true', getAttr(px, 'Parameter', 'cqa') === 'true']
        );
      }
    }
  }

  return mbrR.rows[0];
}

function esc(str) { return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

module.exports = { exportMBRToXML, importMBRFromXML };
