// client/src/services/apiService.js — Unified API layer
// Merged from: authService.js + mbrService.js + coDesignerService.js + mbrFeaturesService.js
// Single fetch helper eliminates 4x duplicate token/error handling (Part 11 §11.10(d))

const API = import.meta.env.VITE_API_URL || '';
const MBR = `${API}/api/mbr`;
const CD  = `${API}/api/co-designer`;

// ════════════════════════════════════════════════════════════════════════
// SHARED FETCH HELPER — single point of auth token management
// ════════════════════════════════════════════════════════════════════════

async function apiFetch(url, opts = {}) {
  const token = localStorage.getItem('pharma_mbr_token');
  const headers = { ...(token && { Authorization: `Bearer ${token}` }), ...opts.headers };
  if (!(opts.body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const res = await fetch(url, { headers, ...opts });
  if (res.status === 401) {
    // Only auto-logout for expired/invalid JWT (session expiry).
    // Do NOT logout for password verification failures on these endpoints:
    // - /toggle (Co-Design mode §11.200 password re-entry)
    // - /sign (e-signature §11.200 password re-entry)
    // - /verify-password (explicit password check)
    // - /login (login attempt — no session to clear)
    const isPasswordEndpoint = /\/(toggle|sign|verify-password|login)(\/|$|\?)/.test(url);
    if (!isPasswordEndpoint) {
      localStorage.removeItem('pharma_mbr_token');
      localStorage.removeItem('pharma_mbr_user');
      window.dispatchEvent(new CustomEvent('auth:expired'));
    }
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    const e = new Error(d.error || `Error ${res.status}`);
    e.status = res.status;
    throw e;
  }
  return res;
}

async function f(url, opts = {}) {
  const res = await apiFetch(url, opts);
  return res.json();
}

// ════════════════════════════════════════════════════════════════════════
// AUTH SERVICE (was authService.js)
// ════════════════════════════════════════════════════════════════════════

export const authService = {
  async login(email, password) {
    const r = await f(`${API}/api/auth/login`, { method: 'POST', body: JSON.stringify({ email, password }) });
    if (r.token) {
      localStorage.setItem('pharma_mbr_token', r.token);
      localStorage.setItem('pharma_mbr_user', JSON.stringify(r.user));
    }
    return r;
  },
  logout() { localStorage.removeItem('pharma_mbr_token'); localStorage.removeItem('pharma_mbr_user'); },
  getCurrentUser() { try { return JSON.parse(localStorage.getItem('pharma_mbr_user')); } catch { return null; } },
  getToken() { return localStorage.getItem('pharma_mbr_token'); },
  isAuthenticated() {
    const t = this.getToken(); if (!t) return false;
    try { return JSON.parse(atob(t.split('.')[1])).exp * 1000 > Date.now(); } catch { return false; }
  },
  hasPermission(p) { const u = this.getCurrentUser(); return u?.permissions?.includes(p) || false; },
  async verifyPassword(password) { return f(`${API}/api/auth/verify-password`, { method: 'POST', body: JSON.stringify({ password }) }); },
  async getProfile() { return f(`${API}/api/auth/me`); },
};

// ════════════════════════════════════════════════════════════════════════
// MBR SERVICE (was mbrService.js)
// ════════════════════════════════════════════════════════════════════════

export const mbrService = {
  // MBR CRUD
  listMBRs: (p = {}) => { const q = new URLSearchParams(p); return f(`${MBR}?${q}`); },
  getMBR: (id) => f(`${MBR}/${id}`),
  createMBR: (data) => f(MBR, { method: 'POST', body: JSON.stringify(data) }),
  updateMBR: (id, data) => f(`${MBR}/${id}`, { method: 'PUT', body: JSON.stringify(data) }),

  // Phases
  createPhase: (mbrId, data) => f(`${MBR}/${mbrId}/phases`, { method: 'POST', body: JSON.stringify(data) }),
  updatePhase: (mbrId, phaseId, data) => f(`${MBR}/${mbrId}/phases/${phaseId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deletePhase: (mbrId, phaseId) => f(`${MBR}/${mbrId}/phases/${phaseId}`, { method: 'DELETE' }),

  // Steps
  createStep: (mbrId, phaseId, data) => f(`${MBR}/${mbrId}/phases/${phaseId}/steps`, { method: 'POST', body: JSON.stringify(data) }),
  updateStep: (mbrId, stepId, data) => f(`${MBR}/${mbrId}/steps/${stepId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteStep: (mbrId, stepId) => f(`${MBR}/${mbrId}/steps/${stepId}`, { method: 'DELETE' }),

  // Parameters
  createParameter: (mbrId, stepId, data) => f(`${MBR}/${mbrId}/steps/${stepId}/parameters`, { method: 'POST', body: JSON.stringify(data) }),
  updateParameter: (mbrId, paramId, data) => f(`${MBR}/${mbrId}/parameters/${paramId}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteParameter: (mbrId, paramId) => f(`${MBR}/${mbrId}/parameters/${paramId}`, { method: 'DELETE' }),

  // Materials + Equipment + IPC
  createMaterial: (mbrId, stepId, data) => f(`${MBR}/${mbrId}/steps/${stepId}/materials`, { method: 'POST', body: JSON.stringify(data) }),
  deleteMaterial: (mbrId, matId) => f(`${MBR}/${mbrId}/materials/${matId}`, { method: 'DELETE' }),
  createEquipment: (mbrId, stepId, data) => f(`${MBR}/${mbrId}/steps/${stepId}/equipment`, { method: 'POST', body: JSON.stringify(data) }),
  createIPCCheck: (mbrId, stepId, data) => f(`${MBR}/${mbrId}/steps/${stepId}/ipc-checks`, { method: 'POST', body: JSON.stringify(data) }),

  // BOM + Reorder
  updateBOM: (mbrId, items) => f(`${MBR}/${mbrId}/bom`, { method: 'PUT', body: JSON.stringify({ items }) }),
  reorderPhases: (mbrId, ids) => f(`${MBR}/${mbrId}/reorder/phases`, { method: 'PUT', body: JSON.stringify({ ordered_ids: ids }) }),
  reorderSteps: (mbrId, phaseId, ids) => f(`${MBR}/${mbrId}/reorder/steps/${phaseId}`, { method: 'PUT', body: JSON.stringify({ ordered_ids: ids }) }),

  // Signatures + Versioning + Audit
  signMBR: (mbrId, data) => f(`${MBR}/${mbrId}/sign`, { method: 'POST', body: JSON.stringify(data) }),
  createNewVersion: (mbrId, reason) => f(`${MBR}/${mbrId}/new-version`, { method: 'POST', body: JSON.stringify({ change_reason: reason }) }),
  getAuditTrail: (mbrId, p = {}) => { const q = new URLSearchParams(p); return f(`${MBR}/${mbrId}/audit?${q}`); },

  // Batch save (used by MBRDesigner Save button)
  async saveMBRDesignerState(mbrId, mbrData, phases, bom) {
    try { return await f(`${MBR}/${mbrId}/batch-save`, { method: 'POST', body: JSON.stringify({ mbr: mbrData, phases, bom }) }); }
    catch { /* fallback to sequential */ }
    const updated = await this.updateMBR(mbrId, { product_name: mbrData.product_name, product_code: mbrData.product_code, dosage_form: mbrData.dosage_form, batch_size: mbrData.batch_size, batch_size_unit: mbrData.batch_size_unit, description: mbrData.description, change_reason: 'Designer save' });
    for (const phase of phases) {
      if (phase._isNew) { const c = await this.createPhase(mbrId, { phase_name: phase.phase_name, description: phase.description }); phase.id = c.id; phase._isNew = false; }
      else await this.updatePhase(mbrId, phase.id, { phase_name: phase.phase_name, description: phase.description, sort_order: phase.sort_order });
      for (const step of phase.steps || []) {
        if (step._isNew) { const c = await this.createStep(mbrId, phase.id, { step_name: step.step_name, instruction: step.instruction, step_type: step.step_type, duration_min: step.duration_min, is_critical: step.is_critical, is_gmp_critical: step.is_gmp_critical }); step.id = c.id; step._isNew = false; }
        else await this.updateStep(mbrId, step.id, { step_name: step.step_name, instruction: step.instruction, step_type: step.step_type, duration_min: step.duration_min, is_critical: step.is_critical, is_gmp_critical: step.is_gmp_critical, sort_order: step.sort_order, weighing_config: step.weighing_config, sampling_plan: step.sampling_plan, yield_config: step.yield_config, hold_config: step.hold_config, env_config: step.env_config, l2_config: step.l2_config });
        for (const p of step.parameters || []) { if (p._isNew) { const c = await this.createParameter(mbrId, step.id, { param_name: p.param_name, param_type: p.param_type, target_value: p.target_value, unit: p.unit, lower_limit: p.lower_limit, upper_limit: p.upper_limit, is_cpp: p.is_cpp, is_cqa: p.is_cqa }); p.id = c.id; p._isNew = false; } else await this.updateParameter(mbrId, p.id, { param_name: p.param_name, target_value: p.target_value, unit: p.unit, lower_limit: p.lower_limit, upper_limit: p.upper_limit, is_cpp: p.is_cpp, is_cqa: p.is_cqa }); }
        for (const m of step.materials || []) { if (m._isNew) { const c = await this.createMaterial(mbrId, step.id, { material_code: m.material_code, material_name: m.material_name, material_type: m.material_type, quantity: m.quantity, unit: m.unit, is_active: m.is_active }); m.id = c.id; m._isNew = false; } }
        for (const eq of step.equipment || []) { if (eq._isNew) { const c = await this.createEquipment(mbrId, step.id, { equipment_code: eq.equipment_code, equipment_name: eq.equipment_name, equipment_type: eq.equipment_type, capacity: eq.capacity, is_primary: eq.is_primary }); eq.id = c.id; eq._isNew = false; } }
      }
    }
    return updated;
  },
};

// ════════════════════════════════════════════════════════════════════════
// CO-DESIGNER SERVICE (was coDesignerService.js)
// ════════════════════════════════════════════════════════════════════════

export const cdService = {
  getCoDesignerStatus: (mbrId) => f(`${CD}/${mbrId}/status`),
  toggleCoDesigner: (mbrId, mode, password) =>
    f(`${CD}/${mbrId}/toggle`, { method: 'POST', body: JSON.stringify({ mode, password }) }),

  // PDF Upload — multipart form (what multer expects on the server)
  async uploadPDF(mbrId, file) {
    const formData = new FormData();
    formData.append('pdf', file);
    const res = await apiFetch(`${CD}/${mbrId}/upload-pdf`, { method: 'POST', body: formData });
    return res.json();
  },

  listProposals: (mbrId, status) =>
    f(`${CD}/${mbrId}/proposals${status ? '?status=' + status : ''}`),

  reviewProposal: (mbrId, id, action, notes, modified) =>
    f(`${CD}/${mbrId}/proposals/${id}/review`, {
      method: 'PUT',
      body: JSON.stringify({ action, review_notes: notes, modified_data: modified }),
    }),

  acceptAllProposals: (mbrId) =>
    f(`${CD}/${mbrId}/proposals/accept-all`, { method: 'POST' }),

  getMetrics: (mbrId) => f(`${CD}/${mbrId}/metrics`),

  getExtractedText: (mbrId) => f(`${CD}/${mbrId}/extracted-text`),

  async pollUntilDone(mbrId, onUpdate, intervalMs = 2000, maxAttempts = 60) {
    for (let i = 0; i < maxAttempts; i++) {
      const status = await this.getCoDesignerStatus(mbrId);
      if (onUpdate) onUpdate(status);
      if (status.status === 'awaiting_review' || status.status === 'completed' || status.status === 'error') {
        return status;
      }
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error('Pipeline timed out');
  },
};

// ════════════════════════════════════════════════════════════════════════
// MBR FEATURES SERVICE (was mbrFeaturesService.js)
// ════════════════════════════════════════════════════════════════════════

export const featuresService = {
  // Feature 1: XML Export/Import
  async exportXML(mbrId) {
    const res = await apiFetch(`${MBR}/${mbrId}/export/xml`);
    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `MBR-${mbrId.substring(0, 8)}.xml`;
    a.click();
    window.URL.revokeObjectURL(url);
  },

  async importXML(file) {
    const formData = new FormData();
    formData.append('xml', file);
    const res = await apiFetch(`${MBR}/import/xml`, { method: 'POST', body: formData });
    return res.json();
  },

  // Feature 2: Duplicate
  async duplicateMBR(mbrId) { const res = await apiFetch(`${MBR}/${mbrId}/duplicate`, { method: 'POST' }); return res.json(); },
  async duplicatePhase(mbrId, phaseId) { const res = await apiFetch(`${MBR}/${mbrId}/phases/${phaseId}/duplicate`, { method: 'POST' }); return res.json(); },
  async duplicateStep(mbrId, stepId) { const res = await apiFetch(`${MBR}/${mbrId}/steps/${stepId}/duplicate`, { method: 'POST' }); return res.json(); },

  // Feature 3: Multi-Document Attachments
  async uploadAttachments(mbrId, files) {
    const formData = new FormData();
    for (const file of files) formData.append('files', file);
    const res = await apiFetch(`${MBR}/${mbrId}/attachments`, { method: 'POST', body: formData });
    return res.json();
  },
  async listAttachments(mbrId) { const res = await apiFetch(`${MBR}/${mbrId}/attachments`); return res.json(); },
  async deleteAttachment(mbrId, attId) { const res = await apiFetch(`${MBR}/${mbrId}/attachments/${attId}`, { method: 'DELETE' }); return res.json(); },

  // Feature 8: Supersede Phase
  async supersedePhase(mbrId, phaseId, reason, description) {
    const res = await apiFetch(`${MBR}/${mbrId}/phases/${phaseId}/supersede`, {
      method: 'POST', body: JSON.stringify({ reason, description }),
    });
    return res.json();
  },

  // Feature 10: Formulas
  async listFormulas(mbrId) { const res = await apiFetch(`${MBR}/${mbrId}/formulas`); return res.json(); },
  async createFormula(mbrId, data) { const res = await apiFetch(`${MBR}/${mbrId}/formulas`, { method: 'POST', body: JSON.stringify(data) }); return res.json(); },
  async updateFormula(mbrId, formulaId, data) { const res = await apiFetch(`${MBR}/${mbrId}/formulas/${formulaId}`, { method: 'PUT', body: JSON.stringify(data) }); return res.json(); },
  async trialFormula(mbrId, formulaId, variables) { const res = await apiFetch(`${MBR}/${mbrId}/formulas/${formulaId}/trial`, { method: 'POST', body: JSON.stringify({ variables }) }); return res.json(); },
  async evaluateFormula(mbrId, expression, variables) { const res = await apiFetch(`${MBR}/${mbrId}/formulas/evaluate`, { method: 'POST', body: JSON.stringify({ expression, variables }) }); return res.json(); },

  // Feature 11: Voice — uses Web Speech API (client-side only)
  createVoiceListener(onResult, onError) {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      if (onError) onError('Speech recognition not supported in this browser');
      return null;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';
    recognition.onresult = (event) => {
      let transcript = '';
      let isFinal = false;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
        if (event.results[i].isFinal) isFinal = true;
      }
      if (onResult) onResult(transcript, isFinal);
    };
    recognition.onerror = (event) => { if (onError) onError(event.error); };
    return { start: () => recognition.start(), stop: () => recognition.stop(), recognition };
  },
};

// Default export for backward compatibility where default imports were used
export default { authService, mbrService, cdService, featuresService };
