// client/src/components/EBRExecution.jsx
// Shop floor Electronic Batch Record execution interface
import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Play, CheckCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Plus, ArrowLeft, Clock, Shield, Activity, Package, FileText, X, User
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('pharma_mbr_token');
const headers = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() });
const apiFetch = async (url, opts = {}) => {
  const res = await fetch(API + url, { headers: headers(), ...opts });
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || 'Request failed'); }
  return res.json();
};

const STATUS_COLORS = { Ready: '#2dceef', 'In Progress': '#f5a623', Complete: '#00e5a0', Released: '#00e5a0', Rejected: '#f5365c', Pending: '#7a8ba8', Completed: '#00e5a0', Verified: '#5046e5' };

export default function EBRExecution({ t, user }) {
  const [view, setView] = useState('list');
  const [ebrs, setEbrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEbr, setSelectedEbr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try { const data = await apiFetch('/api/ebr'); setEbrs(data.data || data || []); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const openEbr = async (id) => {
    try {
      const data = await apiFetch('/api/ebr/' + id);
      setSelectedEbr(data);
      setView('execution');
    } catch (e) { alert(e.message); }
  };

  if (view === 'execution' && selectedEbr) {
    return <EBRExecutionView ebr={selectedEbr} t={t} user={user} onBack={() => { setView('list'); setSelectedEbr(null); loadList(); }} onRefresh={() => openEbr(selectedEbr.id)} />;
  }

  return (
    <div style={{ padding: '24px 32px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: t.text }}>EBR Execution</div>
          <div style={{ fontSize: 12, color: t.textMuted }}>Shop floor electronic batch record execution engine</div>
        </div>
        <button onClick={() => setShowCreate(true)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: t.accent, color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
          <Plus size={15} />New Batch
        </button>
      </div>

      {showCreate && <CreateEBRForm t={t} onCreated={(ebr) => { setShowCreate(false); loadList(); openEbr(ebr.id); }} onCancel={() => setShowCreate(false)} />}

      {loading ? (
        <div style={{ textAlign: 'center', padding: 40 }}><Loader2 size={22} color={t.accent} style={{ animation: 'spin 1s linear infinite' }} /></div>
      ) : ebrs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: 60, color: t.textMuted }}>
          <ClipboardList size={30} style={{ opacity: 0.3, marginBottom: 10 }} />
          <div style={{ fontSize: 14, fontWeight: 600 }}>No batch records yet</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>Create a new batch from an Effective MBR to start execution</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ebrs.map(e => {
            const pct = e.total_steps > 0 ? Math.round((e.completed_steps / e.total_steps) * 100) : 0;
            const sc = STATUS_COLORS[e.status] || '#7a8ba8';
            return (
              <div key={e.id} onClick={() => openEbr(e.id)}
                style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 12, padding: '14px 18px', cursor: 'pointer', transition: 'all 0.12s', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                onMouseEnter={ev => ev.currentTarget.style.borderColor = t.accent + '60'}
                onMouseLeave={ev => ev.currentTarget.style.borderColor = t.cardBorder}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ background: sc + '15', borderRadius: 9, padding: 9 }}><ClipboardList size={16} color={sc} /></div>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                      <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{e.product_name}</span>
                      <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{e.ebr_code}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: sc + '15', color: sc }}>{e.status}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 14, fontSize: 11, color: t.textMuted }}>
                      <span>Batch: {e.batch_number}</span>
                      <span>{e.completed_steps || 0}/{e.total_steps || 0} steps</span>
                      {e.open_deviations > 0 && <span style={{ color: '#f5365c' }}>{e.open_deviations} deviations</span>}
                      {e.operator_name && <span>{e.operator_name}</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 80, height: 6, background: t.bgAlt, borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: pct + '%', height: '100%', background: sc, borderRadius: 3, transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textDim, minWidth: 30 }}>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ═══ CREATE EBR FORM ═══

function CreateEBRForm({ t, onCreated, onCancel }) {
  const [mbrs, setMbrs] = useState([]);
  const [selectedMbr, setSelectedMbr] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    apiFetch('/api/mbr?status=Effective').then(d => setMbrs(d.data || [])).catch(() => {});
  }, []);

  const handleCreate = async () => {
    if (!selectedMbr || !batchNumber.trim()) { setError('Select an MBR and enter a batch number'); return; }
    setCreating(true); setError('');
    try {
      const result = await apiFetch('/api/ebr', { method: 'POST', body: JSON.stringify({ mbr_id: selectedMbr, batch_number: batchNumber.trim() }) });
      if (result.error) throw new Error(result.error);
      onCreated(result);
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
  };

  return (
    <div style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 12, padding: 18, marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: t.text, marginBottom: 12 }}>Create New Batch Record</div>
      <div style={{ display: 'flex', gap: 10 }}>
        <select value={selectedMbr} onChange={e => setSelectedMbr(e.target.value)} style={{ flex: 1, background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none' }}>
          <option value="">Select Effective MBR...</option>
          {mbrs.map(m => <option key={m.id} value={m.id}>{m.product_name} — {m.mbr_code}</option>)}
        </select>
        <input value={batchNumber} onChange={e => setBatchNumber(e.target.value)} placeholder="Batch number (e.g. BN-2026-001)" onKeyDown={e => e.key === 'Enter' && handleCreate()}
          style={{ width: 220, background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
        <button onClick={handleCreate} disabled={creating} style={{ padding: '9px 18px', borderRadius: 8, border: 'none', background: t.accent, color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: creating ? 0.5 : 1 }}>
          {creating ? 'Creating...' : 'Start Batch'}
        </button>
        <button onClick={onCancel} style={{ padding: '9px 14px', borderRadius: 8, border: '1px solid ' + t.cardBorder, background: 'transparent', color: t.textDim, fontSize: 13, cursor: 'pointer' }}>Cancel</button>
      </div>
      {error && <div style={{ color: '#f5365c', fontSize: 11, marginTop: 8 }}>{error}</div>}
      {mbrs.length === 0 && <div style={{ color: t.textMuted, fontSize: 11, marginTop: 8 }}>No Effective MBRs found. Sign and approve an MBR first.</div>}
    </div>
  );
}

// ═══ EBR EXECUTION VIEW ═══

function EBRExecutionView({ ebr, t, user, onBack, onRefresh }) {
  const [expandedStep, setExpandedStep] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const summary = ebr.summary || {};
  const pct = summary.total_steps > 0 ? Math.round((summary.completed_steps / summary.total_steps) * 100) : 0;
  const sc = STATUS_COLORS[ebr.status] || '#7a8ba8';

  const handleStartStep = async (stepId) => {
    setLoading(true); setError('');
    try { await apiFetch('/api/ebr/steps/' + stepId + '/start', { method: 'POST' }); onRefresh(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleCompleteStep = async (stepId) => {
    setLoading(true); setError('');
    try { await apiFetch('/api/ebr/steps/' + stepId + '/complete', { method: 'POST', body: JSON.stringify({}) }); onRefresh(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  const handleRecordParam = async (paramId, value) => {
    try { await apiFetch('/api/ebr/parameters/' + paramId + '/record', { method: 'POST', body: JSON.stringify({ actual_value: value }) }); onRefresh(); }
    catch (e) { alert(e.message); }
  };

  const handleCompleteBatch = async () => {
    if (!confirm('Complete this batch? All steps must be finished.')) return;
    setLoading(true);
    try { await apiFetch('/api/ebr/' + ebr.id + '/complete', { method: 'POST' }); onRefresh(); }
    catch (e) { setError(e.message); } finally { setLoading(false); }
  };

  // Group steps by phase
  const phases = {};
  (ebr.steps || []).forEach(s => {
    const key = s.phase_name || 'General';
    if (!phases[key]) phases[key] = [];
    phases[key].push(s);
  });

  return (
    <div style={{ padding: '0 32px 32px' }}>
      {/* Header */}
      <div style={{ padding: '12px 0', display: 'flex', alignItems: 'center', gap: 10, borderBottom: '1px solid ' + t.cardBorder, marginBottom: 16 }}>
        <button onClick={onBack} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 7, border: '1px solid ' + t.cardBorder, background: 'transparent', color: t.textDim, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}><ArrowLeft size={12} />All Batches</button>
        <ClipboardList size={16} color={sc} />
        <span style={{ fontSize: 15, fontWeight: 800, color: t.text }}>{ebr.product_name}</span>
        <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>{ebr.ebr_code}</span>
        <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: sc + '15', color: sc }}>{ebr.status}</span>
        <div style={{ flex: 1 }} />
        {ebr.status === 'In Progress' && summary.completed_steps === summary.total_steps && (
          <button onClick={handleCompleteBatch} disabled={loading} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '7px 16px', borderRadius: 8, border: 'none', background: '#00e5a0', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
            <CheckCircle size={13} />Complete Batch
          </button>
        )}
      </div>

      {error && <div style={{ background: '#f5365c10', border: '1px solid #f5365c30', borderRadius: 8, padding: '8px 14px', marginBottom: 12, color: '#f5365c', fontSize: 12 }}>{error}</div>}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
        <SummaryCard label="Batch" value={ebr.batch_number} sub={`Size: ${ebr.batch_size || '—'}`} color={t.accent} t={t} />
        <SummaryCard label="Progress" value={pct + '%'} sub={`${summary.completed_steps}/${summary.total_steps} steps`} color={pct === 100 ? '#00e5a0' : '#f5a623'} t={t} />
        <SummaryCard label="Parameters" value={summary.recorded_params + '/' + summary.total_params} sub="recorded" color={t.info || '#2dceef'} t={t} />
        <SummaryCard label="Deviations" value={summary.total_deviations || 0} sub={summary.open_deviations > 0 ? summary.open_deviations + ' open' : 'None open'} color={summary.open_deviations > 0 ? '#f5365c' : '#00e5a0'} t={t} />
      </div>

      {/* Progress Bar */}
      <div style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 10, padding: '12px 16px', marginBottom: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: t.textDim }}>EXECUTION PROGRESS</span>
          <span style={{ fontSize: 11, fontFamily: "'DM Mono',monospace", color: sc }}>{pct}%</span>
        </div>
        <div style={{ height: 8, background: t.bgAlt, borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ width: pct + '%', height: '100%', background: sc, borderRadius: 4, transition: 'width 0.5s ease' }} />
        </div>
      </div>

      {/* Steps by Phase */}
      {Object.entries(phases).map(([phaseName, steps]) => (
        <div key={phaseName} style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <Activity size={14} color={t.accent} />
            <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>{phaseName}</span>
            <span style={{ fontSize: 10, color: t.textMuted }}>{steps.length} operations</span>
          </div>

          {steps.map(step => {
            const isExpanded = expandedStep === step.id;
            const stepSc = STATUS_COLORS[step.status] || '#7a8ba8';
            return (
              <div key={step.id} style={{ background: t.card, border: '1px solid ' + (step.is_critical ? '#f5365c30' : t.cardBorder), borderRadius: 10, marginBottom: 6, overflow: 'hidden' }}>
                {/* Step Header */}
                <div onClick={() => setExpandedStep(isExpanded ? null : step.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', cursor: 'pointer' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', background: stepSc + '15', color: stepSc, fontSize: 11, fontWeight: 700, fontFamily: "'DM Mono',monospace" }}>
                    {step.status === 'Completed' || step.status === 'Verified' ? <CheckCircle size={14} /> : step.step_number}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: t.text }}>{step.step_name}</div>
                    <div style={{ fontSize: 10, color: t.textMuted }}>{step.phase_name} · {step.duration_min || '—'} min</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {step.is_critical && <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: '#f5365c15', color: '#f5365c' }}>CPP</span>}
                    <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 8px', borderRadius: 5, background: stepSc + '15', color: stepSc }}>{step.status}</span>
                    {step.status === 'Pending' && (
                      <button onClick={(e) => { e.stopPropagation(); handleStartStep(step.id); }} disabled={loading}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#2dceef', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                        <Play size={10} />Start
                      </button>
                    )}
                    {step.status === 'In Progress' && (
                      <button onClick={(e) => { e.stopPropagation(); handleCompleteStep(step.id); }} disabled={loading}
                        style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, border: 'none', background: '#00e5a0', color: '#fff', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}>
                        <CheckCircle size={10} />Complete
                      </button>
                    )}
                    {isExpanded ? <ChevronUp size={14} color={t.textMuted} /> : <ChevronDown size={14} color={t.textMuted} />}
                  </div>
                </div>

                {/* Expanded Step Detail */}
                {isExpanded && (
                  <div style={{ padding: '0 14px 14px', borderTop: '1px solid ' + t.cardBorder + '40' }}>
                    {/* Instruction */}
                    {step.instruction && (
                      <div style={{ background: t.bgAlt, borderRadius: 8, padding: '10px 12px', marginTop: 10, marginBottom: 10 }}>
                        <div style={{ fontSize: 9, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>Work instruction</div>
                        <div style={{ fontSize: 12, color: t.text, lineHeight: 1.5 }}>{step.instruction}</div>
                      </div>
                    )}

                    {/* Parameters */}
                    {(step.parameters || []).length > 0 && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 10, fontWeight: 600, color: t.textDim, textTransform: 'uppercase', marginBottom: 6 }}>Parameters</div>
                        {step.parameters.map(p => (
                          <ParamRow key={p.id} param={p} t={t} onRecord={(val) => handleRecordParam(p.id, val)} disabled={step.status === 'Pending'} />
                        ))}
                      </div>
                    )}

                    {/* Timing */}
                    <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 10, color: t.textMuted }}>
                      {step.started_at && <span>Started: {new Date(step.started_at).toLocaleString()}</span>}
                      {step.completed_at && <span>Completed: {new Date(step.completed_at).toLocaleString()}</span>}
                      {step.actual_duration_min && <span>Duration: {step.actual_duration_min} min</span>}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ═══ PARAMETER ROW ═══

function ParamRow({ param, t, onRecord, disabled }) {
  const [value, setValue] = useState(param.actual_value || '');
  const recorded = param.actual_value !== null && param.actual_value !== undefined;
  const inSpec = param.in_spec !== null ? param.in_spec : (param.is_oos !== null ? !param.is_oos : null);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.8fr 0.6fr auto', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + t.cardBorder + '20', fontSize: 11 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ fontWeight: 600, color: t.text }}>{param.param_name}</span>
        {param.is_cpp && <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: '#f5365c15', color: '#f5365c' }}>CPP</span>}
      </div>
      <span style={{ fontFamily: "'DM Mono',monospace", color: t.textDim }}>Target: {param.target_value} {param.unit}</span>
      <span style={{ fontFamily: "'DM Mono',monospace", color: t.textDim }}>{param.lower_limit}–{param.upper_limit}</span>
      <input value={value} onChange={e => setValue(e.target.value)} disabled={disabled || recorded} placeholder="Actual value"
        style={{ background: recorded ? (inSpec ? '#00e5a008' : '#f5365c08') : t.inputBg, border: '1px solid ' + (recorded ? (inSpec ? '#00e5a030' : '#f5365c30') : t.inputBorder), color: t.text, borderRadius: 5, padding: '4px 8px', fontSize: 11, outline: 'none', fontFamily: "'DM Mono',monospace" }} />
      {recorded ? (
        <span style={{ fontSize: 10, fontWeight: 600, color: inSpec ? '#00e5a0' : '#f5365c' }}>{inSpec ? 'In Spec' : 'OOS'}</span>
      ) : (
        <span style={{ fontSize: 10, color: t.textMuted }}>—</span>
      )}
      {!recorded && !disabled && (
        <button onClick={() => { if (value) onRecord(value); }} disabled={!value}
          style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: value ? t.accent : t.bgAlt, color: value ? '#fff' : t.textMuted, fontSize: 10, fontWeight: 600, cursor: value ? 'pointer' : 'default' }}>
          Record
        </button>
      )}
    </div>
  );
}

// ═══ SUMMARY CARD ═══

function SummaryCard({ label, value, sub, color, t }) {
  return (
    <div style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 10, padding: '12px 16px' }}>
      <div style={{ fontSize: 9, fontWeight: 600, color: t.textMuted, textTransform: 'uppercase', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 800, color: color, fontFamily: "'DM Mono',monospace" }}>{value}</div>
      <div style={{ fontSize: 10, color: t.textDim, marginTop: 2 }}>{sub}</div>
    </div>
  );
}
