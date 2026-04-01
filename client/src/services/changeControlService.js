// client/src/services/changeControlService.js — Change Control Workflow
// Maps to: /api/change-control/* (server/routes/changeControlRoutes.js)
import { changeControl } from '../utils/api';

export async function listTypes() {
  var r = await changeControl.listTypes();
  return r.data;
}

export async function listCRs(params) {
  var r = await changeControl.list(params);
  return r.data;
}

export async function getCR(id) {
  var r = await changeControl.get(id);
  return r.data;
}

export async function createCR(data) {
  var r = await changeControl.create(data);
  return r.data;
}

export async function updateCR(id, data) {
  var r = await changeControl.update(id, data);
  return r.data;
}

export async function submitCR(id) {
  var r = await changeControl.submit(id);
  return r.data;
}

export async function approveCR(id, data) {
  var r = await changeControl.approve(id, data);
  return r.data;
}

export async function implementCR(id) {
  var r = await changeControl.implement(id);
  return r.data;
}

export async function verifyCR(id) {
  var r = await changeControl.verify(id);
  return r.data;
}

export async function closeCR(id) {
  var r = await changeControl.close(id);
  return r.data;
}

export async function cancelCR(id) {
  var r = await changeControl.cancel(id);
  return r.data;
}

export async function getMyApprovals() {
  var r = await changeControl.myApprovals();
  return r.data;
}

export default {
  listTypes, listCRs, getCR, createCR, updateCR,
  submitCR, approveCR, implementCR, verifyCR, closeCR, cancelCR,
  getMyApprovals,
};
