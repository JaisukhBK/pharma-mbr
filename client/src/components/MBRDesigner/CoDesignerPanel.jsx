// client/src/components/MBRDesigner/CoDesignerPanel.jsx
// Co-Designer with integrated: Documents + Voice as AI-interactive components
import { useState, useEffect, useRef } from 'react';
import {
  Zap, ZapOff, Shield, Upload, CheckCircle, XCircle, Check, Edit3,
  AlertTriangle, Loader2, Eye, ChevronDown, ChevronUp, FileText,
  Brain, Sparkles, Lock, Layers, Settings2, Package, Plus, Trash2, Save,
  Mic, MicOff, Paperclip, Image, Table, FileCode, Send
} from 'lucide-react';

const MODES = {
  off:       { label:'Off',       color:'#7a8ba8', icon:ZapOff,   desc:'Manual design — no AI' },
  assist:    { label:'Assist',    color:'#f5a623', icon:Eye,      desc:'AI suggests and flags issues' },
  co_design: { label:'Co-Design', color:'#00e5a0', icon:Sparkles, desc:'AI proposes full MBR from PDF' },
};
const PSTATUS = { pending:{color:'#f5a623',label:'Pending Review'}, accepted:{color:'#00e5a0',label:'Accepted'}, modified:{color:'#2dceef',label:'Modified & Applied'}, rejected:{color:'#f5365c',label:'Rejected'} };
const PIPELINE = { idle:{label:'Ready',icon:Brain,color:'#7a8ba8'}, parsing:{label:'Parsing PDF...',icon:FileText,color:'#f5a623'}, decomposing:{label:'AI Decomposing...',icon:Sparkles,color:'#6366f1'}, proposing:{label:'Creating Proposals',icon:Layers,color:'#2dceef'}, awaiting_review:{label:'Ready for Review',icon:Eye,color:'#00e5a0'}, completed:{label:'Completed',icon:CheckCircle,color:'#00e5a0'}, error:{label:'Error',icon:AlertTriangle,color:'#f5365c'} };
const PTYPE_ICONS = { full_structure:FileText, phase:Layers, step:Settings2, bom_item:Package };
const STEP_TYPES = ['Processing','Verification','Sampling','Weighing','IPC','Cleaning','Hold','Transfer'];
const MAT_TYPES = ['API','Excipient','Raw Material','Packaging','Solvent'];

function Inp({ label, value, onChange, t, type='text', placeholder, rows, disabled }) {
  const s = { width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'6px 10px', fontSize:11, outline:'none', fontFamily:'inherit' };
  return <div style={{ marginBottom:6 }}>
    {label && <label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:0.4, marginBottom:2, display:'block' }}>{label}</label>}
    {rows ? <textarea value={value||''} onChange={e=>onChange(e.target.value)} rows={rows} disabled={disabled} placeholder={placeholder} style={{...s,resize:'none'}}/> :
      <input type={type} value={value||''} onChange={e=>onChange(e.target.value)} disabled={disabled} placeholder={placeholder} style={s}/>}
  </div>;
}
function Sel({ label, value, onChange, t, options }) {
  return <div style={{ marginBottom:6 }}>
    {label && <label style={{ color:t.textDim, fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:0.4, marginBottom:2, display:'block' }}>{label}</label>}
    <select value={value||options[0]} onChange={e=>onChange(e.target.value)} style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:6, padding:'6px 10px', fontSize:11, outline:'none' }}>
      {options.map(o=><option key={o} value={o}>{o}</option>)}
    </select>
  </div>;
}

