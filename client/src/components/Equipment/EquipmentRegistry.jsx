// client/src/components/Equipment/EquipmentRegistry.jsx
// Equipment Management — Registry, Calibration, Qualification (IQ/OQ/PQ)
// 21 CFR Part 11 | EU Annex 15 | GAMP5
import { useState, useEffect, useCallback } from 'react';
import {
  Settings2, Plus, Search, Filter, ChevronDown, ChevronUp, AlertTriangle,
  CheckCircle, Clock, XCircle, Loader2, ArrowLeft, Shield, Thermometer,
  MapPin, Hash, Calendar, FileText, Activity, Wrench, X, Save, Edit3, Eye
} from 'lucide-react';
import { equipmentService } from '../../services/apiService';
import { Badge, Card, Btn, Input, Select, SumCard, Label, ErrBox } from '../ui/PharmUI';

const STATUS_COLORS = { Available:'#00e5a0', 'In Use':'#2dceef', 'Under Qualification':'#f5a623', 'Out of Service':'#f5365c', Maintenance:'#f5a623', Retired:'#7a8ba8' };
const QUAL_COLORS = { 'Not Qualified':'#7a8ba8', IQ:'#f5a623', OQ:'#2dceef', PQ:'#5046e5', Qualified:'#00e5a0', Requalification:'#f5a623', Retired:'#7a8ba8' };
const EQUIP_TYPES = ['Reactor','Granulator','Tablet Press','Coater','Blender','FBD','Mill','Autoclave','Homogenizer','Balance','HPLC','Dissolution','Mixer','Dryer','Filter','Pump','Other'];
const AREAS = ['Production','QC Lab','Warehouse','Utilities','Packaging','Dispensing','Clean Room','Pilot Plant'];
const QUAL_STATUSES = ['Not Qualified','IQ','OQ','PQ','Qualified','Requalification','Retired'];
const CAL_RESULTS = ['Pass','Fail','Adjusted','Out of Tolerance'];

