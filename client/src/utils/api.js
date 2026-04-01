// client/src/utils/api.js — Aligned with Pharma-MBR Server
// Axios client with JWT interceptors
import axios from 'axios';

var api = axios.create({ baseURL: '/api', headers: { 'Content-Type': 'application/json' } });

var authToken = null;
export function setToken(token) { authToken = token; }
export function clearToken() { authToken = null; }

api.interceptors.request.use(function(config) {
  if (authToken) config.headers.Authorization = 'Bearer ' + authToken;
  return config;
});

api.interceptors.response.use(
  function(r) { return r; },
  function(error) {
    // Smart 401 handling — don't auto-logout on signature/toggle/verify-password routes
    if (error.response && error.response.status === 401) {
      var url = (error.config && error.config.url) || '';
      var isSignatureRoute = /\/(sign|toggle|verify-password|login)/.test(url);
      if (!isSignatureRoute) {
        clearToken();
        window.dispatchEvent(new CustomEvent('session-expired'));
      }
    }
    return Promise.reject(error);
  }
);

// ═══ AUTH — Server uses email/password ═══
export var auth = {
  login: function(email, password) { return api.post('/auth/login', { email: email, password: password }); },
  register: function(data) { return api.post('/auth/register', data); },
  getSession: function() { return api.get('/auth/me'); },
  verifyPassword: function(password) { return api.post('/auth/verify-password', { password: password }); },
  listUsers: function() { return api.get('/auth/users'); },
  logout: function() { clearToken(); return Promise.resolve(); },
};

// ═══ MBR — ISA-88 Master Batch Records ═══
export var mbr = {
  list: function() { return api.get('/mbr'); },
  get: function(id) { return api.get('/mbr/' + id); },
  create: function(data) { return api.post('/mbr', data); },
  update: function(id, data) { return api.put('/mbr/' + id, data); },
  del: function(id) { return api.delete('/mbr/' + id); },
  // Phases
  createPhase: function(mbrId, data) { return api.post('/mbr/' + mbrId + '/phases', data); },
  updatePhase: function(mbrId, phaseId, data) { return api.put('/mbr/' + mbrId + '/phases/' + phaseId, data); },
  deletePhase: function(mbrId, phaseId) { return api.delete('/mbr/' + mbrId + '/phases/' + phaseId); },
  // Steps
  createStep: function(mbrId, phaseId, data) { return api.post('/mbr/' + mbrId + '/phases/' + phaseId + '/steps', data); },
  updateStep: function(mbrId, stepId, data) { return api.put('/mbr/' + mbrId + '/steps/' + stepId, data); },
  deleteStep: function(mbrId, stepId) { return api.delete('/mbr/' + mbrId + '/steps/' + stepId); },
  // Parameters, Materials, Equipment, IPC, BOM
  createParam: function(mbrId, stepId, data) { return api.post('/mbr/' + mbrId + '/steps/' + stepId + '/parameters', data); },
  createMaterial: function(mbrId, stepId, data) { return api.post('/mbr/' + mbrId + '/steps/' + stepId + '/materials', data); },
  createEquipment: function(mbrId, stepId, data) { return api.post('/mbr/' + mbrId + '/steps/' + stepId + '/equipment', data); },
  createIPC: function(mbrId, stepId, data) { return api.post('/mbr/' + mbrId + '/steps/' + stepId + '/ipc', data); },
  updateBOM: function(mbrId, data) { return api.put('/mbr/' + mbrId + '/bom', data); },
  // Signatures & Lifecycle
  sign: function(mbrId, data) { return api.post('/mbr/' + mbrId + '/sign', data); },
  newVersion: function(mbrId, data) { return api.post('/mbr/' + mbrId + '/new-version', data); },
  getTransitions: function(mbrId) { return api.get('/mbr/' + mbrId + '/transitions'); },
  getAudit: function(mbrId) { return api.get('/mbr/' + mbrId + '/audit'); },
  // Export / Import
  exportXML: function(mbrId) { return api.get('/mbr/' + mbrId + '/export-xml'); },
  importXML: function(formData) { return api.post('/mbr/import-xml', formData, { headers: { 'Content-Type': 'multipart/form-data' } }); },
  batchSave: function(mbrId, data) { return api.post('/mbr/' + mbrId + '/batch-save', data); },
};

