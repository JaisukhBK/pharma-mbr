// client/src/components/EnvMonitoring/EnvMonitoringDashboard.jsx
// Environmental Monitoring — EU GMP Annex 1 | 21 CFR 211.42 | ISO 14644
import { useState, useEffect, useCallback } from 'react';
import {
  Thermometer, Droplets, Wind, AlertTriangle, CheckCircle, Loader2,
  ArrowLeft, Plus, Search, ChevronDown, Eye, XCircle, RefreshCw, Radio, X
} from 'lucide-react';
import { envService } from '../../services/apiService';
import { Badge, Card, Btn, Input, Select, SumCard, Label, ErrBox } from '../ui/PharmUI';

const PARAM_ICONS = { Temperature: Thermometer, Humidity: Droplets, DiffPressure: Wind, ParticleCount_0_5um: Radio, ParticleCount_5um: Radio, AirVelocity: Wind, LuxLevel: Radio, CO2: Wind, O2: Wind };
const PARAM_COLORS = { Temperature: '#f5a623', Humidity: '#2dceef', DiffPressure: '#5046e5', ParticleCount_0_5um: '#f5365c', ParticleCount_5um: '#f5365c', AirVelocity: '#7c3aed' };
const STATUS_COLORS = { Normal: '#00e5a0', Warning: '#f5a623', Alarm: '#f5365c', Offline: '#7a8ba8', Maintenance: '#2dceef' };
const ZONE_TYPES = ['Production','Warehouse','QC Lab','Dispensing','Packaging','Utility','Corridor','Airlock'];
const GMP_GRADES = ['A','B','C','D','Unclassified'];

