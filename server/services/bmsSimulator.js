// server/services/bmsSimulator.js — Mock BMS REST API for testing
// Generates realistic environmental readings for all configured sensors
// Use: configure a BMS connection with endpoint_url = "http://localhost:{PORT}/api/env/simulate/bms"
// The polling engine will fetch from this endpoint like a real BMS

const { query } = require('../db/pool');

// Generate realistic readings with slight variations
function generateReading(paramType, lowLimit, highLimit) {
  const low = parseFloat(lowLimit) || 0;
  const high = parseFloat(highLimit) || 100;
  const mid = (low + high) / 2;
  const range = high - low;

  // 90% chance in-spec, 8% warning, 2% alarm
  const roll = Math.random();
  let value;

  if (roll < 0.90) {
    // In-spec: random between limits with normal-ish distribution around midpoint
    const offset = (Math.random() - 0.5) * range * 0.6;
    value = mid + offset;
  } else if (roll < 0.98) {
    // Warning: slightly outside limits
    const breach = range * 0.05 * (Math.random() + 0.5);
    value = Math.random() > 0.5 ? high + breach : low - breach;
  } else {
    // Alarm: significantly outside limits
    const breach = range * 0.15 * (Math.random() + 1);
    value = Math.random() > 0.5 ? high + breach : low - breach;
  }

  // Round to 1 decimal place
  return Math.round(value * 10) / 10;
}

// Generate a full BMS response payload for all active sensors
async function generateBmsPayload() {
  const sensors = await query(
    `SELECT s.sensor_code, s.bms_tag, s.parameter_type, s.unit, s.low_limit, s.high_limit
     FROM env_sensors s WHERE s.is_active=true AND s.bms_tag IS NOT NULL`
  );

  const readings = sensors.rows.map(s => ({
    tag: s.bms_tag,
    value: generateReading(s.parameter_type, s.low_limit, s.high_limit),
    timestamp: new Date().toISOString(),
    unit: s.unit,
    quality: 'Good',
  }));

  return readings;
}

module.exports = { generateBmsPayload, generateReading };
