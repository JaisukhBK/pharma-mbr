// server/services/bmsPollingEngine.js — BMS/EMS Polling Engine
// FS-ENV-001 FR-ENV-001 — Scheduled polling of BMS REST API endpoints
// ISA-95 / Purdue Level 4 → Level 3 (DMZ) → Level 2 (BMS)
//
// Architecture:
//   - Runs as a background process alongside the Express server
//   - Each BMS connection has its own polling interval
//   - Fetches via HTTPS through the DMZ API gateway
//   - Maps BMS tags to internal sensors
//   - Processes readings through the standard ingestion pipeline (validation → storage → alerts)
//   - Retries failed polls with exponential backoff (5s, 15s, 45s)
//   - Marks sensors "Offline" after 3 consecutive failures
//
// For Vercel (serverless): use the /api/env/poll/trigger endpoint via Vercel Cron instead

const { query } = require('../db/pool');
const envService = require('./envMonitoringService');

const MAX_RETRIES = 3;
const BACKOFF_BASE = 5000; // 5s, 15s, 45s
const activePollers = new Map(); // connectionId → intervalId

// ════════════════════════════════════════════════════════════════
// POLL A SINGLE BMS CONNECTION
// ════════════════════════════════════════════════════════════════

async function pollConnection(connection) {
  const connId = connection.id;
  const connName = connection.connection_name;
  let retryCount = 0;
  let lastError = null;

  while (retryCount <= MAX_RETRIES) {
    try {
      // Build request based on auth type
      const headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' };

      switch (connection.auth_type) {
        case 'API_KEY':
          headers['X-API-Key'] = connection.api_key;
          break;
        case 'Bearer':
          headers['Authorization'] = `Bearer ${connection.api_key}`;
          break;
        case 'Basic':
          headers['Authorization'] = `Basic ${Buffer.from(connection.api_key).toString('base64')}`;
          break;
        case 'OAuth2':
          // For OAuth2, api_key stores the access token (token refresh handled separately)
          headers['Authorization'] = `Bearer ${connection.api_key}`;
          break;
        // 'None' — no auth headers
      }

      // Fetch from BMS endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout

      const response = await fetch(connection.endpoint_url, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!response.ok) {
        throw new Error(`BMS API returned HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      // Process the BMS response — expects either:
      // 1. Array of { tag: "CR-A-101.TEMP.PV", value: 22.3, timestamp: "..." }
      // 2. Object with nested tag:value pairs { "CR-A-101.TEMP.PV": 22.3, ... }
      // 3. Object with readings array { readings: [...] }
      const readings = normalizeBmsResponse(data);

      // Ingest each reading through the standard pipeline
      let successCount = 0;
      let failCount = 0;
      const alerts = [];

      for (const reading of readings) {
        try {
          const result = await envService.ingestReading({
            bms_tag: reading.tag,
            value: reading.value,
            source: 'BMS',
            bms_timestamp: reading.timestamp || new Date().toISOString(),
          });
          successCount++;
          if (result.alert) alerts.push(result.alert);
        } catch (e) {
          failCount++;
          console.warn(`[BMS-POLL] ${connName}: Tag ${reading.tag} failed: ${e.message}`);
        }
      }

      // Update connection status
      await query(
        `UPDATE env_bms_connections SET last_poll_at=NOW(), last_poll_status='Success', updated_at=NOW() WHERE id=$1`,
        [connId]);

      console.log(`[BMS-POLL] ${connName}: ${successCount} readings ingested, ${failCount} failed, ${alerts.length} alerts`);

      // Log to audit trail
      await query(
        `INSERT INTO audit_trail (user_id, action, resource_type, resource_id, details, created_at)
         VALUES ('SYSTEM', 'BMS_POLL', 'BMS_CONNECTION', $1, $2, NOW())`,
        [connId, `Poll success: ${successCount} readings, ${failCount} errors, ${alerts.length} alerts from ${connName}`]
      ).catch(() => {}); // Don't fail on audit log error

      return { success: true, readings: successCount, failed: failCount, alerts: alerts.length };

    } catch (error) {
      lastError = error;
      retryCount++;

      if (retryCount <= MAX_RETRIES) {
        const backoff = BACKOFF_BASE * Math.pow(3, retryCount - 1); // 5s, 15s, 45s
        console.warn(`[BMS-POLL] ${connName}: Attempt ${retryCount}/${MAX_RETRIES} failed (${error.message}). Retrying in ${backoff / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      }
    }
  }

  // All retries exhausted
  console.error(`[BMS-POLL] ${connName}: All ${MAX_RETRIES} retries failed. Last error: ${lastError?.message}`);

  // Update connection status to Failed
  await query(
    `UPDATE env_bms_connections SET last_poll_at=NOW(), last_poll_status='Failed', updated_at=NOW() WHERE id=$1`,
    [connId]);

  // Mark all sensors on this connection as Offline
  await query(
    `UPDATE env_sensors SET status='Offline', updated_at=NOW() WHERE bms_source=$1 AND is_active=true`,
    [connection.connection_name]);

  // Log failure to audit trail
  await query(
    `INSERT INTO audit_trail (user_id, action, resource_type, resource_id, details, created_at)
     VALUES ('SYSTEM', 'BMS_POLL_FAIL', 'BMS_CONNECTION', $1, $2, NOW())`,
    [connId, `Poll failed after ${MAX_RETRIES} retries: ${lastError?.message}. Sensors marked Offline.`]
  ).catch(() => {});

  return { success: false, error: lastError?.message };
}

// ════════════════════════════════════════════════════════════════
// NORMALIZE BMS RESPONSE — handle different BMS API formats
// ════════════════════════════════════════════════════════════════

function normalizeBmsResponse(data) {
  // Format 1: Array of tag/value objects
  if (Array.isArray(data)) {
    return data.map(item => ({
      tag: item.tag || item.bms_tag || item.pointName || item.name,
      value: item.value || item.pv || item.currentValue,
      timestamp: item.timestamp || item.time || item.ts,
    })).filter(r => r.tag && r.value !== undefined);
  }

  // Format 2: Object with readings array
  if (data.readings && Array.isArray(data.readings)) {
    return normalizeBmsResponse(data.readings);
  }

  // Format 3: Object with data array (Siemens Desigo CC format)
  if (data.data && Array.isArray(data.data)) {
    return normalizeBmsResponse(data.data);
  }

  // Format 4: Object with points array (Honeywell EBI format)
  if (data.points && Array.isArray(data.points)) {
    return data.points.map(p => ({
      tag: p.objectReference || p.pointId || p.name,
      value: p.presentValue || p.value,
      timestamp: p.timestamp,
    })).filter(r => r.tag && r.value !== undefined);
  }

  // Format 5: Flat tag:value object { "CR-A-101.TEMP.PV": 22.3, ... }
  if (typeof data === 'object' && !Array.isArray(data)) {
    return Object.entries(data)
      .filter(([key]) => key.includes('.') && !['readings', 'data', 'points', 'status', 'meta'].includes(key))
      .map(([tag, value]) => ({
        tag,
        value: typeof value === 'object' ? (value.value || value.pv) : value,
        timestamp: typeof value === 'object' ? value.timestamp : null,
      }))
      .filter(r => r.value !== undefined && !isNaN(parseFloat(r.value)));
  }

  console.warn('[BMS-POLL] Unrecognized BMS response format');
  return [];
}

// ════════════════════════════════════════════════════════════════
// POLLING SCHEDULER — starts/stops background polling per connection
// ════════════════════════════════════════════════════════════════

async function startPolling() {
  const connections = await query(
    'SELECT * FROM env_bms_connections WHERE is_active=true AND endpoint_url IS NOT NULL'
  );

  if (connections.rows.length === 0) {
    console.log('[BMS-POLL] No active BMS connections configured. Polling idle.');
    return;
  }

  for (const conn of connections.rows) {
    const intervalMs = (conn.polling_interval_sec || 300) * 1000;
    const connId = conn.id;

    // Don't start duplicate pollers
    if (activePollers.has(connId)) continue;

    console.log(`[BMS-POLL] Starting poller for "${conn.connection_name}" every ${conn.polling_interval_sec || 300}s → ${conn.endpoint_url}`);

    // Run first poll immediately
    pollConnection(conn).catch(e => console.error(`[BMS-POLL] Initial poll failed for ${conn.connection_name}:`, e.message));

    // Schedule recurring polls
    const intervalId = setInterval(() => {
      pollConnection(conn).catch(e => console.error(`[BMS-POLL] Poll failed for ${conn.connection_name}:`, e.message));
    }, intervalMs);

    activePollers.set(connId, intervalId);
  }

  console.log(`[BMS-POLL] ${activePollers.size} pollers active.`);
}

function stopPolling() {
  for (const [connId, intervalId] of activePollers) {
    clearInterval(intervalId);
  }
  activePollers.clear();
  console.log('[BMS-POLL] All pollers stopped.');
}

async function restartPolling() {
  stopPolling();
  await startPolling();
}

// Poll all connections once (for Vercel Cron trigger)
async function pollAllOnce() {
  const connections = await query(
    'SELECT * FROM env_bms_connections WHERE is_active=true AND endpoint_url IS NOT NULL'
  );

  const results = [];
  for (const conn of connections.rows) {
    const result = await pollConnection(conn);
    results.push({ connection: conn.connection_name, ...result });
  }
  return results;
}

// ════════════════════════════════════════════════════════════════
// STATUS
// ════════════════════════════════════════════════════════════════

function getPollerStatus() {
  return {
    active_pollers: activePollers.size,
    connections: [...activePollers.keys()],
    is_serverless: !!process.env.VERCEL,
  };
}

module.exports = {
  pollConnection,
  startPolling,
  stopPolling,
  restartPolling,
  pollAllOnce,
  getPollerStatus,
};
