// server/routes/coDesignerRoutes.js — Full Co-Designer AI Pipeline
// Upload PDF → Parse → LLM Decompose → Create Proposals → Human Review → Apply to MBR
const { Router } = require('express');
const crypto = require('crypto');
const path = require('path');
const multer = require('multer');
const { query } = require('../db/pool');
const { authenticate, authorize, verifyPasswordForSignature } = require('../middleware/middleware');
const { auditMiddleware } = require('../middleware/middleware');
// pdfParser functions now exported from coDesignerAgent (merged)
const { parsePDF, cleanText, extractSections, runPipeline, applyProposal } = require('../services/coDesignerAgent');  // ← CHANGED: single import (pdfParser merged in)

const router = Router();
router.use(authenticate);
router.use(auditMiddleware);

// Multer config — store PDFs in server/uploads/
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads'),
  filename: (req, file, cb) => cb(null, `mbr-${Date.now()}-${file.originalname}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are accepted'));
  },
});

// ═══ STATUS ═══
router.get('/:mbrId/status', async (req, res) => {
  try {
    const r = await query(
      'SELECT * FROM co_designer_sessions WHERE mbr_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1',
      [req.params.mbrId, req.session.userId]
    );
    if (r.rows.length === 0) return res.json({ mode: 'off', status: 'idle', session_id: null });
    const s = r.rows[0];
    const pc = await query(
      `SELECT COUNT(*) FILTER (WHERE status='pending') as pending,
              COUNT(*) FILTER (WHERE status='accepted') as accepted,
              COUNT(*) FILTER (WHERE status='rejected') as rejected,
              COUNT(*) as total
       FROM co_designer_proposals WHERE session_id=$1`, [s.id]
    );
    res.json({ ...s, proposals: pc.rows[0] });
  } catch (err) { res.status(500).json({ error: 'Failed to get status' }); }
});

// ═══ TOGGLE MODE ═══
router.post('/:mbrId/toggle', authorize('co_designer:toggle'), async (req, res) => {
  try {
    const { mode, password } = req.body;
    if (!['off', 'assist', 'co_design'].includes(mode)) return res.status(400).json({ error: 'Invalid mode' });

    // co_design requires Part 11 password verification
    if (mode === 'co_design') {
      if (!password) return res.status(400).json({ error: 'Password required for Co-Design mode (21 CFR Part 11 §11.200)' });
      const valid = await verifyPasswordForSignature(req.session.userId, password);
      if (!valid) {
        await req.audit({ action: 'CO_DESIGNER_TOGGLE', resourceType: 'CO_DESIGNER', resourceId: req.params.mbrId, details: `FAILED: mode change to ${mode}` });
        return res.status(401).json({ error: 'Password verification failed' });
      }
    }

    const ex = await query('SELECT id FROM co_designer_sessions WHERE mbr_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1', [req.params.mbrId, req.session.userId]);
    let session;
    if (ex.rows.length > 0) {
      const r = await query('UPDATE co_designer_sessions SET mode=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [mode, ex.rows[0].id]);
      session = r.rows[0];
    } else {
      const r = await query('INSERT INTO co_designer_sessions (mbr_id, user_id, mode) VALUES ($1,$2,$3) RETURNING *', [req.params.mbrId, req.session.userId, mode]);
      session = r.rows[0];
    }

    await req.audit({ action: 'CO_DESIGNER_TOGGLE', resourceType: 'CO_DESIGNER', resourceId: req.params.mbrId, details: `Mode: ${mode} by ${req.session.fullName}` });
    res.json(session);
  } catch (err) { console.error('[CO-DESIGNER] Toggle:', err); res.status(500).json({ error: 'Failed' }); }
});

// ═══ PDF UPLOAD + AI PIPELINE ═══
router.post('/:mbrId/upload-pdf', authorize('co_designer:toggle'), upload.single('pdf'), async (req, res) => {
  try {
    const { mbrId } = req.params;

    // Support both multipart file upload and base64 JSON
    let filePath, filename, pdfHash;

    if (req.file) {
      // Multer file upload
      filePath = req.file.path;
      filename = req.file.originalname;
      const fs = require('fs');
      const buf = fs.readFileSync(filePath);
      pdfHash = crypto.createHash('sha256').update(buf).digest('hex');
    } else if (req.body.pdf_base64) {
      // Base64 fallback
      const fs = require('fs');
      const buf = Buffer.from(req.body.pdf_base64, 'base64');
      pdfHash = crypto.createHash('sha256').update(buf).digest('hex');
      filename = req.body.filename || 'uploaded.pdf';
      filePath = path.join(__dirname, '..', 'uploads', `mbr-${Date.now()}-${filename}`);
      fs.writeFileSync(filePath, buf);
    } else {
      return res.status(400).json({ error: 'PDF file required (multipart or base64)' });
    }

    // Get or validate session
    const sessR = await query(
      'SELECT id, mode FROM co_designer_sessions WHERE mbr_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1',
      [mbrId, req.session.userId]
    );
    if (sessR.rows.length === 0 || sessR.rows[0].mode === 'off') {
      return res.status(400).json({ error: 'Co-Designer must be in Assist or Co-Design mode first' });
    }
    const sessionId = sessR.rows[0].id;

    // Update session with PDF info
    await query(
      "UPDATE co_designer_sessions SET source_pdf_name=$1, source_pdf_hash=$2, status='parsing', updated_at=NOW() WHERE id=$3",
      [filename, pdfHash, sessionId]
    );

    await req.audit({
      action: 'CREATE', resourceType: 'CO_DESIGNER', resourceId: mbrId,
      details: `PDF uploaded: ${filename} (${pdfHash.substring(0, 12)}...)`,
    });

    // Step 1: Parse PDF
    console.log(`[CO-DESIGNER] Parsing PDF: ${filename}`);
    let pdfData;
    try {
      pdfData = await parsePDF(filePath);
    } catch (parseErr) {
      console.error('[CO-DESIGNER] PDF parse failed:', parseErr.message);
      await query("UPDATE co_designer_sessions SET status='error', updated_at=NOW() WHERE id=$1", [sessionId]);
      return res.status(422).json({ error: 'Failed to parse PDF: ' + parseErr.message });
    }

    const cleanedText = cleanText(pdfData.text);
    const sections = extractSections(cleanedText);

    console.log(`[CO-DESIGNER] Extracted ${pdfData.pageCount} pages, ${cleanedText.length} chars, ${sections.length} sections`);

    // Step 2: Check if AI API key is configured
    const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
    const hasXAIKey = !!process.env.XAI_API_KEY;
    const hasGroqKey = !!process.env.GROQ_API_KEY;

    if (!hasAnthropicKey && !hasXAIKey && !hasGroqKey) {
      // No AI key — return extracted text and sections for manual review
      await query("UPDATE co_designer_sessions SET status='awaiting_review', updated_at=NOW() WHERE id=$1", [sessionId]);

      return res.json({
        session_id: sessionId,
        pdf_hash: pdfHash,
        filename,
        page_count: pdfData.pageCount,
        text_length: cleanedText.length,
        sections_found: sections.length,
        sections: sections.map(s => ({ heading: s.heading, preview: s.content.substring(0, 200) + '...' })),
        message: 'PDF parsed successfully. No AI API key configured — set ANTHROPIC_API_KEY, XAI_API_KEY, or GROQ_API_KEY in .env to enable automatic ISA-88 decomposition.',
        ai_available: false,
      });
    }

    // Step 3: Run AI pipeline (async — don't block the response)
    res.json({
      session_id: sessionId,
      pdf_hash: pdfHash,
      filename,
      page_count: pdfData.pageCount,
      text_length: cleanedText.length,
      sections_found: sections.length,
      message: 'PDF parsed. AI pipeline running — proposals will appear shortly.',
      ai_available: true,
      status: 'decomposing',
    });

    // Fire and forget — pipeline runs in background
    runPipeline(sessionId, mbrId, req.session.userId, cleanedText, filename).catch(err => {
      console.error('[CO-DESIGNER] Pipeline error:', err.message);
    });

  } catch (err) {
    console.error('[CO-DESIGNER] Upload error:', err);
    res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ═══ GET EXTRACTED TEXT (for manual review when no AI key) ═══
router.get('/:mbrId/extracted-text', authorize('co_designer:review'), async (req, res) => {
  try {
    const sessR = await query(
      'SELECT source_pdf_name FROM co_designer_sessions WHERE mbr_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1',
      [req.params.mbrId, req.session.userId]
    );
    if (sessR.rows.length === 0) return res.status(404).json({ error: 'No session' });

    // Find the PDF file
    const fs = require('fs');
    const uploadsDir = path.join(__dirname, '..', 'uploads');
    const files = fs.readdirSync(uploadsDir).filter(f => f.endsWith('.pdf')).sort().reverse();
    if (files.length === 0) return res.status(404).json({ error: 'No PDF found' });

    const pdfData = await parsePDF(path.join(uploadsDir, files[0]));
    const cleaned = cleanText(pdfData.text);
    const sections = extractSections(cleaned);

    res.json({
      text: cleaned,
      page_count: pdfData.pageCount,
      sections: sections,
    });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ PROPOSALS ═══
router.get('/:mbrId/proposals', authorize('co_designer:review'), async (req, res) => {
  try {
    let sql = 'SELECT p.*, u.full_name as reviewer_name FROM co_designer_proposals p LEFT JOIN users u ON p.reviewed_by = u.id WHERE p.mbr_id=$1';
    const params = [req.params.mbrId];
    if (req.query.status) { sql += ' AND p.status=$2'; params.push(req.query.status); }
    sql += ' ORDER BY p.created_at ASC';  // oldest first so proposals appear in order
    const r = await query(sql, params);
    res.json({ data: r.rows });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ REVIEW PROPOSAL (accept/modify/reject) + AUTO-APPLY ═══
router.put('/:mbrId/proposals/:proposalId/review', authorize('co_designer:review'), async (req, res) => {
  try {
    const { action, review_notes, modified_data } = req.body;
    if (!['accepted', 'modified', 'rejected'].includes(action)) {
      return res.status(400).json({ error: 'Action must be: accepted, modified, or rejected' });
    }

    const r = await query(
      `UPDATE co_designer_proposals SET status=$1, reviewed_by=$2, review_notes=$3, reviewed_at=NOW(),
       proposed_data=COALESCE($4, proposed_data) WHERE id=$5 RETURNING *`,
      [action, req.session.userId, review_notes, modified_data ? JSON.stringify(modified_data) : null, req.params.proposalId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Proposal not found' });

    const auditAct = action === 'rejected' ? 'CO_DESIGNER_REJECT' : 'CO_DESIGNER_ACCEPT';
    await req.audit({ action: auditAct, resourceType: 'CO_DESIGNER', resourceId: req.params.mbrId, details: `Proposal ${action}: ${r.rows[0].proposal_type}` });

    // Auto-apply accepted proposals to MBR tables
    if (action === 'accepted' || action === 'modified') {
      try {
        await applyProposal(req.params.proposalId, req.params.mbrId, req.session.userId);
        console.log(`[CO-DESIGNER] Proposal ${req.params.proposalId} applied to MBR`);
      } catch (applyErr) {
        console.error('[CO-DESIGNER] Apply error:', applyErr.message);
        // Don't fail the review — just note the apply error
        return res.json({ ...r.rows[0], apply_warning: 'Proposal accepted but failed to auto-apply: ' + applyErr.message });
      }
    }

    // Check if all proposals are reviewed — update session status
    const pending = await query(
      "SELECT COUNT(*) as cnt FROM co_designer_proposals WHERE session_id=$1 AND status='pending'",
      [r.rows[0].session_id]
    );
    if (parseInt(pending.rows[0].cnt) === 0) {
      await query("UPDATE co_designer_sessions SET status='completed', updated_at=NOW() WHERE id=$1", [r.rows[0].session_id]);
    }

    res.json(r.rows[0]);
  } catch (err) { console.error('[CO-DESIGNER] Review:', err); res.status(500).json({ error: 'Failed' }); }
});

// ═══ ACCEPT ALL pending proposals at once ═══
router.post('/:mbrId/proposals/accept-all', authorize('co_designer:review'), async (req, res) => {
  try {
    const pending = await query(
      "SELECT id FROM co_designer_proposals WHERE mbr_id=$1 AND status='pending' ORDER BY created_at ASC",
      [req.params.mbrId]
    );

    let applied = 0;
    let errors = [];
    for (const row of pending.rows) {
      try {
        await query(
          "UPDATE co_designer_proposals SET status='accepted', reviewed_by=$1, reviewed_at=NOW() WHERE id=$2",
          [req.session.userId, row.id]
        );
        await applyProposal(row.id, req.params.mbrId, req.session.userId);
        applied++;
      } catch (e) {
        errors.push({ id: row.id, error: e.message });
      }
    }

    await req.audit({
      action: 'CO_DESIGNER_ACCEPT', resourceType: 'CO_DESIGNER', resourceId: req.params.mbrId,
      details: `Bulk accept: ${applied}/${pending.rows.length} proposals applied`,
    });

    res.json({ total: pending.rows.length, applied, errors });
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

// ═══ METRICS ═══
router.get('/:mbrId/metrics', authorize('co_designer:review'), async (req, res) => {
  try {
    const r = await query(
      `SELECT COUNT(*) as total,
              COUNT(*) FILTER (WHERE status='accepted') as accepted,
              COUNT(*) FILTER (WHERE status='rejected') as rejected,
              COUNT(*) FILTER (WHERE status='modified') as modified,
              COUNT(*) FILTER (WHERE status='pending') as pending,
              AVG(confidence) FILTER (WHERE status='accepted') as avg_confidence
       FROM co_designer_proposals WHERE mbr_id=$1`,
      [req.params.mbrId]
    );
    res.json(r.rows[0]);
  } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

module.exports = router;
