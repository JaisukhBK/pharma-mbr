// server/services/coDesignerAgent.js — Agentic AI for MBR S88 Decomposition
// Merged from: coDesignerAgent.js + pdfParser.js
// Supports: Anthropic Claude API, xAI Grok API, Groq (configurable via env)
// GAMP5 Category 5 — every action logged, human-in-the-loop enforced

const fs = require('fs');
const path = require('path');
const { query } = require('../db/pool');
const { logAudit } = require('../middleware/middleware');  // ← CHANGED from ../middleware/auditTrail

// ════════════════════════════════════════════════════════════════════════
// PDF PARSER (was pdfParser.js) — Extract structured text from legacy MBR PDFs
// ════════════════════════════════════════════════════════════════════════

async function parsePDF(filePath) {
  // pdf-parse has known export quirks across versions — handle all cases
  let pdfParse;
  try {
    pdfParse = require('pdf-parse');
    // Some versions export an object with .default
    if (typeof pdfParse !== 'function') {
      pdfParse = pdfParse.default || pdfParse.pdfParse || pdfParse;
    }
    // Last resort: use the internal lib directly
    if (typeof pdfParse !== 'function') {
      pdfParse = require('pdf-parse/lib/pdf-parse');
    }
  } catch (requireErr) {
    throw new Error('pdf-parse package not installed. Run: npm install pdf-parse');
  }

  if (typeof pdfParse !== 'function') {
    throw new Error('pdf-parse loaded but is not a function (type: ' + typeof pdfParse + '). Try: npm uninstall pdf-parse && npm install pdf-parse@1.1.1');
  }

  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  return {
    text: data.text,
    pageCount: data.numpages,
    info: data.info || {},
    metadata: data.metadata || {},
    pages: data.text.split(/\f|\n{4,}/).filter(p => p.trim().length > 0),
  };
}

/**
 * Pre-process extracted text to clean up OCR artifacts and formatting
 * @param {string} rawText
 * @returns {string} cleaned text
 */
function cleanText(rawText) {
  return rawText
    // Normalize whitespace
    .replace(/[ \t]+/g, ' ')
    // Remove excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Fix common OCR issues
    .replace(/['']/g, "'")
    .replace(/[""]/g, '"')
    // Normalize degree symbols
    .replace(/°\s*C/g, '°C')
    .replace(/°\s*F/g, '°F')
    // Normalize units
    .replace(/(\d)\s+(mg|kg|g|mL|L|RPM|kN|mm|min|hr|psi|bar)/g, '$1 $2')
    .trim();
}

/**
 * Extract sections from MBR text based on common pharma MBR headers
 * @param {string} text - Cleaned MBR text
 * @returns {Object[]} Array of { heading, content } sections
 */
function extractSections(text) {
  // Common MBR section patterns
  const sectionPatterns = [
    /(?:^|\n)((?:\d+\.?\s*)?(?:DISPENSING|WEIGHING|MATERIAL\s*DISPENSING))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:GRANULATION|WET\s*GRANULATION|DRY\s*GRANULATION|HIGH.SHEAR))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:BLENDING|MIXING|LUBRICATION|V.BLENDER|BIN\s*BLENDING))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:COMPRESSION|TABLETING|TABLET\s*PRESS))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:COATING|FILM\s*COATING|SUGAR\s*COATING|AQUEOUS\s*COATING))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:PACKAGING|PACKING|PRIMARY\s*PACK|SECONDARY\s*PACK|BLISTER))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:DRYING|FLUID\s*BED|FBD|TRAY\s*DRY))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:MILLING|SIZING|SIEVING|SCREENING|COMMINUTING))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:IN.PROCESS|IPC|QUALITY\s*CHECK|SAMPLING))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:BILL\s*OF\s*MATERIALS|BOM|RAW\s*MATERIALS|MATERIAL\s*LIST))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:EQUIPMENT\s*LIST|EQUIPMENT\s*REQUIRED))/gi,
    /(?:^|\n)((?:\d+\.?\s*)?(?:STEP\s*\d+|OPERATION\s*\d+|PROCEDURE\s*\d+|STAGE\s*\d+))/gi,
  ];

  const sections = [];
  const lines = text.split('\n');
  let currentSection = { heading: 'Header / General', content: '' };

  for (const line of lines) {
    let isHeading = false;
    for (const pattern of sectionPatterns) {
      pattern.lastIndex = 0; // Reset regex state
      if (pattern.test(line.trim())) {
        if (currentSection.content.trim()) sections.push({ ...currentSection });
        currentSection = { heading: line.trim(), content: '' };
        isHeading = true;
        break;
      }
    }
    if (!isHeading) {
      currentSection.content += line + '\n';
    }
  }
  if (currentSection.content.trim()) sections.push(currentSection);

  return sections;
}


// ════════════════════════════════════════════════════════════════════════
// LLM PROVIDER — calls Claude or Grok based on env config
// ════════════════════════════════════════════════════════════════════════

