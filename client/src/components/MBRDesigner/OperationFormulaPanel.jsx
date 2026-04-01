// client/src/components/MBRDesigner/OperationFormulaPanel.jsx
// Formula Validation & Trial — scoped to Operation (Step) level within Unit Procedures
import { useState, useEffect } from 'react';
import { Calculator, Play, Plus, Trash2, ChevronDown, ChevronUp, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';

export default function OperationFormulaPanel({ mbrId, mbrData, t, disabled, featuresService }) {
  const [formulas, setFormulas] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedPhase, setSelectedPhase] = useState('');
  const [selectedStep, setSelectedStep] = useState('');
  const [newF, setNewF] = useState({ formula_name:'', expression:'', formula_type:'simple', result_unit:'', description:'' });
  const [trialResult, setTrialResult] = useState(null);
  const [quickExpr, setQuickExpr] = useState('');
  const [quickVars, setQuickVars] = useState('batch_size=500000');
  const [quickResult, setQuickResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const phases = mbrData?.phases || [];
  const currentPhase = phases.find(p => p.id === selectedPhase);
  const steps = currentPhase?.steps || [];
  const currentStep = steps.find(s => s.id === selectedStep);

  useEffect(() => { if (mbrId && featuresService) loadFormulas(); }, [mbrId]);
  useEffect(() => { if (phases.length > 0 && !selectedPhase) setSelectedPhase(phases[0].id); }, [phases]);
  useEffect(() => { if (steps.length > 0 && !selectedStep) setSelectedStep(steps[0].id); }, [steps, selectedPhase]);

  const loadFormulas = async () => { try { const r = await featuresService.listFormulas(mbrId); setFormulas(r.data || []); } catch {} };

  const handleCreate = async () => {
    if (!newF.formula_name || !newF.expression) return;
    setLoading(true);
    try { await featuresService.createFormula(mbrId, { ...newF, step_id: selectedStep || null }); setShowAdd(false); setNewF({ formula_name:'', expression:'', formula_type:'simple', result_unit:'', description:'' }); loadFormulas(); }
    catch (e) { alert(e.message); } finally { setLoading(false); }
  };

  const handleTrial = async (formulaId) => {
    const vars = {};
    quickVars.split(',').forEach(pair => { const [k,v] = pair.split('=').map(s => s.trim()); if (k&&v) vars[k] = parseFloat(v)||v; });
    setLoading(true);
    try { const r = await featuresService.trialFormula(mbrId, formulaId, vars); setTrialResult({ id:formulaId, ...r }); }
    catch (e) { alert(e.message); } finally { setLoading(false); }
  };

  const handleQuickEval = async () => {
    if (!quickExpr) return;
    const vars = {};
    quickVars.split(',').forEach(pair => { const [k,v] = pair.split('=').map(s => s.trim()); if (k&&v) vars[k] = parseFloat(v)||v; });
    setLoading(true);
    try { const r = await featuresService.evaluateFormula(mbrId, quickExpr, vars); setQuickResult(r); }
    catch (e) { alert(e.message); } finally { setLoading(false); }
  };

  // Filter formulas for current step context
  const stepFormulas = formulas.filter(f => !f.step_id || f.step_id === selectedStep);

  return <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, overflow:'hidden' }}>
    {/* Header - collapsible */}
    <div onClick={() => setExpanded(!expanded)} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 18px', cursor:'pointer', borderBottom: expanded ? '1px solid '+t.cardBorder : 'none' }}>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        <div style={{ background:'#2dceef15', borderRadius:7, padding:6, display:'flex' }}><Calculator size={15} color="#2dceef"/></div>
        <span style={{ fontSize:13, fontWeight:700, color:t.text }}>Operation Formulas</span>
        <span style={{ fontSize:10, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{formulas.length} defined</span>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        {currentStep && <span style={{ fontSize:10, color:t.accent, fontFamily:"'DM Mono',monospace" }}>{currentPhase?.phase_name} → {currentStep?.step_name}</span>}
        {expanded ? <ChevronUp size={16} color={t.textMuted}/> : <ChevronDown size={16} color={t.textMuted}/>}
      </div>
    </div>

    {expanded && <div style={{ padding:16 }}>
      {/* Phase → Step selector */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:14, padding:'10px 12px', background:t.bgAlt, borderRadius:8 }}>
        <div>
          <label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:0.4, marginBottom:3, display:'block' }}>Unit Procedure (Phase)</label>
          <select value={selectedPhase} onChange={e => { setSelectedPhase(e.target.value); setSelectedStep(''); }} style={{ width:'100%', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'7px 10px', fontSize:11, outline:'none' }}>
            {phases.map(p => <option key={p.id} value={p.id}>{p.phase_number}. {p.phase_name}</option>)}
          </select>
        </div>
        <div>
          <label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:0.4, marginBottom:3, display:'block' }}>Operation (Step)</label>
          <select value={selectedStep} onChange={e => setSelectedStep(e.target.value)} style={{ width:'100%', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'7px 10px', fontSize:11, outline:'none' }}>
            {steps.map(s => <option key={s.id} value={s.id}>{s.step_number}. {s.step_name} {s.is_critical ? '(CPP)' : ''}</option>)}
          </select>
        </div>
      </div>

      {/* Quick Evaluate */}
      <div style={{ background:t.bgAlt, borderRadius:8, padding:12, marginBottom:14, border:'1px solid '+t.cardBorder+'40' }}>
        <div style={{ fontSize:10, fontWeight:600, color:t.textDim, textTransform:'uppercase', marginBottom:6 }}>Quick Evaluate</div>
        <div style={{ display:'grid', gridTemplateColumns:'2fr 1.5fr auto', gap:8, alignItems:'end' }}>
          <div><label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', marginBottom:2, display:'block' }}>Expression</label>
            <input value={quickExpr} onChange={e=>setQuickExpr(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleQuickEval()} placeholder="batch_size * api_pct / 100" style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'7px 10px', fontSize:11, outline:'none', fontFamily:"'DM Mono',monospace" }}/></div>
          <div><label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', marginBottom:2, display:'block' }}>Variables (key=val)</label>
            <input value={quickVars} onChange={e=>setQuickVars(e.target.value)} placeholder="batch_size=500000,api_pct=20" style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'7px 10px', fontSize:11, outline:'none' }}/></div>
          <button onClick={handleQuickEval} disabled={loading||!quickExpr} style={{ display:'flex', alignItems:'center', gap:4, padding:'7px 14px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', border:'none', background:t.accent, color:'#fff', marginBottom:0, opacity:quickExpr?1:0.4 }}>{loading?<Loader2 size={12} style={{ animation:'spin 1s linear infinite' }}/>:<Play size={12}/>}Run</button>
        </div>
        {quickResult && <div style={{ marginTop:8, padding:'6px 10px', borderRadius:6, background:quickResult.valid?'#00e5a010':'#f5365c10', border:'1px solid '+(quickResult.valid?'#00e5a030':'#f5365c30') }}>
          <div style={{ fontSize:12, fontWeight:700, color:quickResult.valid?'#00e5a0':'#f5365c', fontFamily:"'DM Mono',monospace" }}>
            {quickResult.valid?`= ${quickResult.result}`:`Error: ${quickResult.error}`}
          </div>
          {quickResult.steps && <div style={{ fontSize:9, color:t.textMuted, marginTop:4 }}>
            {quickResult.steps.map((s,i) => <div key={i}>{s.step}: <span style={{ fontFamily:"'DM Mono',monospace" }}>{String(s.value).substring(0,80)}</span></div>)}
          </div>}
        </div>}
      </div>

      {/* Add formula */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <span style={{ fontSize:11, fontWeight:600, color:t.textDim, textTransform:'uppercase' }}>Saved Formulas{currentStep?` — ${currentStep.step_name}`:''}</span>
        <button onClick={()=>setShowAdd(!showAdd)} disabled={disabled} style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', border:'1px solid '+t.accent+'30', background:t.accent+'10', color:t.accent }}><Plus size={10}/>Add Formula</button>
      </div>

      {showAdd && <div style={{ background:t.bgAlt, borderRadius:8, padding:12, marginBottom:10, border:'1px dashed '+t.accent+'40' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.6fr', gap:8 }}>
          <div><label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', marginBottom:2, display:'block' }}>Name *</label>
            <input value={newF.formula_name} onChange={e=>setNewF({...newF,formula_name:e.target.value})} placeholder="Yield Calculation" style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'6px 10px', fontSize:11, outline:'none' }}/></div>
          <div><label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', marginBottom:2, display:'block' }}>Type</label>
            <select value={newF.formula_type} onChange={e=>setNewF({...newF,formula_type:e.target.value})} style={{ width:'100%', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'6px 10px', fontSize:11, outline:'none' }}>
              {['simple','complex','calculus','excel_ref','xml_ref'].map(o=><option key={o} value={o}>{o}</option>)}
            </select></div>
          <div><label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', marginBottom:2, display:'block' }}>Unit</label>
            <input value={newF.result_unit} onChange={e=>setNewF({...newF,result_unit:e.target.value})} placeholder="kg, %" style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'6px 10px', fontSize:11, outline:'none' }}/></div>
        </div>
        <div style={{ marginTop:6 }}><label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', marginBottom:2, display:'block' }}>Expression *</label>
          <input value={newF.expression} onChange={e=>setNewF({...newF,expression:e.target.value})} placeholder="(actual_yield / theoretical_yield) * 100" style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'6px 10px', fontSize:11, outline:'none', fontFamily:"'DM Mono',monospace" }}/></div>
        <div style={{ display:'flex', gap:6, justifyContent:'flex-end', marginTop:8 }}>
          <button onClick={()=>setShowAdd(false)} style={{ padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:600, cursor:'pointer', border:'1px solid '+t.cardBorder, background:'transparent', color:t.textDim }}>Cancel</button>
          <button onClick={handleCreate} disabled={!newF.formula_name||!newF.expression||loading} style={{ display:'flex', alignItems:'center', gap:4, padding:'5px 12px', borderRadius:6, fontSize:11, fontWeight:700, cursor:'pointer', border:'none', background:t.accent, color:'#fff', opacity:(!newF.formula_name||!newF.expression)?0.4:1 }}><Plus size={10}/>Create</button>
        </div>
      </div>}

      {/* Formula list */}
      {stepFormulas.length === 0 && !showAdd ? <div style={{ textAlign:'center', padding:'16px 0', color:t.textMuted, fontSize:11, border:'1px dashed '+t.cardBorder, borderRadius:6 }}>No formulas for this operation. Use Quick Evaluate above or add a saved formula.</div> :
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          {stepFormulas.map(f => <div key={f.id} style={{ padding:'8px 12px', background:t.bgAlt, borderRadius:6, border:'1px solid '+t.cardBorder+'40' }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <Calculator size={11} color="#2dceef"/>
                <span style={{ fontSize:11, fontWeight:600, color:t.text }}>{f.formula_name}</span>
                <span style={{ fontSize:9, fontFamily:"'DM Mono',monospace", background:'#2dceef15', color:'#2dceef', padding:'1px 5px', borderRadius:3 }}>{f.formula_type}</span>
                {f.result_unit && <span style={{ fontSize:9, color:t.textMuted }}>{f.result_unit}</span>}
              </div>
              <button onClick={()=>handleTrial(f.id)} disabled={loading} style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:5, fontSize:10, fontWeight:600, cursor:'pointer', border:'1px solid '+t.accent+'30', background:t.accent+'10', color:t.accent }}><Play size={10}/>Trial</button>
            </div>
            <div style={{ fontSize:10, fontFamily:"'DM Mono',monospace", color:t.textDim, marginTop:4, padding:'3px 8px', background:t.card, borderRadius:4 }}>{f.expression}</div>
            {trialResult && trialResult.id === f.id && <div style={{ marginTop:6, padding:'6px 10px', borderRadius:6, background:trialResult.valid?'#00e5a010':'#f5365c10' }}>
              <span style={{ fontSize:11, fontWeight:700, fontFamily:"'DM Mono',monospace", color:trialResult.valid?'#00e5a0':'#f5365c' }}>
                {trialResult.valid ? `= ${trialResult.result}` : `Error: ${trialResult.error}`}
              </span>
            </div>}
          </div>)}
        </div>}
    </div>}
  </div>;
}