// ═══ EBR — Electronic Batch Record Execution ═══
export var ebr = {
  list: function(params) { return api.get('/ebr', { params: params }); },
  get: function(id) { return api.get('/ebr/' + id); },
  create: function(data) { return api.post('/ebr', data); },
  // Step execution
  startStep: function(stepExecId) { return api.post('/ebr/steps/' + stepExecId + '/start'); },
  completeStep: function(stepExecId, data) { return api.post('/ebr/steps/' + stepExecId + '/complete', data); },
  verifyStep: function(stepExecId) { return api.post('/ebr/steps/' + stepExecId + '/verify'); },
  // Parameters
  getParams: function(ebrId) { return api.get('/ebr/' + ebrId + '/parameters'); },
  recordParam: function(paramId, data) { return api.post('/ebr/parameters/' + paramId + '/record', data); },
  // Deviations
  getDeviations: function(ebrId) { return api.get('/ebr/' + ebrId + '/deviations'); },
  createDeviation: function(ebrId, data) { return api.post('/ebr/' + ebrId + '/deviations', data); },
  resolveDeviation: function(devId, data) { return api.put('/ebr/deviations/' + devId + '/resolve', data); },
  // Materials
  addMaterial: function(ebrId, data) { return api.post('/ebr/' + ebrId + '/materials', data); },
  verifyMaterial: function(matId) { return api.post('/ebr/materials/' + matId + '/verify'); },
  // Equipment
  addEquipment: function(ebrId, data) { return api.post('/ebr/' + ebrId + '/equipment', data); },
  // IPC
  addIPC: function(ebrId, data) { return api.post('/ebr/' + ebrId + '/ipc', data); },
  // Yield
  addYield: function(ebrId, data) { return api.post('/ebr/' + ebrId + '/yield', data); },
  // Batch lifecycle
  completeBatch: function(ebrId) { return api.post('/ebr/' + ebrId + '/complete'); },
  releaseBatch: function(ebrId, data) { return api.post('/ebr/' + ebrId + '/release', data); },
};

// ═══ TRAINING — §11.10(i) ═══
export var training = {
  listCurricula: function() { return api.get('/training/curricula'); },
  createCurriculum: function(data) { return api.post('/training/curricula', data); },
  updateCurriculum: function(id, data) { return api.put('/training/curricula/' + id, data); },
  myStatus: function() { return api.get('/training/my-status'); },
  getRecords: function() { return api.get('/training/records'); },
  assign: function(data) { return api.post('/training/assign', data); },
  assignRequired: function(data) { return api.post('/training/assign-required', data); },
  completeRecord: function(id, data) { return api.put('/training/records/' + id + '/complete', data); },
  updateRecord: function(id, data) { return api.put('/training/records/' + id, data); },
  getExpiring: function(days) { return api.get('/training/expiring', { params: { days: days || 30 } }); },
  expireCheck: function() { return api.post('/training/expire-check'); },
  getMatrix: function() { return api.get('/training/matrix'); },
  getUserStatus: function(userId) { return api.get('/training/user/' + userId + '/status'); },
};

