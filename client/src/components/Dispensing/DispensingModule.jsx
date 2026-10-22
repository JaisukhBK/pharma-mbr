// client/src/components/Dispensing/DispensingModule.jsx
// Electronic Weighing & Dispensing — 21 CFR 211.101
import { useState, useEffect, useCallback } from 'react';
import {
  Scale, Plus, Search, CheckCircle, XCircle, AlertTriangle, Loader2,
  ArrowLeft, Package, Hash, Clock, Eye, ChevronDown
} from 'lucide-react';
import { dispensingService } from '../../services/apiService';
import { Badge, Card, Btn, Input, Select, SumCard, Label, ErrBox } from '../ui/PharmUI';

const STATUS_COLORS = { Pending:'#f5a623', 'In Progress':'#2dceef', Completed:'#00e5a0', Skipped:'#7a8ba8', 'On Hold':'#f5365c' };

export default function DispensingModule({ theme }) {
  const t = theme;
  const [view, setView] = useState('list');
  const [orders, setOrders] = useState([]);
  const [stats, setStats] = useState(null);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filterBatch, setFilterBatch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [showCreateForm, setShowCreateForm] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const clean = {};
      if (filterBatch) clean.batch_number = filterBatch;
      if (filterStatus) clean.status = filterStatus;
      const [listR, statsR] = await Promise.all([
        dispensingService.listOrders(clean),
        dispensingService.getStats(),
      ]);
      setOrders(listR.data || []);
      setStats(statsR);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, [filterBatch, filterStatus]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const openDetail = async (id) => {
    try {
      const o = await dispensingService.getOrder(id);
      setSelected(o);
      setView('detail');
    } catch (e) { setError(e.message); }
  };

  // ─── LIST VIEW ────────────────────────────────────────────────
  if (view === 'list') return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: t.text, margin: 0 }}>Weighing & Dispensing</h2>
          <p style={{ fontSize: 12, color: t.textMuted, margin: '4px 0 0' }}>Electronic balance integration, tolerance verification — 21 CFR 211.101</p>
        </div>
        <Btn t={t} onClick={() => setShowCreateForm(!showCreateForm)}><Plus size={14} />Create from BOM</Btn>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {showCreateForm && <CreateOrdersForm t={t} onSubmit={async (data) => {
        try { await dispensingService.createFromBOM(data); setShowCreateForm(false); loadAll(); } catch (e) { setError(e.message); }
      }} onCancel={() => setShowCreateForm(false)} />}

      {stats && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
          <SumCard label="Total orders" val={stats.total_orders} sub={`${stats.today} today`} color={t.accent} t={t} />
          <SumCard label="Pending" val={stats.pending} sub="Awaiting dispensing" color={parseInt(stats.pending) > 0 ? '#f5a623' : '#00e5a0'} t={t} />
          <SumCard label="Completed" val={stats.completed} sub="Dispensed & verified" color="#00e5a0" t={t} />
          <SumCard label="Out of tolerance" val={stats.out_of_tolerance} sub="Failed tolerance check" color={parseInt(stats.out_of_tolerance) > 0 ? '#f5365c' : '#00e5a0'} t={t} />
        </div>
      )}

      <Card t={t} style={{ marginBottom: 16, padding: '12px 16px' }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search size={14} color={t.textMuted} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)' }} />
            <input value={filterBatch} onChange={e => setFilterBatch(e.target.value)} placeholder="Filter by batch number..."
              style={{ width: '100%', boxSizing: 'border-box', paddingLeft: 32, background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px 9px 32px', fontSize: 13, outline: 'none' }} />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            style={{ background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 12, outline: 'none' }}>
            <option value="">All statuses</option>
            {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </Card>

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={22} color={t.accent} style={{ animation: 'spin 1s linear infinite' }} /></div>
      ) : orders.length === 0 ? (
        <Card t={t} style={{ textAlign: 'center', padding: '40px 0' }}>
          <Scale size={28} color={t.textMuted} style={{ marginBottom: 8 }} />
          <p style={{ color: t.textMuted, fontSize: 13, fontWeight: 600 }}>No dispensing orders</p>
          <p style={{ color: t.textMuted, fontSize: 11 }}>Create orders from a batch BOM to start dispensing</p>
        </Card>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {orders.map(o => {
            const sc = STATUS_COLORS[o.status] || '#7a8ba8';
            return (
              <Card t={t} key={o.id} style={{ padding: '12px 16px', cursor: 'pointer' }} onClick={() => openDetail(o.id)}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ background: sc + '15', borderRadius: 8, padding: 8 }}><Scale size={16} color={sc} /></div>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{o.material_name}</span>
                        <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{o.material_code}</span>
                        <Badge color={sc} t={t}>{o.status}</Badge>
                        {o.dispensed_quantity && !o.verified_by && <Badge color="#f5a623" t={t}>Awaiting Verification</Badge>}
                      </div>
                      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: t.textMuted }}>
                        <span>Batch: {o.batch_number}</span>
                        <span>Target: {o.target_quantity} {o.unit} (±{o.tolerance_pct}%)</span>
                        {o.dispensed_quantity && <span>Dispensed: {parseFloat(o.dispensed_quantity).toFixed(4)} {o.unit}</span>}
                        {o.assigned_lot_number && <span>Lot: {o.assigned_lot_number}</span>}
                        <span>Seq: #{o.dispensing_sequence}</span>
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

  // ─── DETAIL VIEW ──────────────────────────────────────────────
  if (view === 'detail' && selected) return (
    <OrderDetail t={t} order={selected} onBack={() => { setView('list'); loadAll(); }}
      onRefresh={async () => { const o = await dispensingService.getOrder(selected.id); setSelected(o); }} />
  );

  return null;
}

// ═══ CREATE ORDERS FROM BOM ═══
function CreateOrdersForm({ t, onSubmit, onCancel }) {
  const [batchNumber, setBatchNumber] = useState('');
  const [mbrId, setMbrId] = useState('');
  const [ebrId, setEbrId] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Card t={t} style={{ marginBottom: 16, padding: 16, borderLeft: '3px solid ' + t.accent }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10 }}>Create Dispensing Orders from BOM</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Input label="Batch Number" t={t} required value={batchNumber} onChange={v => setBatchNumber(v)} placeholder="BN-2026-001" size="sm" />
        <Input label="MBR ID" t={t} required value={mbrId} onChange={v => setMbrId(v)} placeholder="MBR UUID (from MBR Designer)" size="sm" />
        <Input label="EBR ID (optional)" t={t} value={ebrId} onChange={v => setEbrId(v)} placeholder="EBR UUID" size="sm" />
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 8 }}>
        <Btn t={t} variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn t={t} size="sm" onClick={async () => { setBusy(true); await onSubmit({ batch_number: batchNumber, mbr_id: mbrId, ebr_id: ebrId || null }); setBusy(false); }} disabled={busy || !batchNumber || !mbrId}>
          {busy ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={12} />}Create Orders
        </Btn>
      </div>
    </Card>
  );
}