export default function EnvMonitoringDashboard({ theme }) {
  const t = theme;
  const [view, setView] = useState('dashboard');
  const [zones, setZones] = useState([]);
  const [stats, setStats] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [zonesR, statsR, alertsR] = await Promise.all([
        envService.listZones(), envService.getStats(), envService.getAlerts(),
      ]);
      setZones(zonesR.data || []);
      setStats(statsR);
      setAlerts(alertsR.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openZone = async (id) => {
    try { setSelected(await envService.getZone(id)); setView('zone'); } catch (e) { setError(e.message); }
  };

  // ─── DASHBOARD VIEW ───────────────────────────────────────────
  if (view === 'dashboard') return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: 0 }}>Environmental Monitoring</h2>
          <p style={{ fontSize: 12, color: t.textMuted, margin: '4px 0 0' }}>BMS/EMS integration, zone monitoring, alerts — EU GMP Annex 1 · ISO 14644</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn t={t} variant="ghost" onClick={async () => { try { await envService.simulateRun(); loadAll(); } catch (e) { setError(e.message); } }}><Radio size={14} />Simulate BMS</Btn>
          <Btn t={t} variant="ghost" onClick={loadAll}><RefreshCw size={14} />Refresh</Btn>
          <Btn t={t} onClick={() => setView('create')}><Plus size={14} />Add Zone</Btn>
        </div>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <SumCard label="Monitored zones" val={stats.total_zones} sub={`${stats.total_sensors} sensors`} color={t.accent} t={t} />
          <SumCard label="Normal" val={stats.sensors_normal} sub="All readings in spec" color="#00e5a0" t={t} />
          <SumCard label="Warnings / Alarms" val={(stats.sensors_warning || 0) + (stats.sensors_alarm || 0)} sub={`${stats.sensors_alarm || 0} alarms, ${stats.sensors_warning || 0} warnings`} color={(stats.sensors_alarm > 0) ? '#f5365c' : (stats.sensors_warning > 0) ? '#f5a623' : '#00e5a0'} t={t} />
          <SumCard label="Active alerts" val={stats.active_alerts} sub={`${stats.readings_24h} readings (24h)`} color={stats.active_alerts > 0 ? '#f5365c' : '#00e5a0'} t={t} />
        </div>
      )}

      {/* Active Alerts Banner */}
      {alerts.length > 0 && (
        <Card t={t} style={{ marginBottom: 16, padding: '12px 16px', borderLeft: '3px solid #f5365c' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={14} color="#f5365c" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f5365c' }}>Active Alerts ({alerts.length})</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {alerts.slice(0, 5).map(a => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: a.alert_type === 'Alarm' ? '#f5365c08' : '#f5a62308', borderRadius: 6, fontSize: 11 }}>
                <Badge color={a.alert_type === 'Alarm' ? '#f5365c' : '#f5a623'} t={t}>{a.alert_type}</Badge>
                <span style={{ fontWeight: 600, color: t.text }}>{a.zone_name}</span>
                <span style={{ color: t.textMuted }}>{a.sensor_name}: {a.value} {a.unit}</span>
                <span style={{ color: t.textMuted }}>{a.limit_breached}: {a.limit_value}</span>
                <span style={{ color: t.textMuted, marginLeft: 'auto', fontSize: 10 }}>{new Date(a.created_at).toLocaleString()}</span>
                {!a.acknowledged_by && (
                  <Btn t={t} size="sm" variant="ghost" onClick={async () => { try { await envService.acknowledgeAlert(a.id); loadAll(); } catch (e) { setError(e.message); } }}><Eye size={10} />Ack</Btn>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Zone Cards */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={22} color={t.accent} style={{ animation: 'spin 1s linear infinite' }} /></div>
      ) : zones.length === 0 ? (
        <Card t={t} style={{ textAlign: 'center', padding: '40px 0' }}>
          <Thermometer size={28} color={t.textMuted} style={{ marginBottom: 8 }} />
          <p style={{ color: t.textMuted, fontSize: 13, fontWeight: 600 }}>No monitored zones</p>
        </Card>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {zones.map(z => {
            const hasAlerts = parseInt(z.active_alerts) > 0;
            return (
              <Card t={t} key={z.id} style={{ padding: '14px 18px', cursor: 'pointer', borderLeft: hasAlerts ? '3px solid #f5365c' : '3px solid transparent' }} onClick={() => openZone(z.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{z.zone_name}</span>
                      {hasAlerts && <Badge color="#f5365c" t={t}>{z.active_alerts} alerts</Badge>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, fontSize: 10, color: t.textMuted }}>
                      <span style={{ fontFamily: "'DM Mono',monospace" }}>{z.zone_code}</span>
                      <span>{z.zone_type}</span>
                      {z.iso_class && <span>{z.iso_class}</span>}
                      {z.gmp_grade && <Badge color="#5046e5" t={t}>GMP {z.gmp_grade}</Badge>}
                      <span>{z.sensor_count} sensors</span>
                    </div>
                  </div>
                  <ChevronDown size={14} color={t.textMuted} style={{ transform: 'rotate(-90deg)' }} />
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );

  // ─── CREATE ZONE ──────────────────────────────────────────────
  if (view === 'create') return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={() => setView('dashboard')}><ArrowLeft size={14} />Back</Btn>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: t.text, margin: 0 }}>Add Monitored Zone</h2>
      </div>
      <ZoneForm t={t} onSave={async (data) => { await envService.createZone(data); setView('dashboard'); loadAll(); }} onCancel={() => setView('dashboard')} />
    </div>
  );

  // ─── ZONE DETAIL ──────────────────────────────────────────────
  if (view === 'zone' && selected) return (
    <ZoneDetail t={t} zone={selected} onBack={() => { setView('dashboard'); loadAll(); }}
      onRefresh={async () => { setSelected(await envService.getZone(selected.id)); }} />
  );

  return null;
}

// ═══ ZONE FORM ═══
function ZoneForm({ t, onSave, onCancel }) {
  const [data, setData] = useState({ zone_code: '', zone_name: '', zone_type: 'Production', iso_class: '', gmp_grade: '', building: '', floor: '', area_sqm: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  return (
    <Card t={t} style={{ padding: 20 }}>
      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Input label="Zone Code" t={t} required value={data.zone_code} onChange={v => set('zone_code', v)} placeholder="CR-A-103" />
        <Input label="Zone Name" t={t} required value={data.zone_name} onChange={v => set('zone_name', v)} placeholder="Clean Room A-103" />
        <Select label="Zone Type" t={t} options={ZONE_TYPES} value={data.zone_type} onChange={v => set('zone_type', v)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <Input label="ISO Classification" t={t} value={data.iso_class} onChange={v => set('iso_class', v)} placeholder="ISO 7" />
        <Select label="GMP Grade" t={t} options={GMP_GRADES} value={data.gmp_grade} onChange={v => set('gmp_grade', v)} />
        <Input label="Building" t={t} value={data.building} onChange={v => set('building', v)} placeholder="A" />
        <Input label="Floor" t={t} value={data.floor} onChange={v => set('floor', v)} placeholder="1" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Btn t={t} variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn t={t} onClick={async () => { if (!data.zone_code || !data.zone_name) { setError('Code and name required'); return; } setSaving(true); try { await onSave(data); } catch (e) { setError(e.message); } finally { setSaving(false); } }} disabled={saving}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={14} />}Create Zone
        </Btn>
      </div>
    </Card>
  );
}

// ═══ ZONE DETAIL — sensors, readings, alerts ═══
function ZoneDetail({ t, zone: z, onBack, onRefresh }) {
  const [showSimulate, setShowSimulate] = useState(null);
  const [error, setError] = useState('');

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={onBack}><ArrowLeft size={14} />All Zones</Btn>
        <Thermometer size={18} color={t.accent} />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{z.zone_name}</span>
            <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{z.zone_code}</span>
            {z.gmp_grade && <Badge color="#5046e5" t={t}>GMP {z.gmp_grade}</Badge>}
            {z.iso_class && <Badge color="#2dceef" t={t}>{z.iso_class}</Badge>}
          </div>
          <div style={{ fontSize: 11, color: t.textMuted }}>{z.zone_type} · Building {z.building}, Floor {z.floor}</div>
        </div>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {/* Sensor Cards */}
      <Card t={t} style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Radio size={14} color={t.accent} />
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Sensors ({(z.sensors || []).length})</span>
          <Btn t={t} variant="ghost" size="sm" onClick={onRefresh}><RefreshCw size={12} />Refresh</Btn>
        </div>

        {(z.sensors || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: t.textMuted, fontSize: 11 }}>No sensors configured.</div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {(z.sensors || []).map(s => {
              const sc = STATUS_COLORS[s.status] || '#7a8ba8';
              const pc = PARAM_COLORS[s.parameter_type] || t.accent;
              const Icon = PARAM_ICONS[s.parameter_type] || Radio;
              const hasValue = s.current_value !== null && s.current_value !== undefined;
              const inSpec = s.current_in_spec !== false;

              return (
                <div key={s.id} style={{ padding: '12px 14px', background: t.bgAlt, borderRadius: 10, border: '1px solid ' + (hasValue && !inSpec ? '#f5365c30' : t.cardBorder + '40') }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <div style={{ background: pc + '15', borderRadius: 6, padding: 5 }}><Icon size={14} color={pc} /></div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 700, color: t.text }}>{s.sensor_name}</div>
                        <div style={{ fontSize: 9, color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>{s.sensor_code}</div>
                      </div>
                    </div>
                    <Badge color={sc} t={t}>{s.status}</Badge>
                  </div>

                  {/* Current reading */}
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 4, marginBottom: 4 }}>
                    <span style={{ fontSize: 22, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: hasValue ? (inSpec ? pc : '#f5365c') : t.textMuted }}>
                      {hasValue ? parseFloat(s.current_value).toFixed(1) : '—'}
                    </span>
                    <span style={{ fontSize: 11, color: t.textMuted }}>{s.unit}</span>
                  </div>

                  {/* Limits */}
                  <div style={{ fontSize: 9, color: t.textMuted, display: 'flex', gap: 8 }}>
                    <span>Limits: {s.low_limit}–{s.high_limit} {s.unit}</span>
                    {s.is_critical && <span style={{ color: '#f5365c', fontWeight: 700 }}>CRITICAL</span>}
                  </div>
                  {s.last_read && <div style={{ fontSize: 9, color: t.textMuted, marginTop: 2 }}>Last: {new Date(s.last_read).toLocaleString()}</div>}

                  {/* Simulate reading button */}
                  <div style={{ marginTop: 6 }}>
                    {showSimulate === s.id ? (
                      <SimulateForm t={t} sensor={s} onSubmit={async (val) => {
                        try { await envService.ingestReading({ sensor_id: s.id, value: val, source: 'Manual' }); setShowSimulate(null); onRefresh(); }
                        catch (e) { setError(e.message); }
                      }} onCancel={() => setShowSimulate(null)} />
                    ) : (
                      <button onClick={() => setShowSimulate(s.id)} style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, border: '1px solid ' + t.cardBorder, background: 'transparent', color: t.textMuted, cursor: 'pointer' }}>
                        Send Reading
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Zone Alerts */}
      {(z.alerts || []).length > 0 && (
        <Card t={t} style={{ padding: '14px 18px' }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
            <AlertTriangle size={14} color="#f5365c" />Alert History
          </div>
          {(z.alerts || []).map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid ' + t.cardBorder + '20', fontSize: 11 }}>
              <Badge color={a.alert_type === 'Alarm' ? '#f5365c' : '#f5a623'} t={t}>{a.alert_type}</Badge>
              <span style={{ color: t.text, fontWeight: 600 }}>{a.parameter_type}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{a.value} ({a.limit_breached}: {a.limit_value})</span>
              {a.acknowledged_by_name && <span style={{ color: '#00e5a0', fontSize: 10 }}>Ack: {a.acknowledged_by_name}</span>}
              {a.resolved_at && <Badge color="#00e5a0" t={t}>Resolved</Badge>}
              <span style={{ color: t.textMuted, marginLeft: 'auto', fontSize: 9 }}>{new Date(a.created_at).toLocaleString()}</span>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

// ═══ SIMULATE READING FORM ═══
function SimulateForm({ t, sensor, onSubmit, onCancel }) {
  const [val, setVal] = useState('');
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      <input value={val} onChange={e => setVal(e.target.value)} type="number" step="0.1" placeholder={`${sensor.low_limit}–${sensor.high_limit}`}
        style={{ width: 70, background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 4, padding: '3px 6px', fontSize: 10, outline: 'none', fontFamily: "'DM Mono',monospace" }} />
      <button onClick={() => { if (val) onSubmit(parseFloat(val)); }} disabled={!val}
        style={{ fontSize: 9, padding: '3px 8px', borderRadius: 4, border: 'none', background: val ? t.accent : t.bgAlt, color: val ? '#fff' : t.textMuted, cursor: val ? 'pointer' : 'default', fontWeight: 600 }}>Send</button>
      <button onClick={onCancel} style={{ fontSize: 9, padding: '3px 6px', borderRadius: 4, border: '1px solid ' + t.cardBorder, background: 'transparent', color: t.textMuted, cursor: 'pointer' }}>×</button>
    </div>
  );
}