// ═══ CHANGE CONTROL — GAMP5 D8 ═══
export var changeControl = {
  listTypes: function() { return api.get('/change-control/types'); },
  list: function(params) { return api.get('/change-control', { params: params }); },
  get: function(id) { return api.get('/change-control/' + id); },
  create: function(data) { return api.post('/change-control', data); },
  update: function(id, data) { return api.put('/change-control/' + id, data); },
  submit: function(id) { return api.post('/change-control/' + id + '/submit'); },
  approve: function(id, data) { return api.post('/change-control/' + id + '/approve', data); },
  implement: function(id) { return api.post('/change-control/' + id + '/implement'); },
  verify: function(id) { return api.post('/change-control/' + id + '/verify'); },
  close: function(id) { return api.post('/change-control/' + id + '/close'); },
  cancel: function(id) { return api.post('/change-control/' + id + '/cancel'); },
  myApprovals: function() { return api.get('/change-control/pending/my-approvals'); },
};

// ═══ COMPLIANCE — GAMP5 Features 6-10 ═══
export var compliance = {
  // Risk Assessment (FMEA)
  getRisks: function(mbrId) { return api.get('/compliance/risk/' + mbrId); },
  createRisk: function(mbrId, data) { return api.post('/compliance/risk/' + mbrId, data); },
  updateRisk: function(riskId, data) { return api.put('/compliance/risk/' + riskId, data); },
  reviewRisk: function(riskId) { return api.post('/compliance/risk/' + riskId + '/review'); },
  getRiskSummary: function(mbrId) { return api.get('/compliance/risk/' + mbrId + '/summary'); },
  // RTM
  getRTM: function() { return api.get('/compliance/rtm'); },
  // Periodic Reviews
  getReviews: function(params) { return api.get('/compliance/reviews', { params: params }); },
  getReviewsDashboard: function() { return api.get('/compliance/reviews/dashboard'); },
  getUpcomingReviews: function(days) { return api.get('/compliance/reviews/upcoming', { params: { days: days } }); },
  getOverdueReviews: function() { return api.get('/compliance/reviews/overdue'); },
  createReview: function(data) { return api.post('/compliance/reviews', data); },
  completeReview: function(id, data) { return api.post('/compliance/reviews/' + id + '/complete', data); },
  // AI Governance
  listModels: function(status) { return api.get('/compliance/ai/models', { params: { status: status } }); },
  registerModel: function(data) { return api.post('/compliance/ai/models', data); },
  updateModelStatus: function(id, data) { return api.put('/compliance/ai/models/' + id + '/status', data); },
  recordModelMetrics: function(id, data) { return api.post('/compliance/ai/models/' + id + '/metrics', data); },
  getModelMetrics: function(id) { return api.get('/compliance/ai/models/' + id + '/metrics'); },
  getModelDrift: function(id, threshold) { return api.get('/compliance/ai/models/' + id + '/drift', { params: { threshold: threshold } }); },
  // SBOM
  getSBOM: function() { return api.get('/compliance/sbom'); },
  saveSBOMSnapshot: function(data) { return api.post('/compliance/sbom/snapshot', data); },
  getSBOMSnapshots: function(type) { return api.get('/compliance/sbom/snapshots', { params: { type: type } }); },
  getSystemHealth: function() { return api.get('/compliance/system-health'); },
};

// ═══ CO-DESIGNER — AI-assisted MBR ═══
export var coDesigner = {
  getStatus: function(mbrId) { return api.get('/co-designer/' + mbrId + '/status'); },
  toggle: function(mbrId, data) { return api.post('/co-designer/' + mbrId + '/toggle', data); },
  upload: function(mbrId, formData) { return api.post('/co-designer/' + mbrId + '/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } }); },
  listProposals: function(mbrId) { return api.get('/co-designer/' + mbrId + '/proposals'); },
  reviewProposal: function(mbrId, propId, data) { return api.put('/co-designer/' + mbrId + '/proposals/' + propId + '/review', data); },
  getMetrics: function(mbrId) { return api.get('/co-designer/' + mbrId + '/metrics'); },
};

// ═══ AUDIT — §11.10(e) ═══
export var audit = {
  query: function(params) { return api.get('/audit', { params: params }); },
};

// ═══ SYSTEM ═══
export var system = {
  health: function() { return api.get('/health'); },
};

export default api;