// ═══ ORDER DETAIL — weighing interface ═══
function OrderDetail({ t, order: o, onBack, onRefresh }) {
  const [lots, setLots] = useState(null);
  const [showWeighForm, setShowWeighForm] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (o.status === 'Pending' || o.status === 'In Progress') {
      dispensingService.getAvailableLots(o.id).then(setLots).catch(e => setError(e.message));
    }
  }, [o.id, o.status]);

  const sc = STATUS_COLORS[o.status] || '#7a8ba8';

  return (
    <div style={{ animation: 'fadeIn 0.3s ease' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Btn t={t} variant="ghost" onClick={onBack}><ArrowLeft size={14} />All Orders</Btn>
        <Scale size={18} color={sc} />
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 800, color: t.text }}>{o.material_name}</span>
            <Badge color={sc} t={t}>{o.status}</Badge>
          </div>
          <div style={{ fontSize: 11, color: t.textMuted }}>Batch: {o.batch_number} · Target: {o.target_quantity} {o.unit} · Tolerance: ±{o.tolerance_pct}%</div>
        </div>
      </div>

      {error && <ErrBox onDismiss={() => setError('')}>{error}</ErrBox>}

      {/* Tolerance info */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <SumCard label="Target" val={`${o.target_quantity} ${o.unit}`} sub="Required quantity" color={t.accent} t={t} />
        <SumCard label="Tolerance" val={`±${o.tolerance_pct}%`} sub={`${(o.target_quantity * (1 - o.tolerance_pct / 100)).toFixed(4)} – ${(o.target_quantity * (1 + o.tolerance_pct / 100)).toFixed(4)} ${o.unit}`} color="#2dceef" t={t} />
        <SumCard label="Dispensed" val={o.dispensed_quantity ? `${parseFloat(o.dispensed_quantity).toFixed(4)} ${o.unit}` : '—'} sub={o.dispensed_by_name || 'Not dispensed yet'} color={o.dispensed_quantity ? '#00e5a0' : '#7a8ba8'} t={t} />
        <SumCard label="Verification" val={o.verified_by ? 'Verified' : o.dispensed_quantity ? 'Pending' : '—'} sub={o.verified_by_name || 'Dual check required'} color={o.verified_by ? '#00e5a0' : '#f5a623'} t={t} />
      </div>

      {/* Available lots (FEFO) */}
      {lots && o.status !== 'Completed' && (
        <Card t={t} style={{ marginBottom: 16, padding: '14px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Package size={14} color={t.accent} />
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Available Lots (FEFO order)</span>
            <span style={{ fontSize: 10, color: t.textMuted }}>Total: {lots.total_available?.toFixed(2)} {o.unit}</span>
            {!lots.sufficient && <Badge color="#f5365c" t={t}>Insufficient stock</Badge>}
          </div>
          {(lots.recommended_allocation || []).map((lot, i) => (
            <div key={lot.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: i === 0 ? t.accent + '08' : t.bgAlt, borderRadius: 8, marginBottom: 4, border: i === 0 ? '1px solid ' + t.accent + '20' : '1px solid ' + t.cardBorder + '40' }}>
              {i === 0 && <Badge color={t.accent} t={t}>Recommended</Badge>}
              <span style={{ fontSize: 12, fontWeight: 600, fontFamily: "'DM Mono',monospace", color: t.text }}>{lot.lot_number}</span>
              <span style={{ fontSize: 10, color: t.textMuted }}>Available: {parseFloat(lot.quantity_available).toFixed(2)} {o.unit}</span>
              {lot.expiry_date && <span style={{ fontSize: 10, color: new Date(lot.expiry_date) < new Date() ? '#f5365c' : t.textMuted }}>Exp: {new Date(lot.expiry_date).toLocaleDateString()}</span>}
              <span style={{ fontSize: 10, color: t.accent, fontWeight: 600, marginLeft: 'auto' }}>Allocate: {lot.recommended_qty?.toFixed(4)} {o.unit}</span>
            </div>
          ))}
          {o.status === 'Pending' && <Btn t={t} variant="accent" size="sm" style={{ marginTop: 8 }} onClick={() => setShowWeighForm(true)}><Scale size={12} />Start Weighing</Btn>}
        </Card>
      )}

      {/* Weighing form */}
      {showWeighForm && lots && (
        <WeighingForm t={t} order={o} lots={lots.recommended_allocation || lots.available_lots}
          onSubmit={async (data) => {
            try { await dispensingService.recordWeighing(o.id, data); setShowWeighForm(false); onRefresh(); } catch (e) { setError(e.message); }
          }} onCancel={() => setShowWeighForm(false)} />
      )}

      {/* Weighing records */}
      <Card t={t} style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 10 }}>Weighing Records</div>
        {(o.records || []).length === 0 ? (
          <div style={{ textAlign: 'center', padding: 20, color: t.textMuted, fontSize: 11 }}>No weighing records yet.</div>
        ) : (o.records || []).map(r => (
          <div key={r.id} style={{ padding: '10px 14px', background: t.bgAlt, borderRadius: 8, marginBottom: 4, border: '1px solid ' + (r.within_tolerance ? '#00e5a020' : '#f5365c20') }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <Badge color={r.within_tolerance ? '#00e5a0' : '#f5365c'} t={t}>{r.within_tolerance ? 'PASS' : 'FAIL'}</Badge>
              <span style={{ fontSize: 12, fontWeight: 700, fontFamily: "'DM Mono',monospace", color: t.text }}>Net: {parseFloat(r.net_weight).toFixed(4)} {r.unit}</span>
              <span style={{ fontSize: 10, color: t.textMuted }}>Tare: {r.tare_weight} · Gross: {r.gross_weight}</span>
              <span style={{ fontSize: 10, color: t.textMuted }}>Lot: {r.lot_number}</span>
              {r.verifier_id ? <Badge color="#00e5a0" t={t}>Verified by {r.verifier_name}</Badge> :
                <Btn t={t} size="sm" variant="accent" onClick={async () => { try { await dispensingService.verifyRecord(r.id); onRefresh(); } catch (e) { setError(e.message); } }}><Eye size={10} />Verify</Btn>}
            </div>
            <div style={{ fontSize: 10, color: t.textMuted }}>
              Tolerance: {parseFloat(r.tolerance_min).toFixed(4)} – {parseFloat(r.tolerance_max).toFixed(4)} {r.unit}
              {r.balance_name && ` · Balance: ${r.balance_name}`}
              {r.operator_name && ` · Operator: ${r.operator_name}`}
              · {new Date(r.created_at).toLocaleString()}
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ═══ WEIGHING FORM ═══
function WeighingForm({ t, order, lots, onSubmit, onCancel }) {
  const recommended = lots[0];
  const [data, setData] = useState({
    lot_id: recommended?.id || '', lot_number: recommended?.lot_number || '',
    tare_weight: '', gross_weight: '', balance_id: '', balance_name: '',
    environment_temp: '', environment_rh: '', notes: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setData(d => ({ ...d, [k]: v }));

  const tare = parseFloat(data.tare_weight) || 0;
  const gross = parseFloat(data.gross_weight) || 0;
  const net = gross - tare;
  const target = parseFloat(order.target_quantity);
  const tolPct = parseFloat(order.tolerance_pct) || 2;
  const tolMin = target * (1 - tolPct / 100);
  const tolMax = target * (1 + tolPct / 100);
  const withinTolerance = net > 0 && net >= tolMin && net <= tolMax;

  return (
    <Card t={t} style={{ marginBottom: 16, padding: 16, borderLeft: '3px solid ' + t.accent, background: t.bgAlt }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 12 }}>Record Weighing</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div>
          <Label t={t}>Lot</Label>
          <select value={data.lot_id} onChange={e => { const lot = lots.find(l => l.id === e.target.value); set('lot_id', e.target.value); set('lot_number', lot?.lot_number || ''); }}
            style={{ width: '100%', background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '8px 10px', fontSize: 12, outline: 'none' }}>
            {lots.map(l => <option key={l.id} value={l.id}>{l.lot_number} (Avail: {parseFloat(l.quantity_available).toFixed(2)} {order.unit})</option>)}
          </select>
        </div>
        <Input label="Balance" t={t} value={data.balance_name} onChange={v => set('balance_name', v)} placeholder="BAL-001" size="sm" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <Input label="Tare Weight" t={t} type="number" value={data.tare_weight} onChange={v => set('tare_weight', v)} placeholder="0.0000" size="sm" />
        <Input label="Gross Weight" t={t} type="number" required value={data.gross_weight} onChange={v => set('gross_weight', v)} placeholder="Enter gross" size="sm" />
        <div>
          <Label t={t}>Net Weight (auto)</Label>
          <div style={{ padding: '8px 12px', borderRadius: 8, fontSize: 16, fontWeight: 800, fontFamily: "'DM Mono',monospace",
            background: net > 0 ? (withinTolerance ? '#00e5a010' : '#f5365c10') : t.bgAlt,
            border: '1px solid ' + (net > 0 ? (withinTolerance ? '#00e5a030' : '#f5365c30') : t.cardBorder),
            color: net > 0 ? (withinTolerance ? '#00e5a0' : '#f5365c') : t.textMuted }}>
            {net > 0 ? net.toFixed(4) : '—'} {order.unit}
          </div>
        </div>
      </div>

      {/* Live tolerance indicator */}
      {net > 0 && (
        <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 8,
          background: withinTolerance ? '#00e5a008' : '#f5365c08', border: '1px solid ' + (withinTolerance ? '#00e5a020' : '#f5365c20') }}>
          {withinTolerance ? <CheckCircle size={14} color="#00e5a0" /> : <AlertTriangle size={14} color="#f5365c" />}
          <span style={{ fontSize: 11, fontWeight: 700, color: withinTolerance ? '#00e5a0' : '#f5365c' }}>
            {withinTolerance ? 'WITHIN TOLERANCE' : 'OUT OF TOLERANCE'}
          </span>
          <span style={{ fontSize: 10, color: t.textMuted }}>
            Target: {target.toFixed(4)} · Range: {tolMin.toFixed(4)} – {tolMax.toFixed(4)} {order.unit}
          </span>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 8 }}>
        <Input label="Room Temp (°C)" t={t} type="number" value={data.environment_temp} onChange={v => set('environment_temp', v)} size="sm" />
        <Input label="Room RH (%)" t={t} type="number" value={data.environment_rh} onChange={v => set('environment_rh', v)} size="sm" />
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, marginTop: 10 }}>
        <Btn t={t} variant="ghost" size="sm" onClick={onCancel}>Cancel</Btn>
        <Btn t={t} size="sm" onClick={async () => { setBusy(true); await onSubmit(data); setBusy(false); }} disabled={busy || !data.gross_weight || !data.lot_id}>
          {busy ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <Scale size={12} />}Record Weight
        </Btn>
      </div>
    </Card>
  );
}
