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
  // pdf-parse must be required at call time (lazy load)
  const pdfParse = require('pdf-parse');
  const buffer = fs.readFileSync(filePath);
  const data = await pdfParse(buffer);

  return {
    text: data.text,
    pageCount: data.numpages,
    info: data.info || {},
    metadata: data.metadata || {},
    // Split into pages by common page break patterns
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

  switch (proposal.proposal_type) {
    case 'full_structure':
      await query(
        'UPDATE mbrs SET product_name=COALESCE($1,product_name), product_code=COALESCE($2,product_code), dosage_form=COALESCE($3,dosage_form), batch_size=COALESCE($4,batch_size), batch_size_unit=COALESCE($5,batch_size_unit), description=COALESCE($6,description), updated_at=NOW() WHERE id=$7',
        [data.product_name, data.product_code, data.dosage_form, data.batch_size, data.batch_size_unit, data.description, mbrId]
      );
      break;

    case 'phase':
      const phCnt = await query('SELECT COALESCE(MAX(phase_number),0)+1 as n FROM mbr_phases WHERE mbr_id=$1', [mbrId]);
      await query(
        'INSERT INTO mbr_phases (mbr_id, phase_number, phase_name, description, sort_order) VALUES ($1,$2,$3,$4,$2)',
        [mbrId, data.sequence || phCnt.rows[0].n, data.phase_name, data.description]
      );
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


module.exports = { parsePDF, cleanText, extractSections, runPipeline, applyProposal, callLLM };
