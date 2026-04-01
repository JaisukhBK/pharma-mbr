// client/src/services/trainingService.js — Training Management
// Maps to: /api/training/* (server/routes/trainingRoutes.js)
import { training } from '../utils/api';

export async function listCurricula() {
  var r = await training.listCurricula();
  return r.data;
}

export async function createCurriculum(data) {
  var r = await training.createCurriculum(data);
  return r.data;
}

export async function getMyStatus() {
  var r = await training.myStatus();
  return r.data;
}

export async function getRecords() {
  var r = await training.getRecords();
  return r.data;
}

export async function assignTraining(data) {
  var r = await training.assign(data);
  return r.data;
}

export async function assignRequired(data) {
  var r = await training.assignRequired(data);
  return r.data;
}

export async function completeTraining(recordId, data) {
  var r = await training.completeRecord(recordId, data);
  return r.data;
}

export async function getExpiring(days) {
  var r = await training.getExpiring(days);
  return r.data;
}

export async function getMatrix() {
  var r = await training.getMatrix();
  return r.data;
}

export async function getUserStatus(userId) {
  var r = await training.getUserStatus(userId);
  return r.data;
}

export default {
  listCurricula, createCurriculum, getMyStatus, getRecords,
  assignTraining, assignRequired, completeTraining,
  getExpiring, getMatrix, getUserStatus,
};
