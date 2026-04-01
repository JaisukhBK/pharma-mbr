// server/services/sbomService.js — SBOM & Configuration Management
// GAMP5 D8 | FDA CSA — Build provenance

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { query } = require('../db/pool');

function generateSBOM() {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const lockPath = path.join(__dirname, '..', 'package-lock.json');

  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const deps = Object.entries(pkg.dependencies || {}).map(([name, version]) => ({ name, version, type: 'production' }));
  const devDeps = Object.entries(pkg.devDependencies || {}).map(([name, version]) => ({ name, version, type: 'development' }));

  let lockVersion = null;
  if (fs.existsSync(lockPath)) {
    try {
      const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      lockVersion = lock.lockfileVersion;
    } catch (e) { /* ignore */ }
  }

  const sbom = {
    format: 'Pharma-MBR SBOM v1.0',
    generated_at: new Date().toISOString(),
    application: { name: pkg.name, version: pkg.version },
    node_version: process.version,
    lockfile_version: lockVersion,
    dependencies: deps,
    dev_dependencies: devDeps,
    total_packages: deps.length + devDeps.length,
  };

  sbom.content_hash = crypto.createHash('sha256').update(JSON.stringify(sbom.dependencies)).digest('hex');
  return sbom;
}

async function saveSnapshot(snapshotType, content, versionTag, gitSha, createdBy) {
  const hash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
  const r = await query(
    `INSERT INTO system_config_snapshots (snapshot_type, version_tag, git_sha, content, content_hash, created_by)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [snapshotType, versionTag, gitSha, JSON.stringify(content), hash, createdBy]
  );
  return r.rows[0];
}

async function getSnapshots(snapshotType) {
  const r = await query(
    'SELECT id, snapshot_type, version_tag, git_sha, content_hash, created_by, created_at FROM system_config_snapshots WHERE snapshot_type=$1 ORDER BY created_at DESC',
    [snapshotType]
  );
  return r.rows;
}

function getSystemHealth() {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  return {
    service: 'Pharma-MBR',
    version: pkg.version,
    node_version: process.version,
    environment: process.env.NODE_ENV || 'development',
    compliance: ['21 CFR Part 11', 'GAMP5 Cat.5', 'ISA-88', 'ISA-95'],
    uptime_seconds: Math.floor(process.uptime()),
    memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
  };
}

module.exports = { generateSBOM, saveSnapshot, getSnapshots, getSystemHealth };