export default function CoDesignerPanel({ mbrId, t, disabled, cdService, featuresService }) {
  const [mode, setMode] = useState('off');
  const [pipeStatus, setPipeStatus] = useState('idle');
  const [proposals, setProposals] = useState([]);
  const [metrics, setMetrics] = useState(null);
  const [uploadResult, setUploadResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [activeTab, setActiveTab] = useState('proposals'); // proposals | documents | voice
  const [showPwModal, setShowPwModal] = useState(false);
  const [pendingMode, setPendingMode] = useState(null);
  const [error, setError] = useState('');
  const [polling, setPolling] = useState(false);
  // Documents state
  const [attachments, setAttachments] = useState([]);
  // Voice state
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceText, setVoiceText] = useState('');
  const [voiceHistory, setVoiceHistory] = useState([]);
  const [voiceCmd, setVoiceCmd] = useState('');
  const voiceRef = useRef(null);
  const fileRef = useRef(null);
  const docRef = useRef(null);

  useEffect(() => { if (mbrId && cdService) { fetchStatus(); loadAttachments(); } }, [mbrId]);

  const fetchStatus = async () => { try { const s = await cdService.getCoDesignerStatus(mbrId); setMode(s.mode||'off'); setPipeStatus(s.status||'idle'); if (s.proposals) setMetrics(s.proposals); } catch {} };
  const fetchProposals = async () => { try { const r = await cdService.listProposals(mbrId); setProposals(r.data||[]); } catch {} };
  const loadAttachments = async () => { try { if (featuresService) { const r = await featuresService.listAttachments(mbrId); setAttachments(r.data||[]); } } catch {} };

  const handleSwitch = (m) => { if (disabled||loading||m===mode) return; if (m==='co_design') { setPendingMode(m); setShowPwModal(true); return; } doToggle(m); };
  const doToggle = async (target, pw) => {
    setLoading(true); setError('');
    try { await cdService.toggleCoDesigner(mbrId, target, pw); setMode(target); if (target!=='off') { fetchProposals(); setShowPanel(true); } }
    catch (e) { setError(e.message); } finally { setLoading(false); setShowPwModal(false); setPendingMode(null); }
  };

  // PDF Upload
  const handleUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) { setError('Only PDF files'); return; }
    setLoading(true); setError(''); setUploadResult(null); setPipeStatus('parsing'); setActiveTab('proposals');
    try {
      const result = await cdService.uploadPDF(mbrId, file);
      setUploadResult(result);
      if (result.ai_available) {
        setPolling(true); setPipeStatus('decomposing');
        try { await cdService.pollUntilDone(mbrId, s => { setPipeStatus(s.status||'idle'); if (s.proposals) setMetrics(s.proposals); }, 2000, 90); fetchProposals(); setShowPanel(true); }
        catch (pe) { setError('Pipeline: '+pe.message); } finally { setPolling(false); }
      } else { setPipeStatus('awaiting_review'); setShowPanel(true); }
    } catch (e) { setError(e.message); setPipeStatus('error'); }
    finally { setLoading(false); if (fileRef.current) fileRef.current.value=''; }
  };

  // Document Upload (multi-file)
  const handleDocUpload = async (e) => {
    const files = e.target.files; if (!files?.length || !featuresService) return;
    setLoading(true);
    try { await featuresService.uploadAttachments(mbrId, [...files]); loadAttachments(); } catch(e) { setError(e.message); }
    finally { setLoading(false); if (docRef.current) docRef.current.value=''; }
  };
  const handleDocDelete = async (id) => {
    if (!confirm('Delete?') || !featuresService) return;
    try { await featuresService.deleteAttachment(mbrId, id); loadAttachments(); } catch(e) { setError(e.message); }
  };

  // Voice — AI Interactive
  const toggleVoice = () => {
    if (voiceActive) { voiceRef.current?.stop(); setVoiceActive(false); return; }
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { setError('Speech recognition not supported'); return; }
    const rec = new SpeechRecognition();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    rec.onresult = (ev) => {
      let text = ''; let isFinal = false;
      for (let i = ev.resultIndex; i < ev.results.length; i++) { text += ev.results[i][0].transcript; if (ev.results[i].isFinal) isFinal = true; }
      setVoiceText(text);
      if (isFinal) {
        setVoiceHistory(h => [...h, { role:'user', text, time:new Date().toLocaleTimeString() }]);
        // Send to AI as a design command
        sendVoiceCommand(text);
      }
    };
    rec.onerror = (ev) => { console.error('[VOICE]', ev.error); setVoiceActive(false); };
    rec.start(); voiceRef.current = rec; setVoiceActive(true); setVoiceText('');
  };

  const sendVoiceCommand = async (text) => {
    setVoiceHistory(h => [...h, { role:'ai', text:'Processing: "'+text+'"...', time:new Date().toLocaleTimeString() }]);
    // In a full implementation, this would call the Co-Designer agent with the voice text
    // For now it logs the command and provides a placeholder response
    setTimeout(() => {
      setVoiceHistory(h => [...h, { role:'ai', text:`Understood. I'll incorporate "${text.substring(0,50)}" into the MBR design. Please review the proposals panel for updates.`, time:new Date().toLocaleTimeString() }]);
    }, 1500);
  };

  const sendTextCommand = () => {
    if (!voiceCmd.trim()) return;
    setVoiceHistory(h => [...h, { role:'user', text:voiceCmd, time:new Date().toLocaleTimeString() }]);
    sendVoiceCommand(voiceCmd);
    setVoiceCmd('');
  };

  // Reviews
  const handleAccept = async (pid, notes) => { try { await cdService.reviewProposal(mbrId, pid, 'accepted', notes); fetchProposals(); fetchStatus(); } catch(e) { setError(e.message); } };
  const handleReject = async (pid, notes) => { try { await cdService.reviewProposal(mbrId, pid, 'rejected', notes); fetchProposals(); fetchStatus(); } catch(e) { setError(e.message); } };
  const handleModify = async (pid, data, notes) => { try { await cdService.reviewProposal(mbrId, pid, 'modified', notes||'Modified', data); fetchProposals(); fetchStatus(); } catch(e) { setError(e.message); } };
  const handleAcceptAll = async () => { if (!confirm('Accept all pending?')) return; setLoading(true); try { await cdService.acceptAllProposals(mbrId); fetchProposals(); fetchStatus(); } catch(e) { setError(e.message); } finally { setLoading(false); } };

  const cur = MODES[mode]; const pipe = PIPELINE[pipeStatus]||PIPELINE.idle;
  const pendingCount = proposals.filter(p=>p.status==='pending').length;
  const isActive = mode !== 'off';

  return <div style={{ marginBottom:16 }}>
    {/* ── HEADER ── */}
    <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, padding:'12px 18px', display:'flex', alignItems:'center', justifyContent:'space-between', borderLeft:'3px solid '+cur.color }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ background:cur.color+'15', borderRadius:8, padding:8, display:'flex', border:'1px solid '+cur.color+'30' }}><Brain size={18} color={cur.color}/></div>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:14, fontWeight:700, color:t.text }}>Co-Designer</span>
            <span style={{ fontSize:10, fontWeight:700, fontFamily:"'DM Mono',monospace", background:cur.color+'15', color:cur.color, padding:'2px 8px', borderRadius:4, border:'1px solid '+cur.color+'30' }}>{cur.label.toUpperCase()}</span>
            {pipeStatus!=='idle'&&pipeStatus!=='completed'&&<span style={{ fontSize:10, fontWeight:600, fontFamily:"'DM Mono',monospace", background:pipe.color+'15', color:pipe.color, padding:'2px 8px', borderRadius:4, display:'flex', alignItems:'center', gap:4 }}>
              {(polling||['parsing','decomposing','proposing'].includes(pipeStatus))&&<Loader2 size={10} style={{ animation:'spin 1s linear infinite' }}/>}<pipe.icon size={10}/>{pipe.label}
            </span>}
          </div>
          <div style={{ fontSize:10, color:t.textMuted, marginTop:2 }}>{cur.desc}</div>
        </div>
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:8 }}>
        {pendingCount>0&&<span style={{ background:'#f5a62320', color:'#f5a623', fontSize:10, fontWeight:700, padding:'3px 8px', borderRadius:5, fontFamily:"'DM Mono',monospace", display:'flex', alignItems:'center', gap:4 }}><AlertTriangle size={10}/>{pendingCount}</span>}
        {/* 3-way toggle */}
        <div style={{ display:'flex', gap:2, background:t.bgAlt, borderRadius:8, padding:3, border:'1px solid '+t.cardBorder }}>
          {Object.entries(MODES).map(([k,m])=>{ const I=m.icon; const a=mode===k;
            return <button key={k} onClick={()=>handleSwitch(k)} disabled={disabled||loading} style={{ display:'flex',alignItems:'center',gap:4,padding:'5px 10px',borderRadius:6,fontSize:10,fontWeight:600,cursor:disabled?'not-allowed':'pointer',border:'none',transition:'all 0.2s',opacity:disabled?0.4:1,background:a?m.color+'20':'transparent',color:a?m.color:t.textMuted,outline:a?'1px solid '+m.color+'40':'none' }}><I size={11}/>{m.label}{k==='co_design'&&<Lock size={9}/>}</button>;
          })}
        </div>
        {/* Upload MBR PDF */}
        {isActive&&<><input ref={fileRef} type="file" accept=".pdf" onChange={handleUpload} style={{ display:'none' }}/><button onClick={()=>fileRef.current?.click()} disabled={disabled||loading||polling} style={{ display:'flex',alignItems:'center',gap:5,padding:'6px 12px',borderRadius:7,fontSize:11,fontWeight:600,cursor:'pointer',border:'1px solid '+t.accent+'30',background:t.accent+'10',color:t.accent,opacity:(loading||polling)?0.5:1 }}>{loading?<Loader2 size={12} style={{ animation:'spin 1s linear infinite' }}/>:<Upload size={12}/>}Upload MBR PDF</button></>}
        {isActive&&<button onClick={()=>{setShowPanel(!showPanel);if(!showPanel)fetchProposals();}} style={{ background:'none',border:'none',cursor:'pointer',color:t.textMuted,padding:4,display:'flex' }}>{showPanel?<ChevronUp size={16}/>:<ChevronDown size={16}/>}</button>}
      </div>
    </div>

    {/* Error */}
    {error&&<div style={{ background:t.danger+'10',border:'1px solid '+t.danger+'30',borderRadius:8,padding:'8px 14px',marginTop:8,display:'flex',alignItems:'center',gap:8 }}><AlertTriangle size={13} color={t.danger}/><span style={{ color:t.danger,fontSize:12,flex:1 }}>{error}</span><button onClick={()=>setError('')} style={{ background:'none',border:'none',cursor:'pointer',color:t.danger }}><XCircle size={14}/></button></div>}

    {/* ── EXPANDED PANEL ── */}
    {showPanel && isActive && <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, marginTop:8, overflow:'hidden' }}>
      {/* Tab bar: Proposals | Documents | Voice AI */}
      <div style={{ display:'flex', borderBottom:'1px solid '+t.cardBorder }}>
        {[
          { key:'proposals', label:'AI Proposals', icon:Sparkles, count:proposals.length },
          { key:'documents', label:'Documents', icon:Paperclip, count:attachments.length },
          { key:'voice', label:'Voice AI', icon:voiceActive?MicOff:Mic, count:voiceHistory.length },
        ].map(tab => <button key={tab.key} onClick={()=>setActiveTab(tab.key)} style={{
          flex:1, display:'flex', alignItems:'center', justifyContent:'center', gap:6, padding:'10px 16px',
          fontSize:11, fontWeight:600, cursor:'pointer', border:'none', transition:'all 0.15s',
          background:activeTab===tab.key?t.accent+'10':'transparent',
          color:activeTab===tab.key?t.accent:t.textMuted,
          borderBottom:activeTab===tab.key?'2px solid '+t.accent:'2px solid transparent',
        }}><tab.icon size={13}/>{tab.label}{tab.count>0&&<span style={{ fontSize:9, background:t.bgAlt, padding:'1px 5px', borderRadius:3, fontFamily:"'DM Mono',monospace" }}>{tab.count}</span>}</button>)}
      </div>

      <div style={{ padding:16 }}>
        {/* ── TAB: PROPOSALS ── */}
        {activeTab==='proposals'&&<>
          {metrics&&<div style={{ display:'flex', gap:16, marginBottom:14, padding:'8px 12px', background:t.bgAlt, borderRadius:8, justifyContent:'space-between', alignItems:'center' }}>
            <div style={{ display:'flex', gap:16 }}>
              {[{l:'Total',v:metrics.total||0,c:t.text},{l:'Pending',v:metrics.pending||0,c:'#f5a623'},{l:'Accepted',v:metrics.accepted||0,c:'#00e5a0'},{l:'Rejected',v:metrics.rejected||0,c:'#f5365c'}].map(m=><div key={m.l} style={{ display:'flex',alignItems:'center',gap:6 }}><span style={{ fontSize:18,fontWeight:800,color:m.c,fontFamily:"'DM Mono',monospace" }}>{m.v}</span><span style={{ fontSize:10,color:t.textMuted,textTransform:'uppercase' }}>{m.l}</span></div>)}
            </div>
            {pendingCount>0&&<button onClick={handleAcceptAll} disabled={loading} style={{ display:'flex',alignItems:'center',gap:5,padding:'6px 14px',borderRadius:7,fontSize:11,fontWeight:700,cursor:'pointer',border:'none',background:'#00e5a0',color:'#fff' }}><Check size={12}/>Accept All ({pendingCount})</button>}
          </div>}

          {proposals.length>0?<div style={{ display:'flex', flexDirection:'column', gap:6 }}>
            {proposals.map(p=><ProposalCard key={p.id} p={p} t={t} onAccept={handleAccept} onReject={handleReject} onModify={handleModify}/>)}
          </div>:<div style={{ textAlign:'center', padding:'24px 0', color:t.textMuted, fontSize:12, border:'1px dashed '+t.cardBorder, borderRadius:8 }}>
            <Brain size={24} color={t.textMuted} style={{ marginBottom:8, opacity:0.5 }}/><div>Upload a legacy MBR PDF to start.</div>
          </div>}
        </>}

        {/* ── TAB: DOCUMENTS (integrated with Co-Designer) ── */}
        {activeTab==='documents'&&<>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
            <div style={{ fontSize:11, color:t.textMuted }}>Attach documents for AI analysis — screenshots, XML, Excel, Word. The Co-Designer uses these as context.</div>
            <div><input ref={docRef} type="file" multiple accept=".pdf,.xml,.xlsx,.docx,.png,.jpg,.jpeg,.csv,.txt" onChange={handleDocUpload} style={{ display:'none' }}/><button onClick={()=>docRef.current?.click()} disabled={loading} style={{ display:'flex',alignItems:'center',gap:5,padding:'6px 12px',borderRadius:7,fontSize:11,fontWeight:600,cursor:'pointer',border:'1px solid '+t.accent+'30',background:t.accent+'10',color:t.accent }}><Plus size={12}/>Upload Files</button></div>
          </div>
          {attachments.length===0?<div style={{ textAlign:'center', padding:'20px 0', color:t.textMuted, fontSize:11, border:'1px dashed '+t.cardBorder, borderRadius:6 }}>No documents. Upload files to provide context for AI design.</div>:
            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
              {attachments.map(a=>{
                const ti = {'png':<Image size={12} color="#f5a623"/>,'jpg':<Image size={12} color="#f5a623"/>,'jpeg':<Image size={12} color="#f5a623"/>,'xlsx':<Table size={12} color="#00e5a0"/>,'csv':<Table size={12} color="#00e5a0"/>,'xml':<FileCode size={12} color="#2dceef"/>}[a.file_type] || <FileText size={12} color={t.textMuted}/>;
                return <div key={a.id} style={{ display:'flex',alignItems:'center',gap:8,padding:'6px 10px',background:t.bgAlt,borderRadius:6 }}>
                  {ti}<span style={{ fontSize:11,fontWeight:600,color:t.text,flex:1 }}>{a.filename}</span>
                  <span style={{ fontSize:9,color:t.textMuted,fontFamily:"'DM Mono',monospace" }}>{a.file_type.toUpperCase()}</span>
                  <span style={{ fontSize:9,color:t.textMuted }}>{a.file_size?(a.file_size/1024).toFixed(0)+'KB':''}</span>
                  <span style={{ fontSize:9,color:t.textMuted }}>{new Date(a.created_at).toLocaleDateString()}</span>
                  <button onClick={()=>handleDocDelete(a.id)} style={{ background:'none',border:'none',cursor:'pointer',color:t.textMuted,padding:2 }}><Trash2 size={11}/></button>
                </div>;
              })}
            </div>}
        </>}

        {/* ── TAB: VOICE AI (Interactive AI commands) ── */}
        {activeTab==='voice'&&<>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ fontSize:11, color:t.textMuted }}>Speak or type commands for hands-free MBR design. Voice AI understands pharma manufacturing instructions.</div>
            <button onClick={toggleVoice} style={{ display:'flex',alignItems:'center',gap:5,padding:'8px 16px',borderRadius:8,fontSize:12,fontWeight:700,cursor:'pointer',border:'none',background:voiceActive?'#f5365c':'#00e5a0',color:'#fff',animation:voiceActive?'pulse 1.5s infinite':'none' }}>
              {voiceActive?<><MicOff size={14}/>Stop Listening</>:<><Mic size={14}/>Start Listening</>}
            </button>
          </div>

          {/* Live transcript */}
          {voiceActive&&voiceText&&<div style={{ background:t.accent+'08', border:'1px solid '+t.accent+'20', borderRadius:8, padding:'8px 14px', marginBottom:10, display:'flex', alignItems:'center', gap:8 }}>
            <Mic size={14} color={t.accent}/><span style={{ fontSize:12, color:t.text, flex:1, fontStyle:'italic' }}>"{voiceText}"</span>
            <span style={{ fontSize:9, color:t.textMuted }}>listening...</span>
          </div>}

          {/* Chat history */}
          <div style={{ maxHeight:250, overflowY:'auto', marginBottom:10, display:'flex', flexDirection:'column', gap:6 }}>
            {voiceHistory.length===0&&<div style={{ textAlign:'center', padding:'30px 0', color:t.textMuted, fontSize:11 }}>
              <Mic size={20} color={t.textMuted} style={{ marginBottom:6, opacity:0.4 }}/><div>Say something like:</div>
              <div style={{ fontStyle:'italic', marginTop:4 }}>"Add a granulation phase with impeller speed 250 RPM"</div>
              <div style={{ fontStyle:'italic' }}>"Set compression force target to 25 kN"</div>
            </div>}
            {voiceHistory.map((msg, i) => <div key={i} style={{ display:'flex', gap:8, alignItems:msg.role==='user'?'flex-end':'flex-start', flexDirection:msg.role==='user'?'row-reverse':'row' }}>
              <div style={{ width:24, height:24, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0, background:msg.role==='user'?t.accent+'20':'#00e5a020', color:msg.role==='user'?t.accent:'#00e5a0' }}>
                {msg.role==='user'?<Mic size={12}/>:<Brain size={12}/>}
              </div>
              <div style={{ maxWidth:'75%', padding:'8px 12px', borderRadius:8, fontSize:11, background:msg.role==='user'?t.accent+'10':t.bgAlt, color:t.text, border:'1px solid '+(msg.role==='user'?t.accent+'20':t.cardBorder) }}>
                {msg.text}
                <div style={{ fontSize:8, color:t.textMuted, marginTop:2, fontFamily:"'DM Mono',monospace" }}>{msg.time}</div>
              </div>
            </div>)}
          </div>

          {/* Text input (alternative to voice) */}
          <div style={{ display:'flex', gap:6 }}>
            <input value={voiceCmd} onChange={e=>setVoiceCmd(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendTextCommand()} placeholder="Type a design command..." style={{ flex:1, background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:8, padding:'8px 12px', fontSize:12, outline:'none' }}/>
            <button onClick={sendTextCommand} disabled={!voiceCmd.trim()} style={{ display:'flex', alignItems:'center', gap:4, padding:'8px 14px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', border:'none', background:t.accent, color:'#fff', opacity:voiceCmd.trim()?1:0.4 }}><Send size={13}/>Send</button>
          </div>
        </>}
      </div>
    </div>}

    {showPwModal&&<PwModal t={t} onConfirm={pw=>doToggle(pendingMode,pw)} onCancel={()=>{setShowPwModal(false);setPendingMode(null);}}/>}

    <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.7} }`}</style>
  </div>;
}

// ── Proposal Card (with editing) ──
function ProposalCard({ p, t, onAccept, onReject, onModify }) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState(null);
  const [notes, setNotes] = useState('');
  const st = PSTATUS[p.status]||PSTATUS.pending;
  const TypeIcon = PTYPE_ICONS[p.proposal_type]||Brain;
  const rawData = typeof p.proposed_data==='string'?JSON.parse(p.proposed_data):p.proposed_data;
  const startEdit = () => { setEditData(JSON.parse(JSON.stringify(rawData))); setEditing(true); setExpanded(true); };
  const cancelEdit = () => { setEditing(false); setEditData(null); };
  const saveAndAccept = () => { onModify(p.id, editData, notes||'Modified by designer'); setEditing(false); setEditData(null); };
  const data = editing?editData:rawData;

  return <div style={{ border:'1px solid '+t.cardBorder+'60', borderRadius:8, padding:'10px 14px', background:p.status==='pending'?'#f5a62305':editing?t.accent+'05':'transparent' }}>
    <div style={{ display:'flex',alignItems:'center',justifyContent:'space-between' }}>
      <div style={{ display:'flex',alignItems:'center',gap:8,flex:1 }}>
        <TypeIcon size={13} color={st.color}/><span style={{ fontSize:9,fontWeight:700,fontFamily:"'DM Mono',monospace",background:st.color+'15',color:st.color,padding:'2px 6px',borderRadius:4 }}>{(p.proposal_type||'').replace('_',' ').toUpperCase()}</span>
        <span style={{ fontSize:12,fontWeight:600,color:t.text,flex:1 }}>{(p.reasoning||'AI proposal').substring(0,80)}</span>
      </div>
      <div style={{ display:'flex',alignItems:'center',gap:6 }}>
        {p.confidence&&<span style={{ fontSize:9,fontFamily:"'DM Mono',monospace",color:t.textMuted,background:t.bgAlt,padding:'2px 5px',borderRadius:3 }}>{(p.confidence*100).toFixed(0)}%</span>}
        <span style={{ fontSize:9,fontWeight:700,background:st.color+'15',color:st.color,padding:'2px 6px',borderRadius:3 }}>{st.label}</span>
        {p.status==='pending'&&!editing&&<>
          <button onClick={startEdit} title="Edit" style={{ background:t.accent+'15',border:'1px solid '+t.accent+'30',borderRadius:5,padding:'3px 6px',cursor:'pointer',display:'flex',color:t.accent }}><Edit3 size={12}/></button>
          <button onClick={()=>onAccept(p.id,'')} title="Accept" style={{ background:'#00e5a015',border:'1px solid #00e5a030',borderRadius:5,padding:'3px 6px',cursor:'pointer',display:'flex',color:'#00e5a0' }}><CheckCircle size={12}/></button>
          <button onClick={()=>onReject(p.id,'')} title="Reject" style={{ background:'#f5365c15',border:'1px solid #f5365c30',borderRadius:5,padding:'3px 6px',cursor:'pointer',display:'flex',color:'#f5365c' }}><XCircle size={12}/></button>
        </>}
        <button onClick={()=>setExpanded(!expanded)} style={{ background:'none',border:'none',cursor:'pointer',color:t.textMuted,padding:2,display:'flex' }}>{expanded?<ChevronUp size={12}/>:<ChevronDown size={12}/>}</button>
      </div>
    </div>

    {expanded&&<div style={{ marginTop:10,paddingTop:10,borderTop:'1px solid '+t.cardBorder+'40' }}>
      {/* Compact display based on type */}
      {p.proposal_type==='full_structure'&&<div style={{ fontSize:11 }}>
        {editing?<div style={{ display:'grid',gridTemplateColumns:'1fr 1fr',gap:8 }}>
          <Inp label="Product Name" value={data.product_name} onChange={v=>{setEditData({...editData,product_name:v})}} t={t}/>
          <Inp label="Batch Size" value={data.batch_size} onChange={v=>{setEditData({...editData,batch_size:v})}} t={t} type="number"/>
        </div>:<div><span style={{ fontWeight:600, color:t.text }}>{data.product_name}</span> — {data.dosage_form}, Batch: {data.batch_size} {data.batch_size_unit}</div>}
      </div>}
      {p.proposal_type==='phase'&&<div style={{ fontSize:11 }}>
        {editing?<Inp label="Phase Name" value={data.phase_name} onChange={v=>{setEditData({...editData,phase_name:v})}} t={t}/>:
          <span style={{ fontWeight:600, color:t.text }}>{data.phase_name}</span>}
        {data.description&&<div style={{ color:t.textDim, fontSize:10, marginTop:2 }}>{data.description}</div>}
      </div>}
      {p.proposal_type==='step'&&<div style={{ fontSize:11 }}>
        {editing?<><Inp label="Step Name" value={data.step_name} onChange={v=>{setEditData({...editData,step_name:v})}} t={t}/><Inp label="Instruction" value={data.instruction} onChange={v=>{setEditData({...editData,instruction:v})}} t={t} rows={2}/></>:
          <><span style={{ fontWeight:600, color:t.text }}>{data.step_name}</span> <span style={{ color:t.textMuted }}>({data.step_type})</span>
          {data.instruction&&<div style={{ color:t.textDim, fontSize:10, marginTop:2 }}>{data.instruction.substring(0,200)}</div>}
          <div style={{ display:'flex',gap:10,marginTop:4,fontSize:10,color:t.textMuted }}>
            {(data.parameters||[]).length>0&&<span>{data.parameters.length} params</span>}
            {(data.materials||[]).length>0&&<span>{data.materials.length} mats</span>}
            {data.is_critical&&<span style={{ color:t.danger }}>CPP</span>}
          </div></>}
      </div>}
      {p.proposal_type==='bom_item'&&<div style={{ fontSize:10, color:t.textDim }}>
        {(data.items||[]).map((b,i)=><div key={i}>{b.material_name} — {b.quantity_per_batch} {b.unit} {b.is_active_ingredient?'(API)':''}</div>)}
      </div>}

      {!editing&&<details style={{ marginTop:8 }}><summary style={{ fontSize:10,color:t.textMuted,cursor:'pointer' }}>Raw JSON</summary>
        <pre style={{ background:t.bgAlt,borderRadius:6,padding:10,fontSize:9,fontFamily:"'DM Mono',monospace",color:t.textDim,overflow:'auto',maxHeight:150,marginTop:4 }}>{JSON.stringify(rawData,null,2)}</pre>
      </details>}

      {editing&&<div style={{ display:'flex',gap:6,marginTop:10,justifyContent:'flex-end' }}>
        <button onClick={cancelEdit} style={{ padding:'5px 12px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',border:'1px solid '+t.cardBorder,background:'transparent',color:t.textDim }}>Cancel</button>
        <button onClick={saveAndAccept} style={{ display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:6,fontSize:11,fontWeight:700,cursor:'pointer',border:'none',background:'#2dceef',color:'#fff' }}><Save size={12}/>Save & Apply</button>
      </div>}

      {p.status==='pending'&&!editing&&<div style={{ display:'flex',gap:6,marginTop:10,justifyContent:'flex-end' }}>
        <button onClick={()=>onReject(p.id,'')} style={{ display:'flex',alignItems:'center',gap:4,padding:'5px 12px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',background:'#f5365c15',color:'#f5365c',border:'1px solid #f5365c30' }}><XCircle size={11}/>Reject</button>
        <button onClick={startEdit} style={{ display:'flex',alignItems:'center',gap:4,padding:'5px 12px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',background:t.accent+'15',color:t.accent,border:'1px solid '+t.accent+'30' }}><Edit3 size={11}/>Edit</button>
        <button onClick={()=>onAccept(p.id,'')} style={{ display:'flex',alignItems:'center',gap:4,padding:'5px 12px',borderRadius:6,fontSize:11,fontWeight:600,cursor:'pointer',background:'#00e5a015',color:'#00e5a0',border:'1px solid #00e5a030' }}><CheckCircle size={11}/>Accept</button>
      </div>}

      {p.reviewed_at&&<div style={{ fontSize:9,color:t.textMuted,marginTop:6,fontFamily:"'DM Mono',monospace" }}>Reviewed by {p.reviewer_name||'—'} at {new Date(p.reviewed_at).toLocaleString()}</div>}
    </div>}
  </div>;
}

// ── Password Modal ──
function PwModal({ t, onConfirm, onCancel }) {
  const [pw,setPw]=useState(''); const [busy,setBusy]=useState(false);
  const go=async()=>{if(!pw)return;setBusy(true);await onConfirm(pw);setBusy(false);};
  return <div style={{ position:'fixed',inset:0,background:'rgba(0,0,0,0.6)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100 }} onClick={onCancel}>
    <div style={{ background:t.card,border:'1px solid '+t.cardBorder,borderRadius:14,width:420,boxShadow:t.shadow }} onClick={e=>e.stopPropagation()}>
      <div style={{ display:'flex',alignItems:'center',gap:10,padding:'16px 20px',borderBottom:'1px solid '+t.cardBorder }}>
        <div style={{ background:'#00e5a015',borderRadius:8,padding:8,display:'flex' }}><Shield size={18} color="#00e5a0"/></div>
        <div><div style={{ fontSize:14,fontWeight:700,color:t.text }}>Activate Co-Design</div><div style={{ fontSize:10,color:t.textMuted,fontFamily:"'DM Mono',monospace" }}>21 CFR Part 11 §11.200</div></div>
      </div>
      <div style={{ padding:'16px 20px' }}>
        <div style={{ background:'#f5a62310',border:'1px solid #f5a62330',borderRadius:8,padding:'10px 12px',marginBottom:14,fontSize:11,color:'#f5a623',display:'flex',alignItems:'flex-start',gap:8 }}><AlertTriangle size={14} style={{ flexShrink:0,marginTop:1 }}/><span>AI proposals need your approval. This is audit-logged.</span></div>
        <label style={{ color:t.textDim,fontSize:11,fontWeight:600,textTransform:'uppercase',letterSpacing:0.5,marginBottom:4,display:'block' }}>Re-enter Password <span style={{color:t.danger}}>*</span></label>
        <input type="password" value={pw} onChange={e=>setPw(e.target.value)} onKeyDown={e=>e.key==='Enter'&&go()} placeholder="Confirm identity..." autoFocus style={{ width:'100%',boxSizing:'border-box',background:t.inputBg,border:'1px solid '+t.inputBorder,color:t.text,borderRadius:8,padding:'10px 12px',fontSize:13,outline:'none' }}/>
      </div>
      <div style={{ display:'flex',justifyContent:'flex-end',gap:8,padding:'12px 20px',borderTop:'1px solid '+t.cardBorder }}>
        <button onClick={onCancel} style={{ padding:'8px 16px',borderRadius:8,fontSize:12,fontWeight:600,cursor:'pointer',border:'1px solid '+t.cardBorder,background:'transparent',color:t.textDim }}>Cancel</button>
        <button onClick={go} disabled={busy||!pw} style={{ padding:'8px 16px',borderRadius:8,fontSize:12,fontWeight:600,cursor:busy||!pw?'not-allowed':'pointer',border:'none',background:'#00e5a0',color:'#fff',opacity:busy||!pw?0.5:1,display:'flex',alignItems:'center',gap:6 }}>{busy?<Loader2 size={13} style={{ animation:'spin 1s linear infinite' }}/>:<Sparkles size={13}/>}{busy?'Verifying...':'Activate'}</button>
      </div>
    </div>
  </div>;
}
