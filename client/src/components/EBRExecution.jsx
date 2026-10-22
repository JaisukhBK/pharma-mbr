// client/src/components/EBRExecution.jsx
// GxP-compliant EBR Execution — 21 CFR Part 11 §11.10, §11.200 | GAMP5 Cat.5 | ISA-88
// Enforces: sequential steps, parameter gates, OOS auto-deviation, e-signatures, verification, deviation resolution
import { useState, useEffect, useCallback } from 'react';
import {
  ClipboardList, Play, CheckCircle, AlertTriangle, Loader2, ChevronDown, ChevronUp,
  Plus, ArrowLeft, Shield, Activity, Lock, X, XCircle, FileText, Eye, Scale, Package, Thermometer
} from 'lucide-react';
import {
  Badge, Card, Label, Btn, SumCard, ProgressBar, Center, ErrBox, inputStyle,
  EBR_STATUS_COLORS,
} from './ui/PharmUI';

const API = import.meta.env.VITE_API_URL || '';
const token = () => localStorage.getItem('pharma_mbr_token');
const hdrs = () => ({ 'Content-Type': 'application/json', Authorization: 'Bearer ' + token() });
const api = async (url, opts = {}) => {
  const r = await fetch(API + url, { headers: hdrs(), ...opts });
  const d = await r.json().catch(() => ({ error: 'Invalid server response' }));
  if (!r.ok) throw new Error(d.error || 'Request failed (' + r.status + ')');
  return d;
};

const SC = EBR_STATUS_COLORS;

// ════════════════════════════════════════════════════════════════════════════
// MAIN EXPORT — EBR LIST + EXECUTION ROUTER
// ════════════════════════════════════════════════════════════════════════════