export default function EquipmentRegistry({ theme }) {
  const t = theme;
  const [view, setView] = useState('list'); // 'list' | 'detail' | 'create'
  const [equipment, setEquipment] = useState([]);
  const [stats, setStats] = useState(null);
  const [overdue, setOverdue] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType] = useState('');

  // ─── DATA LOADING ─────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [listR, statsR, overdueR] = await Promise.all([
        equipmentService.list({ search: search || undefined, status: filterStatus || undefined, equipment_type: filterType || undefined }),
        equipmentService.getStats(),
        equipmentService.getOverdueCalibrations(),
      ]);
      setEquipment(listR.data || []);
      setStats(statsR);
      setOverdue(overdueR.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, filterStatus, filterType]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openDetail = async (id) => {
    try {
      const eq = await equipmentService.get(id);
      setSelected(eq);
      setView('detail');
    } catch (e) { setError(e.message); }
  };

  // ─── LIST VIEW ────────────────────────────────────────────────
  if (view === 'list') return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: 0 }}>Equipment Registry</h2>
          <p style={{ fontSize: 12, color: t.textMuted, margin: '4px 0 0' }}>Qualification, calibration, and maintenance tracking</p>
        </div>
        <Btn t={t} onClick={() => setView('create')}><Plus size={14} />Register Equipment</Btn>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {/* Stats Cards */}
      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <SumCard label="Total equipment" val={stats.total} sub={`${stats.gmp_critical} GMP critical`} color={t.accent} t={t} />
          <SumCard label="Available" val={stats.by_status?.find(s => s.status === 'Available')?.cnt || 0} sub="Ready for use" color="#00e5a0" t={t} />
          <SumCard label="Calibration overdue" val={stats.calibration_overdue} sub={`${stats.calibration_due_30d} due in 30 days`} color={stats.calibration_overdue > 0 ? '#f5365c' : '#00e5a0'} t={t} />
          <SumCard label="Under qualification" val={stats.by_status?.find(s => s.status === 'Under Qualification')?.cnt || 0} sub="IQ/OQ/PQ in progress" color="#f5a623" t={t} />
        </div>
      )}

      {/* Overdue Calibrations Alert */}
      {overdue.length > 0 && (
        <Card t={t} style={{ marginBottom: 16, padding: '12px 16px', borderLeft: '3px solid #f5365c' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <AlertTriangle size={14} color="#f5365c" />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#f5365c' }}>Calibration overdue ({overdue.length})</span>
            <span style={{ fontSize: 11, color: t.textMuted }}>— equipment locked from production use until recalibrated</span>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {overdue.slice(0, 5).map(eq => (
              <button key={eq.id} onClick={() => openDetail(eq.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: '1px solid #f5365c30', background: '#f5365c08', color: '#f5365c', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                <Thermometer size={10} />{eq.equipment_code}
                <span style={{ color: t.textMuted, fontWeight: 400 }}>due {new Date(eq.calibration_due).toLocaleDateString()}</span>
              </button>
            ))}
            {overdue.length > 5 && <span style={{ fontSize: 11, color: t.textMuted, alignSelf: 'center' }}>+{overdue.length - 5} more</span>}
          </div>
        </Card>
      )}

      {/* Search and Filters */}
      <Card t={t} style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color={t.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code or name..."
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 32, background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px 9px 32px', fontSize: 13, outline: 'none' }} />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 12, outline: 'none' }}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 12, outline: 'none' }}>
            <option value="">All types</option>
            {EQUIP_TYPES.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
          </select>
        </div>
      </Card>

      {/* Equipment List */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={22} color={t.accent} style={{ animation: 'spin 1s linear infinite' }} /></div>
      ) : equipment.length === 0 ? (
        <Card t={t} style={{ textAlign: 'center', padding: '40px 0' }}>
          <Settings2 size={28} color={t.textMuted} style={{ marginBottom: 8 }} />
          <p style={{ color: t.textMuted, fontSize: 13, fontWeight: 600 }}>No equipment registered</p>
          <p style={{ color: t.textMuted, fontSize: 11 }}>Register your first piece of equipment to start tracking</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {equipment.map(eq => {
            const sc = STATUS_COLORS[eq.status] || '#7a8ba8';
            const qc = QUAL_COLORS[eq.qualification_status] || '#7a8ba8';
            const isOverdue = eq.calibration_due && new Date(eq.calibration_due) < new Date();
            return (
              <Card t={t} key={eq.id} style={{ padding: '12px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }}
                onClick={() => openDetail(eq.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: sc + '15', borderRadius: 8, padding: 8, display: 'flex' }}>
                      <Settings2 size={16} color={sc} />
                    </div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{eq.equipment_name}</span>
                        <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{eq.equipment_code}</span>
                        <Badge color={sc} t={t}>{eq.status}</Badge>
                        <Badge color={qc} t={t}>{eq.qualification_status}</Badge>
                        {eq.gmp_critical && <Badge color="#f5365c" t={t}>GMP Critical</Badge>}
                        {isOverdue && <Badge color="#f5365c" t={t}>CAL OVERDUE</Badge>}
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: t.textMuted }}>
                        <span>{eq.equipment_type}</span>
                        {eq.location && <span><MapPin size={9} style={{ marginRight: 2 }} />{eq.location}</span>}
                        {eq.area && <span>{eq.area}</span>}
                        {eq.calibration_due && <span><Calendar size={9} style={{ marginRight: 2 }} />Cal due: {new Date(eq.calibration_due).toLocaleDateString()}</span>}
                        <span>{eq.calibration_count || 0} calibrations</span>
                      </div>
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

  // ─── CREATE VIEW ──────────────────────────────────────────────
  if (view === 'create') return <EquipmentForm t={t} onSave={async (data) => {
    await equipmentService.create(data);
    setView('list'); loadAll();
  }} onCancel={() => setView('list')} />;

  // ─── DETAIL VIEW ──────────────────────────────────────────────
  if (view === 'detail' && selected) return (
    <EquipmentDetail t={t} equipment={selected} onBack={() => { setView('list'); loadAll(); }}
      onUpdate={async (data) => {
        await equipmentService.update(selected.id, data);
        const fresh = await equipmentService.get(selected.id);
        setSelected(fresh);
      }}
      onCalibrate={async (data) => {
        await equipmentService.recordCalibration(selected.id, data);
        const fresh = await equipmentService.get(selected.id);
        setSelected(fresh);
      }}
      onQualify={async (status, notes) => {
        await equipmentService.updateQualification(selected.id, status, notes);
        const fresh = await equipmentService.get(selected.id);
        setSelected(fresh);
      }}
    />
  );

  return null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUIPMENT FORM — Create / Edit
// ═══════════════════════════════════════════════════════════════════════════

function EquipmentForm({ t, initial, onSave, onCancel }) {
  const [data, setData] = useState({
    equipment_code: '', equipment_name: '', equipment_type: 'Reactor',
    manufacturer: '', model: '', serial_number: '',
    location: '', area: 'Production',
    calibration_interval_days: 365, gmp_critical: false,
    ...(initial || {}),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  const handleSave = async () => {
    if (!data.equipment_code || !data.equipment_name) { setError('Equipment code and name are required'); return; }
    setSaving(true); setError('');
    try { await onSave(data); } catch (e) { setError(e.message); } finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={onCancel}><ArrowLeft size={14} />Back</Btn>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: t.text, margin: 0 }}>{initial ? 'Edit Equipment' : 'Register New Equipment'}</h2>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      <Card t={t} style={{ padding: 20 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Input label="Equipment Code" t={t} required value={data.equipment_code} onChange={v => set('equipment_code', v)} placeholder="EQ-BLEND-001" />
          <Input label="Equipment Name" t={t} required value={data.equipment_name} onChange={v => set('equipment_name', v)} placeholder="V-Blender 100L" />
          <Select label="Equipment Type" t={t} options={EQUIP_TYPES} value={data.equipment_type} onChange={v => set('equipment_type', v)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Input label="Manufacturer" t={t} value={data.manufacturer} onChange={v => set('manufacturer', v)} placeholder="GEA, IMA, Bosch..." />
          <Input label="Model" t={t} value={data.model} onChange={v => set('model', v)} placeholder="Model number" />
          <Input label="Serial Number" t={t} value={data.serial_number} onChange={v => set('serial_number', v)} placeholder="SN-12345" />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          <Input label="Location" t={t} value={data.location} onChange={v => set('location', v)} placeholder="Building A, Room 201" />
          <Select label="Area" t={t} options={AREAS} value={data.area} onChange={v => set('area', v)} />
          <Input label="Calibration Interval (days)" t={t} type="number" value={data.calibration_interval_days} onChange={v => set('calibration_interval_days', parseInt(v) || 365)} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
          <input type="checkbox" checked={data.gmp_critical} onChange={e => set('gmp_critical', e.target.checked)} id="gmp-critical" />
          <label htmlFor="gmp-critical" style={{ fontSize: 12, fontWeight: 600, color: t.text, cursor: 'pointer' }}>GMP Critical Equipment</label>
          <span style={{ fontSize: 10, color: t.textMuted }}>(requires qualification before production use)</span>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <Btn t={t} variant="ghost" onClick={onCancel}>Cancel</Btn>
          <Btn t={t} onClick={handleSave} disabled={saving}>{saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}{saving ? 'Saving...' : 'Register Equipment'}</Btn>
        </div>
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EQUIPMENT DETAIL — Full view with calibration and qualification
// ═══════════════════════════════════════════════════════════════════════════

function EquipmentDetail({ t, equipment: eq, onBack, onUpdate, onCalibrate, onQualify }) {
  const [showCalForm, setShowCalForm] = useState(false);
  const [showQualForm, setShowQualForm] = useState(false);
  const [error, setError] = useState('');

  const sc = STATUS_COLORS[eq.status] || '#7a8ba8';
  const qc = QUAL_COLORS[eq.qualification_status] || '#7a8ba8';
  const isOverdue = eq.calibration_due && new Date(eq.calibration_due) < new Date();

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={onBack}><ArrowLeft size={14} />All Equipment</Btn>
        <div style={{ background: sc + '15', borderRadius: 8, padding: 8 }}><Settings2 size={18} color={sc} /></div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{eq.equipment_name}</span>
            <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{eq.equipment_code}</span>
            <Badge color={sc} t={t}>{eq.status}</Badge>
            <Badge color={qc} t={t}>{eq.qualification_status}</Badge>
            {eq.gmp_critical && <Badge color="#f5365c" t={t}>GMP Critical</Badge>}
            {isOverdue && <Badge color="#f5365c" t={t}>CALIBRATION OVERDUE</Badge>}
          </div>
          <div style={{ fontSize: 11, color: t.textMuted, marginTop: 2 }}>
            {eq.equipment_type} · {eq.manufacturer} {eq.model} · SN: {eq.serial_number || '—'} · {eq.location} ({eq.area})
          </div>
        </div>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {/* Info Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <SumCard label="Status" val={eq.status} sub={eq.clean_status || 'Not tracked'} color={sc} t={t} />
        <SumCard label="Qualification" val={eq.qualification_status} sub="IQ → OQ → PQ → Qualified" color={qc} t={t} />
        <SumCard label="Last calibration" val={eq.last_calibration ? new Date(eq.last_calibration).toLocaleDateString() : '—'} sub={eq.calibration_due ? 'Due: ' + new Date(eq.calibration_due).toLocaleDateString() : 'No schedule'} color={isOverdue ? '#f5365c' : '#00e5a0'} t={t} />
        <SumCard label="Calibrations" val={(eq.calibrations || []).length} sub={`Interval: ${eq.calibration_interval_days || 365} days`} color={t.accent} t={t} />
      </div>

      {/* Qualification Panel */}
      <Card t={t} style={{ marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Shield size={14} color={t.accent} />
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Qualification status (IQ/OQ/PQ)</span>
            <span style={{ fontSize: 10, color: t.textMuted }}>EU Annex 15 · GAMP5</span>
          </div>
          <Btn t={t} variant="accent" size="sm" onClick={() => setShowQualForm(!showQualForm)}><Shield size={12} />Update Qualification</Btn>
        </div>

        {/* Qualification pipeline */}
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          {QUAL_STATUSES.filter(s => s !== 'Retired').map((qs, i) => {
            const isCurrent = eq.qualification_status === qs;
            const isPast = QUAL_STATUSES.indexOf(eq.qualification_status) > QUAL_STATUSES.indexOf(qs);
            const color = isPast ? '#00e5a0' : isCurrent ? QUAL_COLORS[qs] : t.cardBorder;
            return (
              <div key={qs} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
                <div style={{ flex: 1, padding: '6px 10px', borderRadius: 6, border: '1px solid ' + color, background: (isPast || isCurrent) ? color + '08' : 'transparent', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: isPast ? '#00e5a0' : isCurrent ? QUAL_COLORS[qs] : t.textMuted }}>
                    {isPast ? <CheckCircle size={10} style={{ marginRight: 3 }} /> : null}{qs}
                  </div>
                </div>
                {i < QUAL_STATUSES.length - 2 && <span style={{ color: t.textMuted, fontSize: 10 }}>→</span>}
              </div>
            );
          })}
        </div>

        {showQualForm && <QualificationForm t={t} current={eq.qualification_status} onSubmit={async (status, notes) => {
          try { await onQualify(status, notes); setShowQualForm(false); } catch (e) { setError(e.message); }
        }} onCancel={() => setShowQualForm(false)} />}
      </Card>

      {/* Calibration Panel */}
      <Card t={t} style={{ marginBottom: 16, padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Thermometer size={14} color={isOverdue ? '#f5365c' : t.accent} />
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Calibration history</span>
            {isOverdue && <Badge color="#f5365c" t={t}>OVERDUE</Badge>}
          </div>
          <Btn t={t} variant="accent" size="sm" onClick={() => setShowCalForm(!showCalForm)}><Plus size={12} />Record Calibration</Btn>
        </div>

        {showCalForm && <CalibrationForm t={t} onSubmit={async (data) => {
          try { await onCalibrate(data); setShowCalForm(false); } catch (e) { setError(e.message); }
        }} onCancel={() => setShowCalForm(false)} />}

        {/* Calibration history timeline */}
        {(eq.calibrations || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: t.textMuted, fontSize: 11 }}>No calibrations recorded yet.</div>
        ) : (
          <div style={{ maxHeight: 300, overflowY: 'auto' }}>
            {(eq.calibrations || []).map((cal, i) => {
              const passed = cal.result === 'Pass';
              return (
                <div key={cal.id} style={{ display: 'flex', gap: 10, marginBottom: 4 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16, flexShrink: 0 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: passed ? '#00e5a0' : '#f5365c', border: '2px solid ' + t.card, flexShrink: 0, marginTop: 6 }} />
                    {i < eq.calibrations.length - 1 && <div style={{ width: 1, flex: 1, background: t.cardBorder, marginTop: 2 }} />}
                  </div>
                  <div style={{ flex: 1, paddingBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <Badge color={passed ? '#00e5a0' : '#f5365c'} t={t}>{cal.result}</Badge>
                      <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>
                        {new Date(cal.calibration_date).toLocaleDateString()} → Next: {new Date(cal.next_due).toLocaleDateString()}
                      </span>
                    </div>
                    {cal.certificate_ref && <div style={{ fontSize: 10, color: t.textDim, marginTop: 2 }}>Certificate: {cal.certificate_ref}</div>}
                    {cal.performed_by && <div style={{ fontSize: 10, color: t.textMuted, marginTop: 1 }}>By: {cal.performed_by}</div>}
                    {cal.notes && <div style={{ fontSize: 10, color: t.textMuted, marginTop: 1 }}>{cal.notes}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// CALIBRATION FORM
// ═══════════════════════════════════════════════════════════════════════════

function CalibrationForm({ t, onSubmit, onCancel }) {
  const today = new Date().toISOString().split('T')[0];
  const [data, setData] = useState({ calibration_date: today, next_due: '', performed_by: '', certificate_ref: '', result: 'Pass', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  return (
    <Card t={t} style={{ marginBottom: 12, padding: 14, borderLeft: '3px solid ' + t.accent, background: t.bgAlt }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 10 }}>Record Calibration</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Input label="Calibration Date" t={t} type="date" required value={data.calibration_date} onChange={v => set('calibration_date', v)} size="sm" />
        <Input label="Next Due Date" t={t} type="date" required value={data.next_due} onChange={v => set('next_due', v)} size="sm" />
        <Select label="Result" t={t} options={CAL_RESULTS} value={data.result} onChange={v => set('result', v)} size="sm" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Input label="Performed By" t={t} value={data.performed_by} onChange={v => set('performed_by', v)} placeholder="Technician name" size="sm" />
        <Input label="Certificate Ref" t={t} value={data.certificate_ref} onChange={v => set('certificate_ref', v)} placeholder="CAL-2026-0001" size="sm" />
      </div>
      <Input label="Notes" t={t} value={data.notes} onChange={v => set('notes', v)} placeholder="Any observations..." size="sm" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <Btn t={t} variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn t={t} size="sm" onClick={async () => { setBusy(true); await onSubmit(data); setBusy(false); }} disabled={busy || !data.calibration_date || !data.next_due}>
          {busy ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={12} />}Record
        </Btn>
      </div>
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// QUALIFICATION FORM
// ═══════════════════════════════════════════════════════════════════════════

function QualificationForm({ t, current, onSubmit, onCancel }) {
  const [status, setStatus] = useState(current);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Card t={t} style={{ marginTop: 12, padding: 14, borderLeft: '3px solid ' + t.accent, background: t.bgAlt }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 10 }}>Update Qualification Status</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Select label="New Status" t={t} options={QUAL_STATUSES} value={status} onChange={v => setStatus(v)} size="sm" />
        <Input label="Notes" t={t} value={notes} onChange={v => setNotes(v)} placeholder="Protocol reference, observations..." size="sm" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <Btn t={t} variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn t={t} size="sm" onClick={async () => { setBusy(true); await onSubmit(status, notes); setBusy(false); }} disabled={busy || status === current}>
          {busy ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Shield size={12} />}Update
        </Btn>
      </div>
    </Card>
  );
}
