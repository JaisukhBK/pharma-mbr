// client/src/components/Genealogy/GenealogyTraceability.jsx
// Material Genealogy & Traceability — 21 CFR 211.184
// Forward trace: lot → batches | Backward trace: batch → materials
import { useState, useEffect, useCallback } from 'react';
import {
  GitBranch, Plus, Search, Package, AlertTriangle, CheckCircle, Clock,
  Loader2, ArrowLeft, ArrowRight, Shield, Calendar, MapPin, Hash,
  ChevronDown, X, Save, Eye, Layers, Activity, XCircle, RefreshCw
} from 'lucide-react';
import { genealogyService } from '../../services/apiService';
import { Badge, Card, Btn, Input, Select, SumCard, Label, ErrBox } from '../ui/PharmUI';

const MAT_TYPES = ['API','Excipient','Raw Material','Packaging','Solvent','Intermediate','Finished Good'];
const LOT_STATUSES = ['Quarantine','Released','Rejected','Expired','Consumed','Returned'];
const LOT_COLORS = { Quarantine:'#f5a623', Released:'#00e5a0', Rejected:'#f5365c', Expired:'#7a8ba8', Consumed:'#2dceef', Returned:'#5046e5' };
const TXN_COLORS = { Receive:'#00e5a0', Dispense:'#2dceef', Consume:'#f5a623', Return:'#5046e5', Adjust:'#7a8ba8', Dispose:'#f5365c', Sample:'#2dceef' };