export default function EBRExecution({ t, user }) {
  const [view, setView] = useState('list');
  const [ebrs, setEbrs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEbr, setSelectedEbr] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    try { const d = await api('/api/ebr'); setEbrs(d.data || d || []); } catch {}
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const openEbr = async (id) => {
    try { setSelectedEbr(await api('/api/ebr/' + id)); setView('exec'); } catch (e) { alert(e.message); }
  };

  if (view === 'exec' && selectedEbr) {
    return <ExecutionView ebr={selectedEbr} t={t} user={user}
      onBack={() => { setView('list'); setSelectedEbr(null); loadList(); }}
      onRefresh={() => openEbr(selectedEbr.id)} />;
  }

  // ─── LIST VIEW ─────────────────────────────────────────────────────────
  return (
    <div style={{ padding:'24px 32px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:t.text }}>EBR Execution</div>
          <div style={{ fontSize:12, color:t.textMuted }}>Shop floor electronic batch record execution engine</div>
        </div>
        <Btn t={t} onClick={() => setShowCreate(true)} variant="accent"><Plus size={14}/>New Batch</Btn>
      </div>

      {showCreate && <CreateForm t={t} onCreated={ebr => { setShowCreate(false); loadList(); openEbr(ebr.id); }} onCancel={() => setShowCreate(false)} />}

      {loading ? <Center t={t}><Loader2 size={22} color={t.accent} style={{ animation:'spin 1s linear infinite' }}/></Center>
       : ebrs.length === 0 ? <Center t={t}><ClipboardList size={28} style={{ opacity:0.3, marginBottom:8 }}/><div style={{ fontSize:13, fontWeight:600 }}>No batch records yet</div></Center>
       : <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
          {ebrs.map(e => {
            const pct = e.total_steps > 0 ? Math.round((e.completed_steps / e.total_steps) * 100) : 0;
            const sc = SC[e.status] || '#7a8ba8';
            return (
              <div key={e.id} onClick={() => openEbr(e.id)} style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, padding:'14px 18px', cursor:'pointer', display:'flex', justifyContent:'space-between', alignItems:'center' }}
                onMouseEnter={ev => ev.currentTarget.style.borderColor=t.accent+'60'} onMouseLeave={ev => ev.currentTarget.style.borderColor=t.cardBorder}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ background:sc+'15', borderRadius:9, padding:9 }}><ClipboardList size={16} color={sc}/></div>
                  <div>
                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                      <span style={{ fontSize:13, fontWeight:700, color:t.text }}>{e.product_name}</span>
                      <span style={{ fontSize:10, fontFamily:"'DM Mono',monospace", color:t.textMuted }}>{e.ebr_code}</span>
                      <Badge color={sc}>{e.status}</Badge>
                      {e.line === 'Trial' && <Badge color="#f5a623">TRIAL</Badge>}
                    </div>
                    <div style={{ display:'flex', gap:14, fontSize:11, color:t.textMuted }}>
                      <span>Batch: {e.batch_number}</span>
                      <span>{e.completed_steps||0}/{e.total_steps||0} steps</span>
                      {e.open_deviations > 0 && <span style={{ color:'#f5365c' }}>{e.open_deviations} deviations</span>}
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                  <ProgressBar pct={pct} color={sc} width={80}/>
                  <span style={{ fontSize:10, fontFamily:"'DM Mono',monospace", color:t.textDim, minWidth:30 }}>{pct}%</span>
                </div>
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CREATE FORM — PAS-X style one-click MO
// ════════════════════════════════════════════════════════════════════════════

function CreateForm({ t, onCreated, onCancel }) {
  const [mbrs, setMbrs] = useState([]);
  const [sel, setSel] = useState('');
  const [bn, setBn] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    api('/api/mbr').then(d => {
      const list = (d.data||[]).filter(m => m.status !== 'Obsolete');
      setMbrs(list);
      if (list.length > 0) setSel(list[0].id);
    }).catch(e => setErr(e.message));
  }, []);

  const m = mbrs.find(x => x.id === sel);
  const trial = m && m.status !== 'Effective';
  const ok = sel && bn.trim();

  const go = async () => {
    setErr('');
    if (!ok) { setErr('Select MBR and enter batch number'); return; }
    setBusy(true);
    try {
      const r = await fetch(API+'/api/ebr', { method:'POST', headers:hdrs(), body:JSON.stringify({ mbr_id:sel, batch_number:bn.trim() }) });
      const d = await r.json().catch(() => ({ error:'Invalid response' }));
      if (!r.ok || d.error) throw new Error(d.error || 'Failed');
      onCreated(d);
    } catch(e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <Card t={t} style={{ marginBottom:16, padding:18, borderLeft:'3px solid '+(trial?'#f5a623':t.accent) }}>
      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:12 }}>
        <span style={{ fontSize:13, fontWeight:700, color:t.text }}>Create Manufacturing Order</span>
        <span style={{ fontSize:10, color:t.textMuted }}>PAS-X one-click MO</span>
      </div>
      <div style={{ display:'flex', gap:10, alignItems:'end' }}>
        <div style={{ flex:1 }}>
          <Label t={t}>Source MBR</Label>
          <select value={sel} onChange={e => { setSel(e.target.value); setErr(''); }} style={inputStyle(t)}>
            <option value="">Select MBR...</option>
            {mbrs.map(m => <option key={m.id} value={m.id}>{m.product_name} — {m.mbr_code} [{m.status}]{m.status!=='Effective'?' (Trial)':''}</option>)}
          </select>
        </div>
        <div style={{ width:200 }}>
          <Label t={t}>Batch Number</Label>
          <input value={bn} onChange={e => { setBn(e.target.value); setErr(''); }} placeholder="BN-2026-001" onKeyDown={e => e.key==='Enter'&&ok&&go()}
            style={{ ...inputStyle(t), width:'100%', boxSizing:'border-box' }}/>
        </div>
        <Btn t={t} onClick={go} disabled={busy||!ok} variant={trial ? 'warn' : 'accent'}>{busy?'Creating...':trial?'Start Trial Batch':'Start Production Batch'}</Btn>
        <Btn t={t} onClick={onCancel} variant="ghost">Cancel</Btn>
      </div>
      {trial && !err && <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8, padding:'6px 10px', background:'#f5a62310', border:'1px solid #f5a62330', borderRadius:6 }}>
        <AlertTriangle size={12} color="#f5a623"/><span style={{ fontSize:11, color:'#f5a623', fontWeight:600 }}>Trial batch — MBR is {m?.status} (not yet Effective). For testing/validation only.</span>
      </div>}
      {err && <ErrBox>{err}</ErrBox>}
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// EXECUTION VIEW — Full GxP-compliant step-by-step execution
// ════════════════════════════════════════════════════════════════════════════

function ExecutionView({ ebr, t, user, onBack, onRefresh }) {
  const [expanded, setExpanded] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [signModal, setSignModal] = useState(null); // { action, stepId, label }
  const [signPw, setSignPw] = useState('');
  const [signErr, setSignErr] = useState('');
  const [envZones, setEnvZones] = useState([]);
  const [selectedZoneId, setSelectedZoneId] = useState(() => sessionStorage.getItem('ebr_env_zone_' + ebr.id) || '');
  const [envRefreshKey, setEnvRefreshKey] = useState(0); // triggers StepEnvPanel re-fetch

  // Persist zone selection
  const selectZone = (zoneId) => {
    setSelectedZoneId(zoneId);
    if (zoneId) sessionStorage.setItem('ebr_env_zone_' + ebr.id, zoneId);
    else sessionStorage.removeItem('ebr_env_zone_' + ebr.id);
  };

  // Fetch available env zones on mount
  useEffect(() => {
    api('/api/env/zones').then(r => setEnvZones(r.data || [])).catch(() => {});
  }, []);

  const sum = ebr.summary || {};
  const pct = sum.total_steps > 0 ? Math.round((sum.completed_steps / sum.total_steps) * 100) : 0;
  const sc = SC[ebr.status] || '#7a8ba8';
  const isLocked = ['Complete','Released','Rejected'].includes(ebr.status);

  // Group steps by phase, maintain order
  const phases = [];
  const phaseMap = {};
  (ebr.steps || []).forEach(s => {
    const key = s.phase_name || 'General';
    if (!phaseMap[key]) { phaseMap[key] = []; phases.push(key); }
    phaseMap[key].push(s);
  });

  // §11.10(k)(2) — Sequential enforcement: find first non-completed step
  const allSteps = ebr.steps || [];
  const firstPendingIdx = allSteps.findIndex(s => s.status === 'Pending' || s.status === 'In Progress');

  // Deviation counts
  const openDevs = (ebr.deviations || []).filter(d => d.status === 'Open').length;

  // ─── ACTIONS ─────────────────────────────────────────────────────────

  const doAction = async (url, method='POST', body={}) => {
    setBusy(true); setErr('');
    try { await api(url, { method, body: JSON.stringify(body) }); onRefresh(); }
    catch(e) { setErr(e.message); } finally { setBusy(false); }
  };

  const startStep = async (stepId) => {
    setBusy(true); setErr('');
    try {
      // Start the step first
      await api('/api/ebr/steps/' + stepId + '/start', { method: 'POST', body: JSON.stringify({}) });

      // Capture env start snapshot ONLY after step started successfully
      if (selectedZoneId) {
        const step = allSteps.find(s => s.id === stepId);
        await api('/api/env/ebr/' + ebr.id + '/step/' + stepId + '/env-snapshot', {
          method: 'POST',
          body: JSON.stringify({ zone_id: selectedZoneId, step_name: step?.step_name || '', event_type: 'start_snapshot' }),
        }).catch(envErr => console.warn('[ENV] Start snapshot failed:', envErr.message));
        setEnvRefreshKey(k => k + 1); // trigger StepEnvPanel re-fetch
      }

      onRefresh();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  const completeStep = async (step) => {
    // GATE 1: All parameters must be recorded
    const params = step.parameters || [];
    const unrecorded = params.filter(p => p.actual_value === null || p.actual_value === undefined);
    if (unrecorded.length > 0) {
      setErr(`Cannot complete "${step.step_name}": ${unrecorded.length} parameter(s) not recorded. Record all values first.`);
      setExpanded(step.id);
      return;
    }

    // GATE 2: OOS parameters require deviation acknowledgment
    const oosParams = params.filter(p => p.is_oos === true || p.in_spec === false);
    if (oosParams.length > 0) {
      const ack = window.confirm(
        `⚠ OUT OF SPECIFICATION — ${oosParams.length} parameter(s):\n\n` +
        oosParams.map(p => `• ${p.param_name}: Actual ${p.actual_value} vs Target ${p.target_value} ${p.unit||''}`).join('\n') +
        '\n\nA deviation will be auto-logged per 21 CFR Part 11 §11.10(a).\nProceed with step completion?'
      );
      if (!ack) return;

      // Auto-create deviation record for OOS (audit trail requirement)
      try {
        await api('/api/ebr/' + ebr.id + '/deviations', {
          method: 'POST',
          body: JSON.stringify({
            step_execution_id: step.id,
            deviation_type: 'Out of Specification',
            severity: oosParams.some(p => p.is_cpp) ? 'Critical' : 'Major',
            description: `OOS in "${step.step_name}": ` + oosParams.map(p => `${p.param_name}=${p.actual_value} (target:${p.target_value} ${p.unit||''}, limits:${p.lower_limit||'—'}–${p.upper_limit||'—'})`).join('; '),
            immediate_action: 'Operator acknowledged. Deviation logged automatically by system.',
          }),
        });
      } catch (e) { console.error('Auto-deviation failed:', e); }
    }

    // GATE 3: Critical steps require e-signature (21 CFR Part 11 §11.200)
    if (step.is_critical || step.is_gmp_critical) {
      // Capture env end snapshot before e-sig modal (will complete after signature)
      if (selectedZoneId) {
        await api('/api/env/ebr/' + ebr.id + '/step/' + step.id + '/env-snapshot', {
          method: 'POST',
          body: JSON.stringify({ zone_id: selectedZoneId, step_name: step.step_name || '', event_type: 'end_snapshot' }),
        }).catch(envErr => console.warn('[ENV] End snapshot failed:', envErr.message));
        setEnvRefreshKey(k => k + 1);
      }
      setSignModal({ action: 'complete', stepId: step.id, label: `Complete critical step: ${step.step_name}` });
      return;
    }

    // Non-critical step — capture env end snapshot and complete
    if (selectedZoneId) {
      await api('/api/env/ebr/' + ebr.id + '/step/' + step.id + '/env-snapshot', {
        method: 'POST',
        body: JSON.stringify({ zone_id: selectedZoneId, step_name: step.step_name || '', event_type: 'end_snapshot' }),
      }).catch(envErr => console.warn('[ENV] End snapshot failed:', envErr.message));
      setEnvRefreshKey(k => k + 1);
    }
    doAction('/api/ebr/steps/' + step.id + '/complete');
  };

  const verifyStep = (stepId) => {
    setSignModal({ action: 'verify', stepId, label: 'Independent verification (second person)' });
  };

  const handleSignConfirm = async () => {
    setSignErr('');
    if (!signPw) { setSignErr('Password required'); return; }
    setBusy(true);
    try {
      // Verify password first (21 CFR Part 11 §11.200)
      const vr = await fetch(API+'/api/auth/verify-password', { method:'POST', headers:hdrs(), body:JSON.stringify({ password:signPw }) });
      const vd = await vr.json().catch(()=>({}));
      if (!vr.ok || !vd.verified) throw new Error('Password verification failed');

      // Execute the action
      const endpoint = signModal.action === 'verify'
        ? '/api/ebr/steps/' + signModal.stepId + '/verify'
        : '/api/ebr/steps/' + signModal.stepId + '/complete';
      await api(endpoint, { method:'POST', body:JSON.stringify({}) });
      setSignModal(null); setSignPw('');
      onRefresh();
    } catch(e) { setSignErr(e.message); } finally { setBusy(false); }
  };

  const completeBatch = async () => {
    // GATE: All deviations must be resolved
    if (openDevs > 0) {
      setErr(`Cannot complete batch: ${openDevs} open deviation(s) must be resolved first.`);
      return;
    }
    if (!window.confirm('Complete this batch? This action is irreversible per GxP requirements.')) return;
    doAction('/api/ebr/' + ebr.id + '/complete');
  };

  const releaseBatch = (decision) => {
    setSignModal({ action: 'release', decision, label: `QA ${decision} — Batch ${ebr.batch_number}` });
  };

  const handleReleaseConfirm = async () => {
    setSignErr('');
    if (!signPw) { setSignErr('Password required'); return; }
    setBusy(true);
    try {
      const vr = await fetch(API+'/api/auth/verify-password', { method:'POST', headers:hdrs(), body:JSON.stringify({ password:signPw }) });
      const vd = await vr.json().catch(()=>({}));
      if (!vr.ok || !vd.verified) throw new Error('Password verification failed');
      await api('/api/ebr/' + ebr.id + '/release', { method:'POST', body:JSON.stringify({ decision:signModal.decision, notes:'Released via EBR execution' }) });
      setSignModal(null); setSignPw('');
      onRefresh();
    } catch(e) { setSignErr(e.message); } finally { setBusy(false); }
  };

  // ─── RECORD PARAMETER ────────────────────────────────────────────────

  const recordParam = async (paramId, value) => {
    try {
      const result = await api('/api/ebr/parameters/' + paramId + '/record', { method:'POST', body:JSON.stringify({ actual_value: value }) });
      onRefresh();
      // Immediate OOS feedback
      if (result.is_oos || result.in_spec === false) {
        setErr(`⚠ OOS: ${result.param_name} = ${value} is outside specification limits`);
      }
    } catch(e) { setErr(e.message); }
  };

  // ─── RENDER ──────────────────────────────────────────────────────────

  return (
    <div style={{ padding:'0 32px 32px' }}>
      {/* ── HEADER ──────────────────────────────────────────────────── */}
      <div style={{ padding:'12px 0', display:'flex', alignItems:'center', gap:10, borderBottom:'1px solid '+t.cardBorder, marginBottom:16 }}>
        <button onClick={onBack} style={{ display:'flex', alignItems:'center', gap:5, padding:'5px 12px', borderRadius:7, border:'1px solid '+t.cardBorder, background:'transparent', color:t.textDim, fontSize:11, fontWeight:600, cursor:'pointer' }}><ArrowLeft size={12}/>All Batches</button>
        <ClipboardList size={16} color={sc}/>
        <span style={{ fontSize:15, fontWeight:800, color:t.text }}>{ebr.product_name}</span>
        <span style={{ fontSize:10, fontFamily:"'DM Mono',monospace", color:t.textMuted }}>{ebr.ebr_code}</span>
        <Badge color={sc}>{ebr.status}</Badge>
        {ebr.line === 'Trial' && <Badge color="#f5a623">TRIAL</Badge>}
        {isLocked && <Lock size={12} color={t.textMuted}/>}
        <div style={{ flex:1 }}/>
        {/* Batch-level actions based on status */}
        {ebr.status === 'In Progress' && sum.completed_steps === sum.total_steps && openDevs === 0 && (
          <Btn t={t} onClick={completeBatch} disabled={busy} variant="accent"><CheckCircle size={13}/>Complete Batch</Btn>
        )}
        {ebr.status === 'Complete' && <>
          <Btn t={t} onClick={() => releaseBatch('Released')} disabled={busy} variant="accent"><Shield size={13}/>Release (QA)</Btn>
          <Btn t={t} onClick={() => releaseBatch('Rejected')} disabled={busy} variant="danger"><XCircle size={13}/>Reject</Btn>
        </>}
      </div>

      {err && <div style={{ background:'#f5365c10', border:'1px solid #f5365c30', borderRadius:8, padding:'8px 14px', marginBottom:12, display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <span style={{ color:'#f5365c', fontSize:12 }}>{err}</span>
        <button onClick={() => setErr('')} style={{ background:'none', border:'none', cursor:'pointer', color:'#f5365c' }}><X size={14}/></button>
      </div>}

      {/* ── SUMMARY CARDS ───────────────────────────────────────────── */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12, marginBottom:16 }}>
        <SumCard label="Batch" val={ebr.batch_number} sub={`Size: ${ebr.batch_size||'—'}`} color={t.accent} t={t}/>
        <SumCard label="Progress" val={pct+'%'} sub={`${sum.completed_steps}/${sum.total_steps} steps`} color={pct===100?'#00e5a0':'#f5a623'} t={t}/>
        <SumCard label="Parameters" val={`${sum.recorded_params||0}/${sum.total_params||0}`} sub={sum.out_of_spec>0?sum.out_of_spec+' OOS':'All in spec'} color={sum.out_of_spec>0?'#f5365c':'#00e5a0'} t={t}/>
        <SumCard label="Deviations" val={sum.total_deviations||0} sub={openDevs>0?openDevs+' open':'None open'} color={openDevs>0?'#f5365c':'#00e5a0'} t={t}/>
      </div>

      {/* ── PROGRESS BAR ────────────────────────────────────────────── */}
      <Card t={t} style={{ marginBottom:16, padding:'12px 16px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6 }}>
          <span style={{ fontSize:11, fontWeight:600, color:t.textDim }}>EXECUTION PROGRESS</span>
          <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", color:sc }}>{pct}%</span>
        </div>
        <ProgressBar pct={pct} color={sc} width="100%" height={8}/>
      </Card>

      {/* ── ZONE SELECTOR (Environmental Monitoring · FR-ENV-007) ──── */}
      {envZones.length > 0 && (
        <Card t={t} style={{ marginBottom:16, padding:'10px 16px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <Thermometer size={14} color={t.accent}/>
            <span style={{ fontSize:11, fontWeight:600, color:t.textDim }}>ROOM ENVIRONMENT</span>
            <select value={selectedZoneId} onChange={e => selectZone(e.target.value)}
              style={{ flex:1, maxWidth:300, background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'6px 10px', fontSize:11, outline:'none' }}>
              <option value="">Select production zone...</option>
              {envZones.map(z => <option key={z.id} value={z.id}>{z.zone_name} ({z.zone_code}) — GMP {z.gmp_grade || 'N/A'}</option>)}
            </select>
            {selectedZoneId && <span style={{ fontSize:10, color:'#00e5a0', fontWeight:600 }}>Live monitoring active</span>}
          </div>
        </Card>
      )}

      {/* ── STEPS BY PHASE ──────────────────────────────────────────── */}
      {phases.map(phaseName => (
        <div key={phaseName} style={{ marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            <Activity size={14} color={t.accent}/>
            <span style={{ fontSize:13, fontWeight:700, color:t.text }}>{phaseName}</span>
            <span style={{ fontSize:10, color:t.textMuted }}>{phaseMap[phaseName].length} operations</span>
          </div>

          {phaseMap[phaseName].map(step => {
            const isExp = expanded === step.id;
            const ssc = SC[step.status] || '#7a8ba8';
            const params = step.parameters || [];
            const unrecorded = params.filter(p => p.actual_value === null || p.actual_value === undefined);
            const oosCount = params.filter(p => p.is_oos === true || p.in_spec === false).length;
            const done = step.status === 'Completed' || step.status === 'Verified';
            const stepIdx = allSteps.findIndex(s => s.id === step.id);
            // Sequential: can only start if it's the first pending step (or already in progress)
            const canStart = step.status === 'Pending' && stepIdx === firstPendingIdx && !isLocked;
            const canComplete = step.status === 'In Progress' && unrecorded.length === 0 && !isLocked;
            const needsVerify = done && step.is_critical && step.status !== 'Verified';

            return (
              <Card t={t} key={step.id} style={{ marginBottom:6, borderLeft: step.is_critical?'3px solid #f5365c':'3px solid transparent', opacity: isLocked && !done ? 0.5 : 1 }}>
                {/* Step Header */}
                <div onClick={() => setExpanded(isExp?null:step.id)} style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer' }}>
                  <div style={{ width:28, height:28, borderRadius:7, display:'flex', alignItems:'center', justifyContent:'center', background:ssc+'15', color:ssc, fontSize:11, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>
                    {done ? <CheckCircle size={14}/> : step.step_number}
                  </div>
                  <div style={{ flex:1 }}>
                    <div style={{ fontSize:12, fontWeight:600, color:t.text }}>{step.step_name}</div>
                    <div style={{ fontSize:10, color:t.textMuted }}>{step.phase_name} · {step.duration_min||'—'} min {params.length>0?`· ${params.length} params`:''}{(step.materials||[]).length>0?` · ${step.materials.length} materials`:''}</div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:5, flexWrap:'wrap', justifyContent:'flex-end' }}>
                    {step.is_critical && <Badge color="#f5365c">CPP</Badge>}
                    {oosCount > 0 && <Badge color="#f5365c">OOS ×{oosCount}</Badge>}
                    <Badge color={ssc}>{step.status}</Badge>

                    {/* Sequential: only show Start if this is the next step */}
                    {canStart && <Btn t={t} onClick={e => { e.stopPropagation(); startStep(step.id); }} disabled={busy} size="sm" variant="accent"><Play size={10}/>Start</Btn>}

                    {/* Complete: gated by params + OOS handling */}
                    {step.status === 'In Progress' && !isLocked && (
                      <Btn t={t} onClick={e => { e.stopPropagation(); completeStep(step); }} disabled={busy || !canComplete}
                        size="sm" variant={!canComplete ? 'ghost' : oosCount > 0 ? 'warn' : 'accent'}>
                        <CheckCircle size={10}/>
                        {unrecorded.length > 0 ? `${unrecorded.length} params left` : oosCount > 0 ? `Complete (${oosCount} OOS)` : 'Complete'}
                      </Btn>
                    )}

                    {/* Verify: second-person for critical steps */}
                    {needsVerify && <Btn t={t} onClick={e => { e.stopPropagation(); verifyStep(step.id); }} disabled={busy} size="sm"><Eye size={10}/>Verify</Btn>}

                    {done && <Lock size={11} color={t.textMuted}/>}
                    {isExp ? <ChevronUp size={14} color={t.textMuted}/> : <ChevronDown size={14} color={t.textMuted}/>}
                  </div>
                </div>

                {/* Expanded Detail */}
                {isExp && (
                  <div style={{ padding:'0 14px 14px', borderTop:'1px solid '+t.cardBorder+'40' }}>
                    {/* Work Instruction */}
                    {step.instruction && <div style={{ background:t.bgAlt, borderRadius:8, padding:'10px 12px', marginTop:10, marginBottom:10 }}>
                      <Label t={t}>Work Instruction</Label>
                      <div style={{ fontSize:12, color:t.text, lineHeight:1.6 }}>{step.instruction}</div>
                    </div>}

                    {/* Parameters */}
                    {params.length > 0 && <div style={{ marginTop:10 }}>
                      <Label t={t}>Parameters ({params.length})</Label>
                      <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.7fr 0.7fr 0.8fr 0.5fr auto', gap:4, padding:'6px 0', borderBottom:'1px solid '+t.cardBorder, marginBottom:4 }}>
                        {['Parameter','Target','Limits','Actual','Status',''].map(h => <span key={h} style={{ fontSize:9, fontWeight:700, color:t.textMuted, textTransform:'uppercase' }}>{h}</span>)}
                      </div>
                      {params.map(p => <ParamRow key={p.id} p={p} t={t} onRecord={v => recordParam(p.id, v)} locked={done || step.status==='Pending'}/>)}
                    </div>}

                    {/* Materials & Dispensing (21 CFR 211.101) */}
                    {(step.materials && step.materials.length > 0) && (
                      <StepDispensingSection
                        step={step} ebr={ebr} t={t}
                        locked={done || step.status === 'Pending' || isLocked}
                      />
                    )}

                    {/* Environmental Conditions (EU GMP Annex 1 · FR-ENV-007) */}
                    {(selectedZoneId || (step.env_config && step.env_config.zone_id)) && (
                      <StepEnvPanel
                        zoneId={selectedZoneId || step.env_config?.zone_id}
                        t={t} ebrId={ebr.id} stepId={step.id} stepName={step.step_name}
                        stepStatus={step.status} refreshKey={envRefreshKey}
                      />
                    )}

                    {/* Step timing */}
                    <div style={{ display:'flex', gap:16, marginTop:12, fontSize:10, color:t.textMuted }}>
                      {step.started_at && <span>Started: {new Date(step.started_at).toLocaleString()}</span>}
                      {step.completed_at && <span>Completed: {new Date(step.completed_at).toLocaleString()}</span>}
                      {step.verified_at && <span>Verified: {new Date(step.verified_at).toLocaleString()}</span>}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      ))}

      {/* ── OPEN DEVIATIONS WARNING ─────────────────────────────────── */}
      {openDevs > 0 && <Card t={t} style={{ borderLeft:'3px solid #f5365c', padding:'12px 16px', marginTop:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:6 }}>
          <AlertTriangle size={14} color="#f5365c"/>
          <span style={{ fontSize:12, fontWeight:700, color:'#f5365c' }}>{openDevs} Open Deviation(s)</span>
          <span style={{ fontSize:11, color:t.textMuted }}>— must be resolved before batch completion</span>
        </div>
        <div style={{ marginTop:8, fontSize:11 }}>
          {(ebr.deviations||[]).filter(d => d.status==='Open').map(d => (
            <div key={d.id} style={{ padding:'4px 0', borderBottom:'1px solid '+t.cardBorder+'20', color:t.text }}>
              <span style={{ fontWeight:600 }}>[{d.severity}]</span> {d.description?.substring(0,120)}
            </div>
          ))}
        </div>
      </Card>}

      {/* ── E-SIGNATURE MODAL (21 CFR Part 11 §11.200) ──────────────── */}
      {signModal && <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:999 }} onClick={() => { setSignModal(null); setSignPw(''); setSignErr(''); }}>
        <div onClick={e => e.stopPropagation()} style={{ background:t.card, borderRadius:16, padding:28, width:420, border:'1px solid '+t.cardBorder }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:16 }}>
            <Shield size={20} color={t.accent}/>
            <div>
              <div style={{ fontSize:15, fontWeight:700, color:t.text }}>Electronic Signature</div>
              <div style={{ fontSize:10, color:t.textMuted }}>21 CFR Part 11 §11.200</div>
            </div>
          </div>
          <div style={{ background:t.bgAlt, borderRadius:8, padding:'10px 14px', marginBottom:14 }}>
            <div style={{ fontSize:12, fontWeight:600, color:t.text }}>{signModal.label}</div>
            <div style={{ fontSize:10, color:t.textMuted, marginTop:2 }}>Signing as: {user?.full_name || user?.email || 'Current user'}</div>
          </div>
          <Label t={t}>Re-enter password *</Label>
          <input type="password" value={signPw} onChange={e => { setSignPw(e.target.value); setSignErr(''); }} autoFocus placeholder="••••••••"
            onKeyDown={e => e.key==='Enter' && (signModal.action==='release' ? handleReleaseConfirm() : handleSignConfirm())}
            style={{ ...inputStyle(t), width:'100%', boxSizing:'border-box', marginBottom:12 }}/>
          {signErr && <ErrBox>{signErr}</ErrBox>}
          <div style={{ display:'flex', justifyContent:'flex-end', gap:8, marginTop:8 }}>
            <Btn t={t} variant="ghost" onClick={() => { setSignModal(null); setSignPw(''); setSignErr(''); }}>Cancel</Btn>
            <Btn t={t} variant="accent" onClick={signModal.action==='release' ? handleReleaseConfirm : handleSignConfirm} disabled={busy || !signPw}>
              <Shield size={13}/>{busy ? 'Verifying...' : 'Apply Signature'}
            </Btn>
          </div>
          <div style={{ textAlign:'center', marginTop:10, fontSize:9, color:t.textMuted }}>SHA-256 bound to content · Tamper-evident audit trail</div>
        </div>
      </div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PARAMETER ROW — with recording, OOS detection, lock after record
// ════════════════════════════════════════════════════════════════════════════

function ParamRow({ p, t, onRecord, locked }) {
  const [val, setVal] = useState(p.actual_value ?? '');
  const recorded = p.actual_value !== null && p.actual_value !== undefined;
  const oos = p.is_oos === true || p.in_spec === false;

  return (
    <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.7fr 0.7fr 0.8fr 0.5fr auto', gap:4, alignItems:'center', padding:'5px 0', borderBottom:'1px solid '+t.cardBorder+'15', fontSize:11 }}>
      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
        <span style={{ fontWeight:600, color:t.text }}>{p.param_name}</span>
        {p.is_cpp && <Badge color="#f5365c" tiny>CPP</Badge>}
      </div>
      <span style={{ fontFamily:"'DM Mono',monospace", color:t.textDim }}>{p.target_value} {p.unit||''}</span>
      <span style={{ fontFamily:"'DM Mono',monospace", color:t.textDim }}>{p.lower_limit||'—'} – {p.upper_limit||'—'}</span>
      <input value={val} onChange={e => setVal(e.target.value)} disabled={locked || recorded} placeholder="Enter value"
        style={{ background: recorded ? (oos?'#f5365c08':'#00e5a008') : t.inputBg, border:'1px solid '+(recorded?(oos?'#f5365c30':'#00e5a030'):t.inputBorder), color:t.text, borderRadius:5, padding:'4px 8px', fontSize:11, outline:'none', fontFamily:"'DM Mono',monospace" }}/>
      {recorded ? (
        <span style={{ fontSize:10, fontWeight:700, color: oos?'#f5365c':'#00e5a0' }}>{oos?'OOS':'In Spec'}</span>
      ) : <span style={{ fontSize:10, color:t.textMuted }}>—</span>}
      {!recorded && !locked ? (
        <button onClick={() => { if(val) onRecord(val); }} disabled={!val}
          style={{ padding:'3px 8px', borderRadius:5, border:'none', background:val?t.accent:t.bgAlt, color:val?'#fff':t.textMuted, fontSize:10, fontWeight:600, cursor:val?'pointer':'default' }}>Record</button>
      ) : recorded ? <Lock size={10} color={t.textMuted}/> : null}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP ENVIRONMENTAL CONDITIONS PANEL — FR-ENV-007
// Shows live room conditions (temp, humidity, pressure) during step execution
// ════════════════════════════════════════════════════════════════════════════

function StepEnvPanel({ zoneId, t, ebrId, stepId, stepName, stepStatus, refreshKey }) {
  const [sensors, setSensors] = useState([]);
  const [zoneName, setZoneName] = useState('');
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState(null);

  // Fetch live zone data
  useEffect(() => {
    let mounted = true;
    async function fetchEnv() {
      try {
        const r = await api(`/api/env/zones/${zoneId}`);
        if (mounted) {
          setZoneName(r.zone_name || r.zone_code || '');
          setSensors(r.sensors || []);
        }
      } catch (e) { console.warn('[ENV] Zone fetch failed:', e.message); }
      finally { if (mounted) setLoading(false); }
    }
    fetchEnv();
    const interval = setInterval(fetchEnv, 60000);
    return () => { mounted = false; clearInterval(interval); };
  }, [zoneId]);

  // Fetch historized records — re-fetches when refreshKey changes (after snapshot capture)
  useEffect(() => {
    if (!ebrId || !stepId) return;
    api(`/api/env/ebr/${ebrId}/step/${stepId}/env-records`)
      .then(r => setHistory(r))
      .catch(() => {});
  }, [ebrId, stepId, refreshKey]);

  // Periodic recording: while step is "In Progress", capture periodic readings every 5 min
  useEffect(() => {
    if (stepStatus !== 'In Progress' || !ebrId || !stepId || !zoneId) return;

    const capturePeriodicReading = async () => {
      try {
        await api(`/api/env/ebr/${ebrId}/step/${stepId}/env-snapshot`, {
          method: 'POST',
          body: JSON.stringify({ zone_id: zoneId, step_name: stepName || '', event_type: 'periodic' }),
        });
        // Re-fetch history after periodic capture
        const h = await api(`/api/env/ebr/${ebrId}/step/${stepId}/env-records`);
        setHistory(h);
      } catch (e) { console.warn('[ENV] Periodic capture failed:', e.message); }
    };

    // Capture every 5 minutes while step is in progress
    const interval = setInterval(capturePeriodicReading, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [stepStatus, ebrId, stepId, zoneId, stepName]);

  if (loading) return null;
  if (sensors.length === 0) return null;

  const PARAM_ABBREV = { Temperature: 'TEMP', Humidity: 'RH', DiffPressure: 'ΔP', ParticleCount_0_5um: '≥0.5µm', ParticleCount_5um: '≥5µm' };
  const PARAM_COLOR = { Temperature: '#f5a623', Humidity: '#2dceef', DiffPressure: '#5046e5', ParticleCount_0_5um: '#f5365c', ParticleCount_5um: '#f5365c' };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Thermometer size={12} color={t.accent} />
        <Label t={t}>Room conditions — {zoneName}</Label>
        <span style={{ fontSize: 9, color: t.textMuted }}>EU GMP Annex 1</span>
        {stepStatus === 'In Progress' && history?.has_start && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#00e5a015', color: '#00e5a0', fontWeight: 700 }}>● RECORDING</span>}
        {history?.has_end && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#5046e515', color: '#5046e5', fontWeight: 700 }}>HISTORIZED</span>}
      </div>

      {/* Live readings */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {sensors.slice(0, 4).map(s => {
          const hasVal = s.current_value !== null && s.current_value !== undefined;
          const inSpec = s.current_in_spec !== false;
          const color = hasVal ? (inSpec ? '#00e5a0' : '#f5365c') : t.textMuted;
          const paramColor = PARAM_COLOR[s.parameter_type] || t.accent;

          return (
            <div key={s.id} style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '5px 10px', borderRadius: 6,
              background: hasVal && !inSpec ? '#f5365c08' : t.bgAlt,
              border: '1px solid ' + (hasVal && !inSpec ? '#f5365c20' : t.cardBorder + '30'),
              minWidth: 110,
            }}>
              <div style={{ width: 4, height: 24, borderRadius: 2, background: color }} />
              <div>
                <div style={{ fontSize: 9, color: t.textMuted, fontWeight: 600 }}>{PARAM_ABBREV[s.parameter_type] || s.parameter_type}</div>
                <div style={{ fontSize: 14, fontWeight: 800, fontFamily: "'DM Mono',monospace", color: hasVal ? paramColor : t.textMuted }}>
                  {hasVal ? parseFloat(s.current_value).toFixed(1) : '—'}
                  <span style={{ fontSize: 9, fontWeight: 400, marginLeft: 2 }}>{s.unit}</span>
                </div>
                <div style={{ fontSize: 8, color: t.textMuted }}>{s.low_limit}–{s.high_limit}</div>
              </div>
              {hasVal && !inSpec && <span style={{ fontSize: 8, fontWeight: 700, color: '#f5365c', marginLeft: 'auto' }}>OOS</span>}
            </div>
          );
        })}
      </div>

      {/* Historized snapshots table */}
      {history && history.total_records > 0 && (
        <div style={{ marginTop: 8, borderRadius: 6, border: '1px solid ' + t.cardBorder + '30', overflow: 'hidden' }}>
          <div style={{ padding: '6px 10px', background: t.bgAlt, display: 'flex', alignItems: 'center', gap: 6, borderBottom: '1px solid ' + t.cardBorder + '20' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: t.textDim }}>RECORDED ENVIRONMENTAL DATA</span>
            {history.oos_count > 0 && <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: '#f5365c15', color: '#f5365c', fontWeight: 700 }}>{history.oos_count} OOS</span>}
            {history.periodic?.length > 0 && <span style={{ fontSize: 8, color: t.textMuted }}>{history.periodic.length} periodic reading(s)</span>}
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
            <thead>
              <tr style={{ background: t.bgAlt }}>
                <th style={{ padding: '5px 8px', textAlign: 'left', fontWeight: 700, color: t.textMuted, borderBottom: '1px solid ' + t.cardBorder + '20' }}>Parameter</th>
                <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: t.textMuted, borderBottom: '1px solid ' + t.cardBorder + '20' }}>Limits</th>
                {history.has_start && <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: '#00e5a0', borderBottom: '1px solid ' + t.cardBorder + '20' }}>Start</th>}
                {history.has_end && <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: '#5046e5', borderBottom: '1px solid ' + t.cardBorder + '20' }}>End</th>}
                <th style={{ padding: '5px 8px', textAlign: 'center', fontWeight: 700, color: t.textMuted, borderBottom: '1px solid ' + t.cardBorder + '20' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const paramTypes = [...new Set([
                  ...history.start_snapshot.map(r => r.parameter_type),
                  ...history.end_snapshot.map(r => r.parameter_type),
                ])];
                return paramTypes.map(pt => {
                  const startRec = history.start_snapshot.find(r => r.parameter_type === pt);
                  const endRec = history.end_snapshot.find(r => r.parameter_type === pt);
                  const anyOOS = (startRec && !startRec.in_spec) || (endRec && !endRec.in_spec);
                  const rec = startRec || endRec;
                  return (
                    <tr key={pt} style={{ borderBottom: '1px solid ' + t.cardBorder + '10' }}>
                      <td style={{ padding: '5px 8px', fontWeight: 600, color: t.text }}>
                        {PARAM_ABBREV[pt] || pt}
                        <span style={{ fontWeight: 400, color: t.textMuted, marginLeft: 4 }}>({rec?.unit})</span>
                      </td>
                      <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: "'DM Mono',monospace", color: t.textMuted }}>
                        {rec?.low_limit}–{rec?.high_limit}
                      </td>
                      {history.has_start && (
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 700, color: startRec ? (startRec.in_spec ? t.text : '#f5365c') : t.textMuted }}>
                          {startRec ? parseFloat(startRec.value).toFixed(1) : '—'}
                        </td>
                      )}
                      {history.has_end && (
                        <td style={{ padding: '5px 8px', textAlign: 'center', fontFamily: "'DM Mono',monospace", fontWeight: 700, color: endRec ? (endRec.in_spec ? t.text : '#f5365c') : t.textMuted }}>
                          {endRec ? parseFloat(endRec.value).toFixed(1) : '—'}
                        </td>
                      )}
                      <td style={{ padding: '5px 8px', textAlign: 'center' }}>
                        <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: anyOOS ? '#f5365c15' : '#00e5a015', color: anyOOS ? '#f5365c' : '#00e5a0' }}>
                          {anyOOS ? 'OOS' : 'PASS'}
                        </span>
                      </td>
                    </tr>
                  );
                });
              })()}
            </tbody>
          </table>
          <div style={{ padding: '4px 8px', background: t.bgAlt, display: 'flex', gap: 16, fontSize: 9, color: t.textMuted, borderTop: '1px solid ' + t.cardBorder + '10' }}>
            {history.has_start && <span>Start: {new Date(history.start_snapshot[0]?.recorded_at).toLocaleString()}</span>}
            {history.has_end && <span>End: {new Date(history.end_snapshot[0]?.recorded_at).toLocaleString()}</span>}
            <span style={{ marginLeft: 'auto' }}>Zone: {history.start_snapshot[0]?.zone_code || history.end_snapshot[0]?.zone_code}</span>
          </div>
        </div>
      )}

      {sensors.some(s => s.current_in_spec === false) && stepStatus === 'In Progress' && (
        <div style={{ marginTop: 4, fontSize: 9, color: '#f5365c', fontWeight: 600 }}>
          ⚠ Environmental parameter(s) out of specification — deviation may be required
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP DISPENSING SECTION — inline weighing within EBR step execution
// 21 CFR 211.101 — Charge-in of components
// ════════════════════════════════════════════════════════════════════════════

function StepDispensingSection({ step, ebr, t, locked }) {
  const [dispensingState, setDispensingState] = useState({}); // keyed by material index
  const [weighingFor, setWeighingFor] = useState(null); // material index being weighed
  const [lots, setLots] = useState({}); // available lots per material
  const [error, setError] = useState('');

  const materials = step.materials || [];

  // Fetch available lots for a material
  const fetchLots = async (materialCode, materialName, idx) => {
    try {
      // Search material_master by code or name
      const r = await api('/api/genealogy/materials?search=' + encodeURIComponent(materialCode || materialName));
      const matList = r.data || [];
      if (matList.length > 0) {
        const mat = matList[0];
        const matDetail = await api('/api/genealogy/materials/' + mat.id);
        const releasedLots = (matDetail.lots || []).filter(l => l.status === 'Released' && parseFloat(l.quantity_available) > 0);
        setLots(prev => ({ ...prev, [idx]: { material: mat, lots: releasedLots } }));
      } else {
        setLots(prev => ({ ...prev, [idx]: { material: null, lots: [] } }));
      }
    } catch (e) { setError(e.message); }
  };

  // Record inline weighing
  const recordInlineWeighing = async (idx, data) => {
    try {
      const mat = materials[idx];
      const tare = parseFloat(data.tare_weight) || 0;
      const gross = parseFloat(data.gross_weight);
      if (!gross) throw new Error('Gross weight required');
      const net = gross - tare;
      const target = parseFloat(mat.quantity) || 0;
      const tolPct = 2.0; // Default ±2%
      const tolMin = target * (1 - tolPct / 100);
      const tolMax = target * (1 + tolPct / 100);
      const withinTol = target === 0 || (net >= tolMin && net <= tolMax);

      // Record transaction in genealogy
      if (data.lot_id) {
        const lotData = lots[idx]?.lots?.find(l => l.id === data.lot_id);
        await api('/api/genealogy/transactions', {
          method: 'POST',
          body: JSON.stringify({
            lot_id: data.lot_id,
            material_id: lots[idx]?.material?.id,
            transaction_type: 'Dispense',
            quantity: net,
            unit: mat.unit || 'kg',
            batch_number: ebr.batch_number,
            reason: `Dispensed for step "${step.step_name}" in batch ${ebr.batch_number}`,
          }),
        });
      }

      setDispensingState(prev => ({
        ...prev,
        [idx]: {
          dispensed: true,
          net_weight: net,
          tare_weight: tare,
          gross_weight: gross,
          lot_number: data.lot_number,
          within_tolerance: withinTol,
          tolerance: { min: tolMin, max: tolMax, pct: tolPct },
          dispensed_at: new Date().toISOString(),
        },
      }));
      setWeighingFor(null);
    } catch (e) { setError(e.message); }
  };

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Scale size={12} color={t.accent} />
        <Label t={t}>Materials & Dispensing ({materials.length})</Label>
        <span style={{ fontSize: 9, color: t.textMuted }}>21 CFR 211.101</span>
      </div>

      {error && <div style={{ background: '#f5365c10', border: '1px solid #f5365c30', borderRadius: 6, padding: '6px 10px', marginBottom: 6, fontSize: 11, color: '#f5365c', display: 'flex', justifyContent: 'space-between' }}>
        {error}<button onClick={() => setError('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f5365c' }}><X size={12} /></button>
      </div>}

      {/* Materials Grid Header */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.8fr 0.5fr auto', gap: 4, padding: '6px 0', borderBottom: '1px solid ' + t.cardBorder, marginBottom: 4 }}>
        {['Material', 'Required', 'Lot', 'Dispensed', 'Status', ''].map(h => (
          <span key={h} style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase' }}>{h}</span>
        ))}
      </div>

      {materials.map((mat, idx) => {
        const ds = dispensingState[idx];
        const isWeighing = weighingFor === idx;

        return (
          <div key={mat.id || idx}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 0.6fr 0.6fr 0.8fr 0.5fr auto', gap: 4, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid ' + t.cardBorder + '15', fontSize: 11 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Package size={10} color={mat.is_active ? '#f5365c' : t.accent} />
                <span style={{ fontWeight: 600, color: t.text }}>{mat.material_name}</span>
                {mat.is_active && <span style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#f5365c15', color: '#f5365c', fontWeight: 700 }}>API</span>}
              </div>
              <span style={{ fontFamily: "'DM Mono',monospace", color: t.textDim }}>{mat.quantity} {mat.unit || 'kg'}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", color: t.textDim, fontSize: 10 }}>{ds?.lot_number || '—'}</span>
              <span style={{ fontFamily: "'DM Mono',monospace", color: ds ? (ds.within_tolerance ? '#00e5a0' : '#f5365c') : t.textMuted }}>
                {ds ? ds.net_weight.toFixed(4) + ' ' + (mat.unit || 'kg') : '—'}
              </span>
              {ds ? (
                <span style={{ fontSize: 10, fontWeight: 700, color: ds.within_tolerance ? '#00e5a0' : '#f5365c' }}>
                  {ds.within_tolerance ? 'PASS' : 'FAIL'}
                </span>
              ) : <span style={{ fontSize: 10, color: t.textMuted }}>—</span>}
              {!ds && !locked ? (
                <button onClick={() => { fetchLots(mat.material_code, mat.material_name, idx); setWeighingFor(isWeighing ? null : idx); }}
                  style={{ padding: '3px 8px', borderRadius: 5, border: 'none', background: t.accent, color: '#fff', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}>
                  <Scale size={9} style={{ marginRight: 3 }} />Weigh
                </button>
              ) : ds ? <Lock size={10} color={t.textMuted} /> : null}
            </div>

            {/* Inline Weighing Form */}
            {isWeighing && (
              <InlineWeighForm
                t={t}
                material={mat}
                availableLots={lots[idx]?.lots || []}
                onSubmit={(data) => recordInlineWeighing(idx, data)}
                onCancel={() => setWeighingFor(null)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// INLINE WEIGH FORM — compact weighing within EBR step
// ════════════════════════════════════════════════════════════════════════════

function InlineWeighForm({ t, material, availableLots, onSubmit, onCancel }) {
  const [lotId, setLotId] = useState(availableLots[0]?.id || '');
  const [lotNumber, setLotNumber] = useState(availableLots[0]?.lot_number || '');
  const [tare, setTare] = useState('');
  const [gross, setGross] = useState('');
  const [busy, setBusy] = useState(false);

  const tareNum = parseFloat(tare) || 0;
  const grossNum = parseFloat(gross) || 0;
  const net = grossNum - tareNum;
  const target = parseFloat(material.quantity) || 0;
  const tolPct = 2.0;
  const tolMin = target * (1 - tolPct / 100);
  const tolMax = target * (1 + tolPct / 100);
  const withinTol = net > 0 && (target === 0 || (net >= tolMin && net <= tolMax));

  return (
    <div style={{ background: t.bgAlt, borderRadius: 8, padding: '10px 14px', margin: '4px 0 6px', borderLeft: '3px solid ' + t.accent }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        {/* Lot selector */}
        <div style={{ minWidth: 140 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Lot (FEFO)</div>
          {availableLots.length > 0 ? (
            <select value={lotId} onChange={e => { setLotId(e.target.value); setLotNumber(availableLots.find(l => l.id === e.target.value)?.lot_number || ''); }}
              style={{ background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 5, padding: '5px 8px', fontSize: 10, outline: 'none', width: '100%' }}>
              {availableLots.map(l => (
                <option key={l.id} value={l.id}>{l.lot_number} ({parseFloat(l.quantity_available).toFixed(1)} {material.unit || 'kg'})</option>
              ))}
            </select>
          ) : (
            <div style={{ fontSize: 10, color: '#f5365c', padding: '5px 0' }}>No released lots available</div>
          )}
        </div>

        {/* Tare */}
        <div style={{ width: 90 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Tare</div>
          <input value={tare} onChange={e => setTare(e.target.value)} placeholder="0.0000" type="number" step="0.0001"
            style={{ background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 5, padding: '5px 8px', fontSize: 11, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: "'DM Mono',monospace" }} />
        </div>

        {/* Gross */}
        <div style={{ width: 90 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Gross</div>
          <input value={gross} onChange={e => setGross(e.target.value)} placeholder="Enter" type="number" step="0.0001"
            style={{ background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 5, padding: '5px 8px', fontSize: 11, outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: "'DM Mono',monospace" }} />
        </div>

        {/* Net (auto) */}
        <div style={{ width: 100 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Net (auto)</div>
          <div style={{ padding: '5px 8px', borderRadius: 5, fontSize: 12, fontWeight: 800, fontFamily: "'DM Mono',monospace",
            background: net > 0 ? (withinTol ? '#00e5a010' : '#f5365c10') : t.bgAlt,
            border: '1px solid ' + (net > 0 ? (withinTol ? '#00e5a030' : '#f5365c30') : t.cardBorder),
            color: net > 0 ? (withinTol ? '#00e5a0' : '#f5365c') : t.textMuted }}>
            {net > 0 ? net.toFixed(4) : '—'}
          </div>
        </div>

        {/* Tolerance indicator */}
        {net > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 5,
            background: withinTol ? '#00e5a010' : '#f5365c10', border: '1px solid ' + (withinTol ? '#00e5a020' : '#f5365c20') }}>
            {withinTol ? <CheckCircle size={11} color="#00e5a0" /> : <AlertTriangle size={11} color="#f5365c" />}
            <span style={{ fontSize: 9, fontWeight: 700, color: withinTol ? '#00e5a0' : '#f5365c' }}>
              {withinTol ? 'PASS' : 'FAIL'}
            </span>
          </div>
        )}

        {/* Actions */}
        <button onClick={onCancel} style={{ padding: '5px 10px', borderRadius: 5, border: '1px solid ' + t.cardBorder, background: 'transparent', color: t.textMuted, fontSize: 10, cursor: 'pointer' }}>Cancel</button>
        <button onClick={async () => {
          if (!gross || !lotId) return;
          setBusy(true);
          await onSubmit({ lot_id: lotId, lot_number: lotNumber, tare_weight: tare, gross_weight: gross });
          setBusy(false);
        }} disabled={busy || !gross || !lotId || availableLots.length === 0}
          style={{ padding: '5px 12px', borderRadius: 5, border: 'none', background: (gross && lotId) ? t.accent : t.bgAlt, color: (gross && lotId) ? '#fff' : t.textMuted, fontSize: 10, fontWeight: 700, cursor: (gross && lotId) ? 'pointer' : 'default' }}>
          {busy ? '...' : 'Record'}
        </button>
      </div>
      {target > 0 && <div style={{ fontSize: 9, color: t.textMuted, marginTop: 4 }}>
        Target: {target.toFixed(4)} {material.unit || 'kg'} · Tolerance: ±{tolPct}% ({tolMin.toFixed(4)} – {tolMax.toFixed(4)})
      </div>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SHARED UI COMPONENTS — imported from ./ui/PharmUI.jsx
// Badge, Card, Label, Btn, SumCard, ProgressBar, Center, ErrBox, inputStyle
// ════════════════════════════════════════════════════════════════════════════