async function callLLM(systemPrompt, userMessage) {
  const provider = process.env.CO_DESIGNER_PROVIDER || 'anthropic'; // 'anthropic', 'xai', or 'groq'

  if (provider === 'groq') {
    return callGroq(systemPrompt, userMessage);
  }
  if (provider === 'xai') {
    return callXAI(systemPrompt, userMessage);
  }
  return callAnthropic(systemPrompt, userMessage);
}

async function callAnthropic(systemPrompt, userMessage) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in .env');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.CO_DESIGNER_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 8000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Anthropic API error ${res.status}: ${err.error?.message || 'Unknown'}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function callXAI(systemPrompt, userMessage) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set in .env');

  const model = process.env.CO_DESIGNER_MODEL || 'grok-3-latest';
  console.log(`[CO-DESIGNER] Calling xAI model: ${model}`);

  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[CO-DESIGNER] xAI full error response:`, errText);
    let errMsg = 'Unknown';
    try { errMsg = JSON.parse(errText).error?.message || JSON.parse(errText).error || errText.substring(0, 200); } catch { errMsg = errText.substring(0, 200); }
    throw new Error(`xAI API error ${res.status}: ${errMsg}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callGroq(systemPrompt, userMessage) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set in .env');

  const model = process.env.CO_DESIGNER_MODEL || 'llama-3.3-70b-versatile';
  console.log(`[CO-DESIGNER] Calling Groq model: ${model}`);

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.2,
      max_tokens: 8000,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`[CO-DESIGNER] Groq full error response:`, errText);
    let errMsg = 'Unknown';
    try { errMsg = JSON.parse(errText).error?.message || errText.substring(0, 200); } catch { errMsg = errText.substring(0, 200); }
    throw new Error(`Groq API error ${res.status}: ${errMsg}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ════════════════════════════════════════════════════════════════════════
// ISA-88 DECOMPOSITION PROMPT — the brain of the Co-Designer
// ════════════════════════════════════════════════════════════════════════

const S88_SYSTEM_PROMPT = `You are an expert pharmaceutical manufacturing engineer specializing in ISA-88 (S88) batch control standards and 21 CFR Part 211 compliance.

Your task: Given raw text extracted from a legacy Master Batch Record (MBR) PDF, decompose it into a structured ISA-88 procedural hierarchy.

ISA-88 Hierarchy:
- Procedure (the MBR itself)
  - Unit Procedure (a major phase: Dispensing, Granulation, Blending, Compression, Coating, Packaging, etc.)
    - Operation (a specific step within the phase)
      - Parameters (CPP/CQA process parameters with targets and limits)
      - Materials (raw materials used in this step)
      - Equipment (equipment required)
      - IPC Checks (in-process control tests)

Rules:
1. Extract EVERY process step, parameter, material, and IPC check mentioned in the text
2. Flag Critical Process Parameters (CPP) and Critical Quality Attributes (CQA)
3. Include target values, upper/lower limits, and units for all parameters
4. Identify equipment by type and capacity where mentioned
5. Extract IPC check specifications and frequencies
6. If the text mentions a Bill of Materials (BOM), extract all materials with quantities and grades
7. Preserve the original sequence/order from the document

You MUST respond with ONLY valid JSON — no markdown, no backticks, no explanation. Use this exact structure:

{
  "product_name": "string",
  "product_code": "string or null",
  "dosage_form": "Tablet|Capsule|Injectable|Oral Liquid|Topical|Powder|Lyophilized",
  "batch_size": "number or null",
  "batch_size_unit": "string",
  "description": "Brief MBR description",
  "phases": [
    {
      "phase_name": "string (e.g. Dispensing, Granulation)",
      "description": "string",
      "sequence": 1,
      "steps": [
        {
          "step_name": "string",
          "instruction": "Detailed work instruction from the MBR text",
          "step_type": "Processing|Verification|Sampling|Weighing|IPC|Cleaning|Hold|Transfer",
          "duration_min": "number or null",
          "is_critical": true/false,
          "is_gmp_critical": true/false,
          "parameters": [
            {
              "param_name": "string",
              "target_value": "string",
              "unit": "string",
              "lower_limit": "number or null",
              "upper_limit": "number or null",
              "is_cpp": true/false,
              "is_cqa": true/false
            }
          ],
          "materials": [
            {
              "material_code": "string or null",
              "material_name": "string",
              "material_type": "API|Excipient|Raw Material|Packaging|Solvent",
              "quantity": "number or null",
              "unit": "string",
              "is_active": true/false
            }
          ],
          "equipment": [
            {
              "equipment_name": "string",
              "equipment_type": "Reactor|Granulator|Tablet Press|Coater|Blender|FBD|Mill|Autoclave|Homogenizer",
              "capacity": "string or null"
            }
          ],
          "ipc_checks": [
            {
              "check_name": "string",
              "check_type": "string",
              "specification": "string",
              "frequency": "string"
            }
          ]
        }
      ]
    }
  ],
  "bom": [
    {
      "material_code": "string or null",
      "material_name": "string",
      "quantity_per_batch": "number",
      "unit": "string",
      "tolerance_pct": "number or null",
      "supplier": "string or null",
      "grade": "string or null",
      "is_active_ingredient": true/false
    }
  ]
}`;

// ════════════════════════════════════════════════════════════════════════
// PIPELINE — the full agent workflow
// ════════════════════════════════════════════════════════════════════════

/**
 * Run the Co-Designer pipeline:
 * 1. Extract text from PDF (already done by caller)
 * 2. Send to LLM for ISA-88 decomposition
 * 3. Parse the structured response
 * 4. Create proposals in the database for human review
 *
 * @param {string} sessionId - Co-Designer session UUID
 * @param {string} mbrId - Target MBR UUID
 * @param {string} userId - Designer's user UUID
 * @param {string} pdfText - Extracted and cleaned PDF text
 * @param {string} filename - Original PDF filename
 * @returns {Object} { proposals_created, structure }
 */
async function runPipeline(sessionId, mbrId, userId, pdfText, filename) {
  console.log(`[CO-DESIGNER] Pipeline started for session ${sessionId}`);

  // Update session status: decomposing
  await query("UPDATE co_designer_sessions SET status='decomposing', updated_at=NOW() WHERE id=$1", [sessionId]);

  await logAudit({
    userId, action: 'CO_DESIGNER_PROPOSAL', resourceType: 'CO_DESIGNER',
    resourceId: mbrId, details: `AI pipeline started for: ${filename}`,
    aiGenerated: true,
  });

  // Call LLM
  console.log('[CO-DESIGNER] Calling LLM for S88 decomposition...');
  const userMessage = `Here is the raw text extracted from a pharmaceutical Master Batch Record PDF named "${filename}". Please decompose it into the ISA-88 structure:\n\n---\n${pdfText.substring(0, 30000)}\n---`;

  let llmResponse;
  try {
    llmResponse = await callLLM(S88_SYSTEM_PROMPT, userMessage);
  } catch (err) {
    console.error('[CO-DESIGNER] LLM call failed:', err.message);
    await query("UPDATE co_designer_sessions SET status='error', updated_at=NOW() WHERE id=$1", [sessionId]);
    throw err;
  }

  // Parse JSON from LLM response
  console.log('[CO-DESIGNER] Parsing LLM response...');
  let structure;
  try {
    // Strip markdown code fences if present
    const cleaned = llmResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    structure = JSON.parse(cleaned);
  } catch (err) {
    console.error('[CO-DESIGNER] Failed to parse LLM JSON:', err.message);
    console.error('[CO-DESIGNER] Raw response (first 500 chars):', llmResponse.substring(0, 500));
    await query("UPDATE co_designer_sessions SET status='error', updated_at=NOW() WHERE id=$1", [sessionId]);
    throw new Error('AI response was not valid JSON. The MBR text may be too complex or poorly formatted.');
  }

  // Update session status: proposing
  await query("UPDATE co_designer_sessions SET status='proposing', updated_at=NOW() WHERE id=$1", [sessionId]);

  // Create proposals from the parsed structure
  console.log('[CO-DESIGNER] Creating proposals...');
  let proposalCount = 0;

  // Proposal 1: Full MBR header
  if (structure.product_name) {
    await createProposal(sessionId, mbrId, 'full_structure', {
      product_name: structure.product_name,
      product_code: structure.product_code,
      dosage_form: structure.dosage_form,
      batch_size: structure.batch_size,
      batch_size_unit: structure.batch_size_unit,
      description: structure.description,
    }, 0.85, `Extracted MBR header: ${structure.product_name}`);
    proposalCount++;
  }

  // Proposal per phase
  for (const phase of (structure.phases || [])) {
    await createProposal(sessionId, mbrId, 'phase', {
      phase_name: phase.phase_name,
      description: phase.description,
      sequence: phase.sequence,
      step_count: (phase.steps || []).length,
    }, 0.80, `Phase: ${phase.phase_name} (${(phase.steps||[]).length} operations)`);
    proposalCount++;

    // Proposal per step within the phase
    for (const step of (phase.steps || [])) {
      const paramCount = (step.parameters || []).length;
      const matCount = (step.materials || []).length;
      const eqCount = (step.equipment || []).length;
      const ipcCount = (step.ipc_checks || []).length;

      await createProposal(sessionId, mbrId, 'step', {
        phase_name: phase.phase_name,
        ...step,
      }, step.is_critical ? 0.75 : 0.82,
        `Step: ${step.step_name} [${step.step_type}] — ${paramCount} params, ${matCount} materials, ${eqCount} equip, ${ipcCount} IPC`
      );
      proposalCount++;
    }
  }

  // Proposal for BOM
  if (structure.bom && structure.bom.length > 0) {
    await createProposal(sessionId, mbrId, 'bom_item', {
      items: structure.bom,
      total_items: structure.bom.length,
      api_count: structure.bom.filter(b => b.is_active_ingredient).length,
    }, 0.78, `Bill of Materials: ${structure.bom.length} items (${structure.bom.filter(b=>b.is_active_ingredient).length} APIs)`);
    proposalCount++;
  }

  // Update session: awaiting review
  await query("UPDATE co_designer_sessions SET status='awaiting_review', updated_at=NOW() WHERE id=$1", [sessionId]);

  await logAudit({
    userId, action: 'CO_DESIGNER_PROPOSAL', resourceType: 'CO_DESIGNER',
    resourceId: mbrId, details: `AI pipeline complete: ${proposalCount} proposals created from ${filename}`,
    aiGenerated: true,
  });

  console.log(`[CO-DESIGNER] Pipeline complete: ${proposalCount} proposals created`);

  return { proposals_created: proposalCount, structure };
}

/**
 * Insert a proposal into the database
 */
async function createProposal(sessionId, mbrId, type, data, confidence, reasoning) {
  await query(
    'INSERT INTO co_designer_proposals (session_id, mbr_id, proposal_type, proposed_data, confidence, reasoning) VALUES ($1,$2,$3,$4,$5,$6)',
    [sessionId, mbrId, type, JSON.stringify(data), confidence, reasoning]
  );
}

// ════════════════════════════════════════════════════════════════════════
// APPLY ACCEPTED PROPOSALS — writes to actual MBR tables
// ════════════════════════════════════════════════════════════════════════

/**
 * Apply an accepted proposal to the MBR
 * Called when a designer clicks "Accept" on a proposal
 *
 * @param {string} proposalId
 * @param {string} mbrId
 * @param {string} userId
 */
async function applyProposal(proposalId, mbrId, userId) {
  const pRes = await query('SELECT * FROM co_designer_proposals WHERE id=$1', [proposalId]);
  if (pRes.rows.length === 0) throw new Error('Proposal not found');
  const proposal = pRes.rows[0];
  const data = typeof proposal.proposed_data === 'string' ? JSON.parse(proposal.proposed_data) : proposal.proposed_data;

  // Ensure MBR exists in master_batch_records (FK target for mbr_phases)
  const mbrSync = await query('SELECT 1 FROM master_batch_records WHERE id=$1', [mbrId]);
  if (mbrSync.rows.length === 0) {
    await query(
      `INSERT INTO master_batch_records (id, mbr_code, product_name, status, current_version, created_by)
       SELECT id, mbr_code, product_name, status, current_version, $1
       FROM mbrs WHERE id = $2
       ON CONFLICT (id) DO NOTHING`,
      [userId, mbrId]
    );
  }

  switch (proposal.proposal_type) {
    case 'full_structure':
      await query(
        'UPDATE mbrs SET product_name=COALESCE($1,product_name), product_code=COALESCE($2,product_code), dosage_form=COALESCE($3,dosage_form), batch_size=COALESCE($4,batch_size), batch_size_unit=COALESCE($5,batch_size_unit), description=COALESCE($6,description), updated_at=NOW() WHERE id=$7',
        [data.product_name, data.product_code, data.dosage_form, data.batch_size, data.batch_size_unit, data.description, mbrId]
      );
      break;

    case 'phase':
      const phCnt = await query('SELECT COALESCE(MAX(phase_number),0)+1 as n FROM mbr_phases WHERE mbr_id=$1', [mbrId]);
      const phaseNum = data.sequence || phCnt.rows[0].n;
      const newPhase = await query(
        'INSERT INTO mbr_phases (mbr_id, phase_number, phase_name, description, sort_order) VALUES ($1,$2,$3,$4,$2) RETURNING id',
        [mbrId, phaseNum, data.phase_name, data.description]
      );
      const newPhaseId = newPhase.rows[0].id;

      // Create nested steps if present (chat proposals include steps inside phase data)
      for (const step of (data.steps || [])) {
        const stCntP = await query('SELECT COALESCE(MAX(step_number),0)+1 as n FROM mbr_steps WHERE phase_id=$1', [newPhaseId]);
        const newStP = await query(
          'INSERT INTO mbr_steps (phase_id, mbr_id, step_number, step_name, instruction, step_type, duration_min, is_critical, is_gmp_critical, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$3) RETURNING id',
          [newPhaseId, mbrId, stCntP.rows[0].n, step.step_name, step.instruction, step.step_type || 'Processing', step.duration_min, step.is_critical || false, step.is_gmp_critical || false]
        );
        const newStepId = newStP.rows[0].id;

        for (const p of (step.parameters || [])) {
          await query('INSERT INTO mbr_step_parameters (step_id, mbr_id, param_name, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
            [newStepId, mbrId, p.param_name, p.target_value, p.unit, p.lower_limit, p.upper_limit, p.is_cpp || false, p.is_cqa || false]);
        }
        for (const m of (step.materials || [])) {
          await query('INSERT INTO mbr_step_materials (step_id, mbr_id, material_code, material_name, material_type, quantity, unit, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
            [newStepId, mbrId, m.material_code, m.material_name, m.material_type || 'Raw Material', m.quantity, m.unit, m.is_active || false]);
        }
        for (const e of (step.equipment || [])) {
          await query('INSERT INTO mbr_step_equipment (step_id, mbr_id, equipment_code, equipment_name, equipment_type, capacity, is_primary) VALUES ($1,$2,$3,$4,$5,$6,true)',
            [newStepId, mbrId, null, e.equipment_name, e.equipment_type || 'Blender', e.capacity]);
        }
        for (const c of (step.ipc_checks || [])) {
          await query('INSERT INTO mbr_ipc_checks (step_id, mbr_id, check_name, check_type, specification, frequency) VALUES ($1,$2,$3,$4,$5,$6)',
            [newStepId, mbrId, c.check_name, c.check_type, c.specification, c.frequency]);
        }
      }
      break;

    case 'step':
      // Find or create the parent phase
      let phaseId;
      const phRes = await query('SELECT id FROM mbr_phases WHERE mbr_id=$1 AND phase_name=$2', [mbrId, data.phase_name]);
      if (phRes.rows.length > 0) {
        phaseId = phRes.rows[0].id;
      } else {
        const phCnt2 = await query('SELECT COALESCE(MAX(phase_number),0)+1 as n FROM mbr_phases WHERE mbr_id=$1', [mbrId]);
        const newPh = await query('INSERT INTO mbr_phases (mbr_id, phase_number, phase_name, description, sort_order) VALUES ($1,$2,$3,$4,$2) RETURNING id',
          [mbrId, phCnt2.rows[0].n, data.phase_name, '']);
        phaseId = newPh.rows[0].id;
      }

      // Create step
      const stCnt = await query('SELECT COALESCE(MAX(step_number),0)+1 as n FROM mbr_steps WHERE phase_id=$1', [phaseId]);
      const newSt = await query(
        'INSERT INTO mbr_steps (phase_id, mbr_id, step_number, step_name, instruction, step_type, duration_min, is_critical, is_gmp_critical, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$3) RETURNING id',
        [phaseId, mbrId, stCnt.rows[0].n, data.step_name, data.instruction, data.step_type || 'Processing', data.duration_min, data.is_critical || false, data.is_gmp_critical || false]
      );
      const stepId = newSt.rows[0].id;

      // Create child entities
      for (const p of (data.parameters || [])) {
        await query('INSERT INTO mbr_step_parameters (step_id, mbr_id, param_name, target_value, unit, lower_limit, upper_limit, is_cpp, is_cqa) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
          [stepId, mbrId, p.param_name, p.target_value, p.unit, p.lower_limit, p.upper_limit, p.is_cpp || false, p.is_cqa || false]);
      }
      for (const m of (data.materials || [])) {
        await query('INSERT INTO mbr_step_materials (step_id, mbr_id, material_code, material_name, material_type, quantity, unit, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [stepId, mbrId, m.material_code, m.material_name, m.material_type || 'Raw Material', m.quantity, m.unit, m.is_active || false]);
      }
      for (const e of (data.equipment || [])) {
        await query('INSERT INTO mbr_step_equipment (step_id, mbr_id, equipment_code, equipment_name, equipment_type, capacity, is_primary) VALUES ($1,$2,$3,$4,$5,$6,true)',
          [stepId, mbrId, null, e.equipment_name, e.equipment_type || 'Reactor', e.capacity]);
      }
      for (const c of (data.ipc_checks || [])) {
        await query('INSERT INTO mbr_ipc_checks (step_id, mbr_id, check_name, check_type, specification, frequency) VALUES ($1,$2,$3,$4,$5,$6)',
          [stepId, mbrId, c.check_name, c.check_type, c.specification, c.frequency]);
      }
      break;

    case 'bom_item':
      for (const item of (data.items || [])) {
        const exists = await query('SELECT 1 FROM mbr_bom_items WHERE mbr_id=$1 AND material_name=$2', [mbrId, item.material_name]);
        if (exists.rows.length === 0) {
          await query(
            'INSERT INTO mbr_bom_items (mbr_id, material_code, material_name, quantity_per_batch, unit, tolerance_pct, supplier, grade, is_active_ingredient, dispensing_sequence, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)',
            [mbrId, item.material_code, item.material_name, item.quantity_per_batch, item.unit, item.tolerance_pct, item.supplier, item.grade, item.is_active_ingredient, 0]
          );
        }
      }
      break;
  }

  await logAudit({
    userId, action: 'CO_DESIGNER_ACCEPT', resourceType: 'MBR',
    resourceId: mbrId, details: `Applied AI proposal: ${proposal.proposal_type} — ${proposal.reasoning}`,
    aiGenerated: true,
  });
}


// ════════════════════════════════════════════════════════════════════════
// MBR CONTEXT BUILDER — fetches current MBR state for chat context
// ════════════════════════════════════════════════════════════════════════

async function buildMBRContext(mbrId) {
  const mbrR = await query('SELECT * FROM mbrs WHERE id=$1', [mbrId]);
  if (mbrR.rows.length === 0) return 'No MBR found.';
  const mbr = mbrR.rows[0];

  const phasesR = await query('SELECT * FROM mbr_phases WHERE mbr_id=$1 ORDER BY sort_order, phase_number', [mbrId]);
  const stepsR = await query('SELECT * FROM mbr_steps WHERE mbr_id=$1 ORDER BY sort_order, step_number', [mbrId]);
  const paramsR = await query('SELECT * FROM mbr_step_parameters WHERE mbr_id=$1', [mbrId]);
  const matsR = await query('SELECT * FROM mbr_step_materials WHERE mbr_id=$1', [mbrId]);
  const equipR = await query('SELECT * FROM mbr_step_equipment WHERE mbr_id=$1', [mbrId]);
  const ipcR = await query('SELECT * FROM mbr_ipc_checks WHERE mbr_id=$1', [mbrId]);
  const bomR = await query('SELECT * FROM mbr_bom_items WHERE mbr_id=$1 ORDER BY sort_order', [mbrId]);

  let ctx = `CURRENT MBR STATE:\n`;
  ctx += `Product: ${mbr.product_name} (${mbr.mbr_code})\n`;
  ctx += `Status: ${mbr.status} | Dosage Form: ${mbr.dosage_form} | Batch Size: ${mbr.batch_size} ${mbr.batch_size_unit}\n`;
  ctx += `Version: v${mbr.current_version}\n\n`;

  // Phases and steps
  if (phasesR.rows.length === 0) {
    ctx += `PHASES: None — MBR is empty.\n`;
  } else {
    ctx += `PHASES (${phasesR.rows.length}):\n`;
    for (const phase of phasesR.rows) {
      const phaseSteps = stepsR.rows.filter(s => s.phase_id === phase.id);
      ctx += `\n  ${phase.phase_number}. ${phase.phase_name} (${phaseSteps.length} operations)\n`;
      for (const step of phaseSteps) {
        const stepParams = paramsR.rows.filter(p => p.step_id === step.id);
        const stepMats = matsR.rows.filter(m => m.step_id === step.id);
        const stepEquip = equipR.rows.filter(e => e.step_id === step.id);
        const stepIpc = ipcR.rows.filter(c => c.step_id === step.id);
        ctx += `    ${step.step_number}. ${step.step_name} [${step.step_type}]${step.is_critical ? ' (CPP)' : ''}${step.duration_min ? ' ' + step.duration_min + 'min' : ''}\n`;
        if (step.instruction) ctx += `       Instruction: ${step.instruction.substring(0, 150)}\n`;
        if (stepParams.length > 0) {
          ctx += `       Parameters: ${stepParams.map(p => `${p.param_name}=${p.target_value}${p.unit || ''} [${p.lower_limit || '—'}–${p.upper_limit || '—'}]${p.is_cpp ? ' CPP' : ''}${p.is_cqa ? ' CQA' : ''}`).join(', ')}\n`;
        }
        if (stepMats.length > 0) ctx += `       Materials: ${stepMats.map(m => `${m.material_name} ${m.quantity || ''} ${m.unit || ''}`).join(', ')}\n`;
        if (stepEquip.length > 0) ctx += `       Equipment: ${stepEquip.map(e => e.equipment_name).join(', ')}\n`;
        if (stepIpc.length > 0) ctx += `       IPC: ${stepIpc.map(c => `${c.check_name}: ${c.specification}`).join(', ')}\n`;
      }
    }
  }

  // BOM
  if (bomR.rows.length > 0) {
    ctx += `\nBILL OF MATERIALS (${bomR.rows.length} items):\n`;
    for (const b of bomR.rows) {
      ctx += `  - ${b.material_name}: ${b.quantity_per_batch} ${b.unit}${b.is_active_ingredient ? ' (API)' : ''} ${b.grade || ''}\n`;
    }
  }

  return ctx;
}

// ════════════════════════════════════════════════════════════════════════
// CHAT WITH CONTEXT — conversational MBR design assistant
// ════════════════════════════════════════════════════════════════════════

const CHAT_SYSTEM_PROMPT = `You are an expert pharmaceutical MBR (Master Batch Record) Co-Designer assistant built into the PharmaMES.AI system.

You help users design and refine MBRs through conversation. You understand ISA-88 batch control (Procedure → Unit Procedure → Operation), 21 CFR Part 211, and GMP requirements.

The current MBR state is provided below. Use it to give context-aware answers.

CRITICAL RULES:
1. When the user specifies EXACT values (RPM, temperature, duration, equipment ID, limits), you MUST use those exact values in your response AND in the proposal JSON. Never generalize or paraphrase them.
2. Always echo back every value the user mentioned to confirm you understood: "I'll add a blending phase with Machine RPM = 11, duration = 20 minutes, equipment = BLND-001."
3. Generate complete proposals — include ALL fields: step_name, instruction, step_type, duration_min, parameters with target/limits/units, materials, equipment with codes, and IPC checks.
4. If the user mentions a parameter value, always include lower_limit and upper_limit (±10% of target unless specified otherwise).

RESPONSE FORMAT:
When the user asks you to ADD, MODIFY, or CREATE something, respond with BOTH:
1. A conversational confirmation that repeats back every specific value the user gave
2. A JSON block wrapped in <proposal> tags with complete structured data

Example for "Add a blending phase with RPM 11, 20 minutes, machine BLND-001":

"I'll add a Blending phase with the following specifications:
- Machine RPM: 11 (limits: 9–13)
- Duration: 20 minutes
- Equipment: BLND-001
- Step type: Processing

<proposal>
{"action":"add_phase","data":{"phase_name":"Blending","description":"Blending of coated pellets","sequence":3,"steps":[{"step_name":"Blending Operation","instruction":"Load coated pellets into blender BLND-001. Set impeller speed to 11 RPM. Blend for 20 minutes. Verify uniform distribution.","step_type":"Processing","duration_min":20,"is_critical":false,"is_gmp_critical":false,"parameters":[{"param_name":"Impeller Speed","target_value":"11","unit":"RPM","lower_limit":9,"upper_limit":13,"is_cpp":false,"is_cqa":false}],"materials":[],"equipment":[{"equipment_name":"Blender BLND-001","equipment_type":"Blender","capacity":null}],"ipc_checks":[]}]}}
</proposal>"

Supported actions: add_phase, add_step, add_parameter, add_material, add_equipment, add_ipc, modify_step, modify_parameter, add_bom_item, gap_analysis, review_compliance

When the user asks questions (what's missing, is this compliant, suggest improvements), answer conversationally with specific recommendations based on the current MBR state. Include <proposal> blocks for any changes you recommend.

When doing gap_analysis, check for: missing IPC checks after critical steps, missing CPP flags on parameters that should be critical, phases without environmental monitoring, hold times without limits, missing cleaning steps between phases, regulatory gaps per 21 CFR Part 211.

Keep responses concise and pharma-specific. Use ISA-88 terminology. Always be specific — never say "with the specified parameters", instead list every parameter explicitly.`;

async function chatWithContext(mbrId, userMessage, conversationHistory) {
  // Build current MBR context
  const mbrContext = await buildMBRContext(mbrId);

  // Build the full system prompt with context
  const fullSystemPrompt = CHAT_SYSTEM_PROMPT + '\n\n' + mbrContext;

  // Build messages array with history
  const messages = [];
  for (const msg of (conversationHistory || [])) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  // Call LLM
  const provider = process.env.CO_DESIGNER_PROVIDER || 'anthropic';

  let response;
  if (provider === 'groq') {
    response = await callGroqChat(fullSystemPrompt, messages);
  } else if (provider === 'xai') {
    response = await callXAIChat(fullSystemPrompt, messages);
  } else {
    response = await callAnthropicChat(fullSystemPrompt, messages);
  }

  // Extract proposals from <proposal> tags
  const proposals = [];
  const proposalRegex = /<proposal>([\s\S]*?)<\/proposal>/g;
  let match;
  while ((match = proposalRegex.exec(response)) !== null) {
    try {
      const cleaned = match[1].replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      proposals.push(JSON.parse(cleaned));
    } catch (e) {
      console.error('[CO-DESIGNER] Failed to parse proposal from chat:', e.message);
    }
  }

  // Clean response text (remove proposal blocks for display)
  const displayText = response.replace(/<proposal>[\s\S]*?<\/proposal>/g, '').trim();

  return { text: displayText, proposals };
}

// Multi-turn chat variants for each provider
async function callGroqChat(systemPrompt, messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.CO_DESIGNER_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.3, max_tokens: 4000,
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error('Groq chat error: ' + e.substring(0, 200)); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

// ════════════════════════════════════════════════════════════════════════
// STREAMING CHAT — yields chunks for SSE
// ════════════════════════════════════════════════════════════════════════

async function* streamChatWithContext(mbrId, userMessage, conversationHistory) {
  const mbrContext = await buildMBRContext(mbrId);
  const fullSystemPrompt = CHAT_SYSTEM_PROMPT + '\n\n' + mbrContext;

  const messages = [];
  for (const msg of (conversationHistory || [])) {
    messages.push({ role: msg.role, content: msg.content });
  }
  messages.push({ role: 'user', content: userMessage });

  const provider = process.env.CO_DESIGNER_PROVIDER || 'anthropic';

  if (provider === 'groq') {
    yield* streamGroq(fullSystemPrompt, messages);
  } else if (provider === 'xai') {
    yield* streamOpenAICompat('https://api.x.ai/v1/chat/completions', process.env.XAI_API_KEY, process.env.CO_DESIGNER_MODEL || 'grok-3-latest', fullSystemPrompt, messages);
  } else {
    yield* streamAnthropic(fullSystemPrompt, messages);
  }
}

async function* streamGroq(systemPrompt, messages) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY not set');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.CO_DESIGNER_MODEL || 'llama-3.3-70b-versatile',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.3, max_tokens: 4000, stream: true,
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error('Groq stream error: ' + e.substring(0, 200)); }
  yield* parseSSEStream(res.body);
}

async function* streamOpenAICompat(url, apiKey, model, systemPrompt, messages) {
  if (!apiKey) throw new Error('API key not set');
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.3, max_tokens: 4000, stream: true,
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error('Stream error: ' + e.substring(0, 200)); }
  yield* parseSSEStream(res.body);
}

async function* streamAnthropic(systemPrompt, messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CO_DESIGNER_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4000, system: systemPrompt, messages, stream: true,
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error('Anthropic stream error: ' + (e.error?.message || 'Unknown')); }

  // Anthropic SSE format: event: content_block_delta, data: {"delta":{"text":"..."}}
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const d = JSON.parse(line.slice(6));
          if (d.delta?.text) yield d.delta.text;
          if (d.type === 'content_block_delta' && d.delta?.text) yield d.delta.text;
        } catch {}
      }
    }
  }
}

async function* parseSSEStream(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() || '';
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') return;
        try {
          const d = JSON.parse(payload);
          const text = d.choices?.[0]?.delta?.content;
          if (text) yield text;
        } catch {}
      }
    }
  }
}

async function callXAIChat(systemPrompt, messages) {
  const apiKey = process.env.XAI_API_KEY;
  if (!apiKey) throw new Error('XAI_API_KEY not set');
  const res = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: process.env.CO_DESIGNER_MODEL || 'grok-3-latest',
      messages: [{ role: 'system', content: systemPrompt }, ...messages],
      temperature: 0.3, max_tokens: 4000,
    }),
  });
  if (!res.ok) { const e = await res.text().catch(() => ''); throw new Error('xAI chat error: ' + e.substring(0, 200)); }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function callAnthropicChat(systemPrompt, messages) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: process.env.CO_DESIGNER_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 4000, system: systemPrompt, messages,
    }),
  });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error('Anthropic chat error: ' + (e.error?.message || 'Unknown')); }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}


module.exports = { parsePDF, cleanText, extractSections, runPipeline, applyProposal, callLLM, buildMBRContext, chatWithContext, streamChatWithContext, validateMBR };

// ════════════════════════════════════════════════════════════════════════
// MBR VALIDATION — AI-powered regulatory and quality checks
// ════════════════════════════════════════════════════════════════════════

const VALIDATE_PROMPT = `You are a pharmaceutical QA auditor reviewing an MBR for regulatory compliance and completeness.

Analyze the MBR state below and check for:
1. MISSING CPP FLAGS — parameters that should be Critical Process Parameters but aren't flagged (e.g. temperature, pressure, RPM, mixing time for critical steps)
2. MISSING IPC CHECKS — steps that should have in-process controls but don't (e.g. after granulation, compression, coating)
3. MISSING EQUIPMENT — steps referencing processes that need equipment but have none listed
4. PARAMETER GAPS — parameters without upper/lower limits, or limits that seem too wide
5. HOLD TIME ISSUES — no hold time limits between steps where product may degrade
6. CLEANING GAPS — no cleaning steps between different product-contact phases
7. 21 CFR Part 211 GAPS — missing environmental monitoring, missing sampling points, missing yield checks
8. BOM ISSUES — materials referenced in steps but not in BOM, or BOM items not used in any step

Respond ONLY with valid JSON:
{
  "score": 0-100,
  "findings": [
    {
      "severity": "critical|major|minor|info",
      "category": "cpp|ipc|equipment|parameter|hold_time|cleaning|regulatory|bom",
      "phase": "phase name or null",
      "step": "step name or null",
      "finding": "clear description of the issue",
      "recommendation": "specific fix recommendation"
    }
  ],
  "summary": "2-3 sentence overall assessment"
}`;

async function validateMBR(mbrId) {
  const mbrContext = await buildMBRContext(mbrId);
  const userMessage = `Please validate this MBR for regulatory compliance and completeness:\n\n${mbrContext}`;
  const response = await callLLM(VALIDATE_PROMPT, userMessage);
  try {
    const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    return JSON.parse(cleaned);
  } catch (e) {
    return { score: 0, findings: [{ severity: 'critical', category: 'regulatory', phase: null, step: null, finding: 'Validation failed to parse: ' + e.message, recommendation: 'Re-run validation' }], summary: 'Validation encountered an error.' };
  }
}
