// client/src/services/complianceService.js — GAMP5 Compliance Suite
// Maps to: /api/compliance/* (server/routes/complianceRoutes.js)
import { compliance } from '../utils/api';

// ═══ Risk Assessment (FMEA) ═══
export async function getRisks(mbrId) {
  var r = await compliance.getRisks(mbrId);
  return r.data;
}

export async function createRisk(mbrId, data) {
  var r = await compliance.createRisk(mbrId, data);
  return r.data;
}

export async function updateRisk(riskId, data) {
  var r = await compliance.updateRisk(riskId, data);
  return r.data;
}

export async function reviewRisk(riskId) {
  var r = await compliance.reviewRisk(riskId);
  return r.data;
}

export async function getRiskSummary(mbrId) {
  var r = await compliance.getRiskSummary(mbrId);
  return r.data;
}

// ═══ RTM Generator ═══
export async function getRTM() {
  var r = await compliance.getRTM();
  return r.data;
}

// ═══ Periodic Reviews ═══
export async function getReviews(params) {
  var r = await compliance.getReviews(params);
  return r.data;
}

export async function getReviewsDashboard() {
  var r = await compliance.getReviewsDashboard();
  return r.data;
}

export async function getUpcomingReviews(days) {
  var r = await compliance.getUpcomingReviews(days);
  return r.data;
}

export async function getOverdueReviews() {
  var r = await compliance.getOverdueReviews();
  return r.data;
}

export async function createReview(data) {
  var r = await compliance.createReview(data);
  return r.data;
}

export async function completeReview(id, data) {
  var r = await compliance.completeReview(id, data);
  return r.data;
}

// ═══ AI Governance ═══
export async function listModels(status) {
  var r = await compliance.listModels(status);
  return r.data;
}

export async function registerModel(data) {
  var r = await compliance.registerModel(data);
  return r.data;
}

export async function updateModelStatus(id, data) {
  var r = await compliance.updateModelStatus(id, data);
  return r.data;
}

export async function getModelMetrics(id) {
  var r = await compliance.getModelMetrics(id);
  return r.data;
}

export async function getModelDrift(id, threshold) {
  var r = await compliance.getModelDrift(id, threshold);
  return r.data;
}

// ═══ SBOM & Config ═══
export async function getSBOM() {
  var r = await compliance.getSBOM();
  return r.data;
}

export async function getSystemHealth() {
  var r = await compliance.getSystemHealth();
  return r.data;
}

export default {
  getRisks, createRisk, updateRisk, reviewRisk, getRiskSummary,
  getRTM,
  getReviews, getReviewsDashboard, getUpcomingReviews, getOverdueReviews, createReview, completeReview,
  listModels, registerModel, updateModelStatus, getModelMetrics, getModelDrift,
  getSBOM, getSystemHealth,
};