export default function GenealogyTraceability({ theme }) {
  const t = theme;
  const [view, setView] = useState('list'); // list | detail | create | trace
  const [materials, setMaterials] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState('');
  const [traceMode, setTraceMode] = useState('forward'); // forward | backward
  const [traceResult, setTraceResult] = useState(null);
  const [traceQuery, setTraceQuery] = useState('');

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [listR, statsR] = await Promise.all([
        genealogyService.listMaterials({ search: search || undefined, material_type: filterType || undefined }),
        genealogyService.getStats(),
      ]);
      setMaterials(listR.data || []);
      setStats(statsR);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [search, filterType]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openDetail = async (id) => {
    try { const m = await genealogyService.getMaterial(id); setSelected(m); setView('detail'); } catch (e) { setError(e.message); }
  };

  // ─── TRACE ─────────────────────────────────────────────────────
  const runTrace = async () => {
    if (!traceQuery.trim()) return;
    setLoading(true); setTraceResult(null); setError('');
    try {
      if (traceMode === 'forward') {
        // Look up lot by number via API, then run forward trace
        const lot = await genealogyService.lookupLot(traceQuery.trim());
        setTraceResult(await genealogyService.forwardTrace(lot.id));
      } else {
        setTraceResult(await genealogyService.backwardTrace(traceQuery.trim()));
      }
    } catch (e) {
      if (e.message.includes('404') || e.message.includes('not found') || e.message.includes('Lot not found')) {
        setError(traceMode === 'forward' ? 'Lot number not found. Check the exact lot number and try again.' : 'No trace data found for this batch number.');
      } else {
        setError(e.message);
      }
    }
    finally { setLoading(false); }
  };

  // ─── LIST VIEW ────────────────────────────────────────────────
  if (view === 'list') return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: 0 }}>Genealogy & Traceability</h2>
          <p style={{ fontSize: 12, color: t.textMuted, margin: '4px 0 0' }}>Material master, lot tracking, forward/backward trace — 21 CFR 211.184</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Btn t={t} variant="accent" onClick={() => setView('trace')}><GitBranch size={14} />Run Trace</Btn>
          <Btn t={t} onClick={() => setView('create')}><Plus size={14} />Register Material</Btn>
        </div>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <SumCard label="Total materials" val={stats.total_materials} sub={stats.by_type?.map(b => `${b.cnt} ${b.material_type}`).join(', ') || ''} color={t.accent} t={t} />
          <SumCard label="Low stock" val={stats.low_stock} sub="Below minimum level" color={stats.low_stock > 0 ? '#f5365c' : '#00e5a0'} t={t} />
          <SumCard label="Expiring (90d)" val={stats.expiring_90d} sub="Released lots expiring soon" color={stats.expiring_90d > 0 ? '#f5a623' : '#00e5a0'} t={t} />
          <SumCard label="In quarantine" val={stats.in_quarantine} sub="Awaiting QC release" color={stats.in_quarantine > 0 ? '#f5a623' : '#00e5a0'} t={t} />
        </div>
      )}

      <Card t={t} style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color={t.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by code or name..."
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 32, background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px 9px 32px', fontSize: 13, outline: 'none' }} />
          </div>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 12, outline: 'none' }}>
            <option value="">All types</option>
            {MAT_TYPES.map(t2 => <option key={t2} value={t2}>{t2}</option>)}
          </select>
        </div>
      </Card>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={22} color={t.accent} style={{ animation: 'spin 1s linear infinite' }} /></div>
      ) : materials.length === 0 ? (
        <Card t={t} style={{ textAlign: 'center', padding: '40px 0' }}>
          <Package size={28} color={t.textMuted} style={{ marginBottom: 8 }} />
          <p style={{ color: t.textMuted, fontSize: 13, fontWeight: 600 }}>No materials registered</p>
          <p style={{ color: t.textMuted, fontSize: 11 }}>Register raw materials, APIs, and excipients to start tracking</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {materials.map(m => (
            <Card t={t} key={m.id} style={{ padding: '12px 16px', cursor: 'pointer', transition: 'border-color 0.15s' }} onClick={() => openDetail(m.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ background: m.material_type === 'API' ? '#f5365c15' : t.accent + '15', borderRadius: 8, padding: 8 }}>
                    <Package size={16} color={m.material_type === 'API' ? '#f5365c' : t.accent} />
                  </div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{m.material_name}</span>
                      <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{m.material_code}</span>
                      <Badge color={m.material_type === 'API' ? '#f5365c' : '#2dceef'} t={t}>{m.material_type}</Badge>
                      {m.is_controlled && <Badge color="#f5365c" t={t}>Controlled</Badge>}
                    </div>
                    <div style={{ display: 'flex', gap: 16, fontSize: 10, color: t.textMuted }}>
                      {m.supplier && <span>{m.supplier}</span>}
                      {m.grade && <span>Grade: {m.grade}</span>}
                      <span>{m.lot_count || 0} lots</span>
                      <span>Stock: {parseFloat(m.stock_available || 0).toFixed(2)} {m.unit}</span>
                    </div>
                  </div>
                </div>
                <ChevronDown size={14} color={t.textMuted} style={{ transform: 'rotate(-90deg)' }} />
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );

  // ─── CREATE VIEW ──────────────────────────────────────────────
  if (view === 'create') return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={() => setView('list')}><ArrowLeft size={14} />Back</Btn>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: t.text, margin: 0 }}>Register New Material</h2>
      </div>
      <MaterialForm t={t} onSave={async (data) => { await genealogyService.createMaterial(data); setView('list'); loadAll(); }} onCancel={() => setView('list')} />
    </div>
  );

  // ─── TRACE VIEW ───────────────────────────────────────────────
  if (view === 'trace') return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={() => { setView('list'); setTraceResult(null); }}><ArrowLeft size={14} />Back</Btn>
        <GitBranch size={18} color={t.accent} />
        <h2 style={{ fontSize: 18, fontWeight: 800, color: t.text, margin: 0 }}>Traceability</h2>
      </div>

      <Card t={t} style={{ padding: 16, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {['forward', 'backward'].map(m => (
            <button key={m} onClick={() => { setTraceMode(m); setTraceResult(null); setTraceQuery(''); }}
              style={{ padding: '8px 18px', borderRadius: 8, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700,
                background: traceMode === m ? t.accent + '15' : 'transparent', color: traceMode === m ? t.accent : t.textMuted }}>
              {m === 'forward' ? '→ Forward Trace (Lot → Batches)' : '← Backward Trace (Batch → Materials)'}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input value={traceQuery} onChange={e => setTraceQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && runTrace()}
            placeholder={traceMode === 'forward' ? 'Enter lot number (e.g. LOT-2026-001)' : 'Enter batch number (e.g. BN-2026-001)'}
            style={{ flex: 1, background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
          <Btn t={t} onClick={runTrace} disabled={!traceQuery.trim() || loading}>
            {loading ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Search size={14} />}
            Trace
          </Btn>
        </div>
      </Card>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {traceResult && traceMode === 'forward' && traceResult.lot && (
        <Card t={t} style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Package size={14} color={t.accent} />
            <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>Forward Trace: {traceResult.lot.material_name}</span>
            <Badge color="#2dceef" t={t}>Lot: {traceResult.lot.lot_number}</Badge>
            <span style={{ fontSize: 11, color: t.textMuted, marginLeft: 'auto' }}>{traceResult.total_batches} batch(es) affected</span>
          </div>
          {traceResult.affected_batches.length === 0 && traceResult.genealogy_records.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: t.textMuted, fontSize: 11 }}>No batches found using this lot.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {traceResult.affected_batches.map((b, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: t.bgAlt, borderRadius: 8 }}>
                  <Activity size={12} color={t.accent} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{b.batch_number}</span>
                  <span style={{ fontSize: 11, color: t.textMuted }}>{b.product_name}</span>
                  {b.batch_status && <Badge color={b.batch_status === 'Released' ? '#00e5a0' : '#f5a623'} t={t}>{b.batch_status}</Badge>}
                  <span style={{ fontSize: 10, color: t.textMuted, marginLeft: 'auto' }}>{b.quantity} {b.unit}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {traceResult && traceMode === 'backward' && (
        <Card t={t} style={{ padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <Activity size={14} color={t.accent} />
            <span style={{ fontSize: 14, fontWeight: 700, color: t.text }}>Backward Trace: Batch {traceResult.batch_number}</span>
            <span style={{ fontSize: 11, color: t.textMuted, marginLeft: 'auto' }}>{traceResult.total_materials} material(s), {traceResult.total_lots} lot(s)</span>
          </div>
          {traceResult.materials.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: t.textMuted, fontSize: 11 }}>No materials traced for this batch.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {traceResult.materials.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: t.bgAlt, borderRadius: 8 }}>
                  <Package size={12} color={m.material_type === 'API' ? '#f5365c' : t.accent} />
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{m.material_name}</span>
                  <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{m.material_code}</span>
                  <Badge color={LOT_COLORS[m.lot_status] || '#7a8ba8'} t={t}>Lot: {m.lot_number}</Badge>
                  {m.expiry_date && <span style={{ fontSize: 10, color: new Date(m.expiry_date) < new Date() ? '#f5365c' : t.textMuted }}>Exp: {new Date(m.expiry_date).toLocaleDateString()}</span>}
                  <span style={{ fontSize: 10, color: t.textMuted, marginLeft: 'auto' }}>{m.quantity} {m.unit}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}
    </div>
  );

  // ─── DETAIL VIEW ──────────────────────────────────────────────
  if (view === 'detail' && selected) return (
    <MaterialDetail t={t} material={selected} onBack={() => { setView('list'); loadAll(); }}
      onRefresh={async () => { const m = await genealogyService.getMaterial(selected.id); setSelected(m); }} />
  );

  return null;
}

// ═══ MATERIAL FORM ═══
function MaterialForm({ t, initial, onSave, onCancel }) {
  const [data, setData] = useState({ material_code: '', material_name: '', material_type: 'Raw Material', cas_number: '', grade: '', supplier: '', supplier_code: '', unit: 'kg', retest_interval_days: '', shelf_life_months: '', storage_conditions: '', min_stock: '', is_controlled: false, ...(initial || {}) });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  return (
    <Card t={t} style={{ padding: 20 }}>
      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Input label="Material Code" t={t} required value={data.material_code} onChange={v => set('material_code', v)} placeholder="MAT-API-001" />
        <Input label="Material Name" t={t} required value={data.material_name} onChange={v => set('material_name', v)} placeholder="Metformin HCl" />
        <Select label="Type" t={t} options={MAT_TYPES} value={data.material_type} onChange={v => set('material_type', v)} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Input label="CAS Number" t={t} value={data.cas_number} onChange={v => set('cas_number', v)} placeholder="657-24-9" />
        <Input label="Grade" t={t} value={data.grade} onChange={v => set('grade', v)} placeholder="USP/NF, Ph.Eur." />
        <Input label="Supplier" t={t} value={data.supplier} onChange={v => set('supplier', v)} placeholder="Supplier name" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
        <Input label="Unit" t={t} value={data.unit} onChange={v => set('unit', v)} placeholder="kg" />
        <Input label="Shelf Life (months)" t={t} type="number" value={data.shelf_life_months} onChange={v => set('shelf_life_months', v)} />
        <Input label="Retest Interval (days)" t={t} type="number" value={data.retest_interval_days} onChange={v => set('retest_interval_days', v)} />
        <Input label="Min Stock" t={t} type="number" value={data.min_stock} onChange={v => set('min_stock', v)} />
      </div>
      <Input label="Storage Conditions" t={t} value={data.storage_conditions} onChange={v => set('storage_conditions', v)} placeholder="Store at 2-8°C, protect from light" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        <input type="checkbox" checked={data.is_controlled} onChange={e => set('is_controlled', e.target.checked)} id="controlled" />
        <label htmlFor="controlled" style={{ fontSize: 12, fontWeight: 600, color: t.text, cursor: 'pointer' }}>Controlled Substance</label>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
        <Btn t={t} variant="ghost" onClick={onCancel}>Cancel</Btn>
        <Btn t={t} onClick={async () => { if (!data.material_code || !data.material_name) { setError('Code and name required'); return; } setSaving(true); try { await onSave(data); } catch (e) { setError(e.message); } finally { setSaving(false); } }} disabled={saving}>
          {saving ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Save size={14} />}Register
        </Btn>
      </div>
    </Card>
  );
}

// ═══ MATERIAL DETAIL ═══
function MaterialDetail({ t, material: m, onBack, onRefresh }) {
  const [showLotForm, setShowLotForm] = useState(false);
  const [error, setError] = useState('');

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={onBack}><ArrowLeft size={14} />All Materials</Btn>
        <Package size={18} color={m.material_type === 'API' ? '#f5365c' : t.accent} />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{m.material_name}</span>
            <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{m.material_code}</span>
            <Badge color={m.material_type === 'API' ? '#f5365c' : '#2dceef'} t={t}>{m.material_type}</Badge>
          </div>
          <div style={{ fontSize: 11, color: t.textMuted }}>{m.supplier} · {m.grade || '—'} · CAS: {m.cas_number || '—'}</div>
        </div>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {/* Lots */}
      <Card t={t} style={{ padding: '14px 18px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Layers size={14} color={t.accent} />
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Lots ({(m.lots || []).length})</span>
          </div>
          <Btn t={t} variant="accent" size="sm" onClick={() => setShowLotForm(!showLotForm)}><Plus size={12} />Receive Lot</Btn>
        </div>

        {showLotForm && <LotForm t={t} materialId={m.id} unit={m.unit} onSubmit={async (data) => {
          try { await genealogyService.createLot(m.id, data); setShowLotForm(false); onRefresh(); } catch (e) { setError(e.message); }
        }} onCancel={() => setShowLotForm(false)} />}

        {(m.lots || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: t.textMuted, fontSize: 11 }}>No lots received yet.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {(m.lots || []).map(lot => {
              const lc = LOT_COLORS[lot.status] || '#7a8ba8';
              const isExpired = lot.expiry_date && new Date(lot.expiry_date) < new Date();
              return (
                <div key={lot.id} style={{ padding: '10px 14px', background: t.bgAlt, borderRadius: 8, border: '1px solid ' + t.cardBorder + '40' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: t.text }}>{lot.lot_number}</span>
                    {lot.supplier_lot && <span style={{ fontSize: 10, color: t.textMuted }}>Supplier: {lot.supplier_lot}</span>}
                    <Badge color={lc} t={t}>{lot.status}</Badge>
                    {lot.coa_status && <Badge color={lot.coa_status === 'Approved' ? '#00e5a0' : '#f5a623'} t={t}>CoA: {lot.coa_status}</Badge>}
                    {isExpired && <Badge color="#f5365c" t={t}>EXPIRED</Badge>}
                    <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                      {lot.status === 'Quarantine' && <>
                        <Btn t={t} size="sm" variant="accent" onClick={async () => { try { await genealogyService.updateLotStatus(lot.id, 'Released'); onRefresh(); } catch (e) { setError(e.message); } }}><CheckCircle size={10} />Release</Btn>
                        <Btn t={t} size="sm" variant="danger" onClick={async () => { try { await genealogyService.updateLotStatus(lot.id, 'Rejected'); onRefresh(); } catch (e) { setError(e.message); } }}><XCircle size={10} />Reject</Btn>
                      </>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 10, color: t.textMuted }}>
                    <span>Qty: {lot.quantity_available}/{lot.quantity_received} {lot.unit}</span>
                    <span>Received: {new Date(lot.received_date).toLocaleDateString()}</span>
                    {lot.expiry_date && <span style={{ color: isExpired ? '#f5365c' : t.textMuted }}>Exp: {new Date(lot.expiry_date).toLocaleDateString()}</span>}
                    {lot.warehouse_location && <span><MapPin size={9} /> {lot.warehouse_location}</span>}
                    {lot.coa_reference && <span>CoA: {lot.coa_reference}</span>}
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

// ═══ LOT FORM ═══
function LotForm({ t, materialId, unit, onSubmit, onCancel }) {
  const today = new Date().toISOString().split('T')[0];
  const [data, setData] = useState({ lot_number: '', supplier_lot: '', quantity_received: '', unit: unit || 'kg', received_date: today, manufacture_date: '', expiry_date: '', retest_date: '', coa_reference: '', warehouse_location: '', notes: '' });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  return (
    <Card t={t} style={{ marginBottom: 12, padding: 14, borderLeft: '3px solid ' + t.accent, background: t.bgAlt }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 10 }}>Receive New Lot</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Input label="Lot Number" t={t} required value={data.lot_number} onChange={v => set('lot_number', v)} placeholder="LOT-2026-001" size="sm" />
        <Input label="Quantity" t={t} required type="number" value={data.quantity_received} onChange={v => set('quantity_received', v)} unit={data.unit} size="sm" />
        <Input label="Received Date" t={t} required type="date" value={data.received_date} onChange={v => set('received_date', v)} size="sm" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Input label="Supplier Lot" t={t} value={data.supplier_lot} onChange={v => set('supplier_lot', v)} size="sm" />
        <Input label="Manufacture Date" t={t} type="date" value={data.manufacture_date} onChange={v => set('manufacture_date', v)} size="sm" />
        <Input label="Expiry Date" t={t} type="date" value={data.expiry_date} onChange={v => set('expiry_date', v)} size="sm" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Input label="CoA Reference" t={t} value={data.coa_reference} onChange={v => set('coa_reference', v)} placeholder="COA-2026-001" size="sm" />
        <Input label="Warehouse Location" t={t} value={data.warehouse_location} onChange={v => set('warehouse_location', v)} placeholder="WH-A, Shelf 3" size="sm" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <Btn t={t} variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn t={t} size="sm" onClick={async () => { setBusy(true); await onSubmit(data); setBusy(false); }} disabled={busy || !data.lot_number || !data.quantity_received}>
          {busy ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <CheckCircle size={12} />}Receive
        </Btn>
      </div>
    </Card>
  );
}
