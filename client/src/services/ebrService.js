// client/src/services/ebrService.js — Aligned with Pharma-MBR Server
// Maps to: /api/ebr/* (server/routes/ebrRoutes.js)
import { ebr } from '../utils/api';

export async function listEBRs(params) {
  var r = await ebr.list(params);
  return { data: r.data.data || r.data };
}

export async function getEBR(id) {
  var r = await ebr.get(id);
  return r.data;
}

export async function createEBR(mbrId, batchNumber) {
  var r = await ebr.create({ mbr_id: mbrId, batch_number: batchNumber });
  return r.data;
}

// Step execution
export async function startStep(stepExecId) {
  var r = await ebr.startStep(stepExecId);
  return r.data;
}

export async function completeStep(stepExecId, data) {
  var r = await ebr.completeStep(stepExecId, data);
  return r.data;
}

export async function verifyStep(stepExecId) {
  var r = await ebr.verifyStep(stepExecId);
  return r.data;
}

// Parameter recording — returns { parameter, in_spec, deviation }
export async function recordParameter(paramValueId, data) {
  var r = await ebr.recordParam(paramValueId, data);
  return r.data;
}

// Deviations
export async function getDeviations(ebrId) {
  var r = await ebr.getDeviations(ebrId);
  return r.data.data || r.data;
}

export async function createDeviation(ebrId, data) {
  var r = await ebr.createDeviation(ebrId, data);
  return r.data;
}

export async function resolveDeviation(devId, data) {
  var r = await ebr.resolveDeviation(devId, data);
  return r.data;
}

// Materials
export async function addMaterial(ebrId, data) {
  var r = await ebr.addMaterial(ebrId, data);
  return r.data;
}

// Equipment
export async function addEquipment(ebrId, data) {
  var r = await ebr.addEquipment(ebrId, data);
  return r.data;
}

// IPC
export async function addIPC(ebrId, data) {
  var r = await ebr.addIPC(ebrId, data);
  return r.data;
}

// Yield
export async function addYield(ebrId, data) {
  var r = await ebr.addYield(ebrId, data);
  return r.data;
}

// Batch lifecycle
export async function completeBatch(ebrId) {
  var r = await ebr.completeBatch(ebrId);
  return r.data;
}

export async function releaseBatch(ebrId, decision, notes, password) {
  var r = await ebr.releaseBatch(ebrId, { decision: decision, notes: notes, password: password });
  return r.data;
}

// Stats (computed client-side from list)
export async function getEBRStats() {
  var list = await listEBRs();
  var data = list.data || [];
  return {
    total: data.length,
    in_progress: data.filter(function(e) { return e.status === 'In Progress'; }).length,
    completed: data.filter(function(e) { return e.status === 'Complete' || e.status === 'Released'; }).length,
    oos_count: data.reduce(function(s, e) { return s + (e.open_deviations || 0); }, 0),
  };
}

export default {
  listEBRs, getEBR, createEBR,
  startStep, completeStep, verifyStep,
  recordParameter, getDeviations, createDeviation, resolveDeviation,
  addMaterial, addEquipment, addIPC, addYield,
  completeBatch, releaseBatch, getEBRStats,
};
