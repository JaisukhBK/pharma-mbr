// client/src/components/MBRDesigner/MBRFeaturesToolbar.jsx
// Slim toolbar: XML Export/Import, Duplicate MBR, Mandatory Fields only
// Formulas → inside Operations | Documents + Voice → inside Co-Designer
import { useState, useRef } from 'react';
import { Download, Upload, Copy, Shield, Loader2, CheckCircle } from 'lucide-react';
import { featuresService } from '../../services/apiService';
import { Input, Select, Btn } from '../ui/PharmUI';

const BATCH_TYPES = ['Validation','Commercial','Production','Testing','Filing'];
const MARKETS = ['US','EU','India','Japan','China','Brazil','ROW','Global'];

export default function MBRFeaturesToolbar({ mbrId, mbr, onMbrUpdate, t, disabled }) {
  const [showMandatory, setShowMandatory] = useState(false);
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');
  const xmlRef = useRef(null);

  const handleExport = async () => {
    setLoading(true); setMsg('');
    try { await featuresService.exportXML(mbrId); setMsg('XML exported'); } catch(e) { setMsg('Error: '+e.message); }
    finally { setLoading(false); setTimeout(()=>setMsg(''),3000); }
  };
  const handleImport = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setLoading(true);
    try { const m = await featuresService.importXML(file); setMsg('Imported: '+m.mbr_code); if (onMbrUpdate) onMbrUpdate(m); }
    catch(e) { setMsg('Error: '+e.message); }
    finally { setLoading(false); if (xmlRef.current) xmlRef.current.value=''; }
  };
  const handleDuplicate = async () => {
    if (!confirm('Duplicate this entire MBR with all phases, steps, and parameters?')) return;
    setLoading(true);
    try { const m = await featuresService.duplicateMBR(mbrId); setMsg('Duplicated: '+m.mbr_code); } catch(e) { setMsg('Error: '+e.message); }
    finally { setLoading(false); }
  };

  return <div style={{ marginBottom:12 }}>
    <div style={{ display:'flex', alignItems:'center', gap:6, flexWrap:'wrap', padding:'8px 14px', background:t.card, border:'1px solid '+t.cardBorder, borderRadius:10 }}>
      <Btn t={t} size="sm" onClick={handleExport} disabled={loading}><Download size={12}/>Export XML</Btn>
      <input ref={xmlRef} type="file" accept=".xml" onChange={handleImport} style={{ display:'none' }}/>
      <Btn t={t} size="sm" onClick={()=>xmlRef.current?.click()} disabled={loading}><Upload size={12}/>Import XML</Btn>
      <div style={{ width:1, height:20, background:t.cardBorder, margin:'0 4px' }}/>
      <Btn t={t} size="sm" onClick={handleDuplicate} disabled={loading||disabled}><Copy size={12}/>Duplicate MBR</Btn>
      <div style={{ width:1, height:20, background:t.cardBorder, margin:'0 4px' }}/>
      <Btn t={t} size="sm" variant={showMandatory?'accent':'ghost'} onClick={()=>setShowMandatory(!showMandatory)}><Shield size={12}/>MBR Fields</Btn>
      <div style={{ flex:1 }}/>
      {loading && <Loader2 size={14} color={t.accent} style={{ animation:'spin 1s linear infinite' }}/>}
      {msg && <span style={{ fontSize:10, color:msg.includes('Error')?t.danger:t.success, fontFamily:"'DM Mono',monospace" }}>{msg}</span>}
    </div>

    {showMandatory && <MandatoryFieldsPanel mbr={mbr} mbrId={mbrId} t={t} disabled={disabled} onUpdate={onMbrUpdate}/>}
  </div>;
}

function MandatoryFieldsPanel({ mbr, mbrId, t, disabled, onUpdate }) {
  const [data, setData] = useState({ strength:mbr?.strength||'', market:mbr?.market||'', batch_type:mbr?.batch_type||'Production', sap_recipe_id:mbr?.sap_recipe_id||'', sap_material_number:mbr?.sap_material_number||'' });
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      const token = localStorage.getItem('pharma_mbr_token');
      const res = await fetch(`${import.meta.env.VITE_API_URL||''}/api/mbr/${mbrId}`, { method:'PUT', headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`}, body:JSON.stringify(data) });
      if (!res.ok) throw new Error('Save failed');
      const updated = await res.json();
      if (onUpdate) onUpdate(updated);
    } catch(e) { alert(e.message); } finally { setSaving(false); }
  };

  return <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:10, padding:16, marginTop:8, borderLeft:'3px solid '+t.accent }}>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
      <div style={{ display:'flex', alignItems:'center', gap:6 }}><Shield size={14} color={t.accent}/><span style={{ fontSize:13, fontWeight:700, color:t.text }}>MBR Mandatory Fields</span></div>
      <Btn t={t} size="sm" variant="primary" onClick={save} disabled={saving||disabled}>{saving?<Loader2 size={12} style={{animation:'spin 1s linear infinite'}}/>:<CheckCircle size={12}/>}Save</Btn>
    </div>
    <div style={{ fontSize:10, color:t.textMuted, marginBottom:12 }}>Sl No (auto) · MBR Code (auto) · Version (auto) · Strength · Batch Size · Market · Batch Type</div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
      <div><label style={{ color:t.textDim, fontSize:10, fontWeight:600, textTransform:'uppercase', marginBottom:3, display:'block' }}>Sl No</label><div style={{ background:t.bgAlt, padding:'7px 10px', borderRadius:6, fontSize:12, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{mbr?.sl_no||'Auto'}</div></div>
      <div><label style={{ color:t.textDim, fontSize:10, fontWeight:600, textTransform:'uppercase', marginBottom:3, display:'block' }}>MBR Code</label><div style={{ background:t.bgAlt, padding:'7px 10px', borderRadius:6, fontSize:12, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{mbr?.mbr_code||'—'}</div></div>
      <div><label style={{ color:t.textDim, fontSize:10, fontWeight:600, textTransform:'uppercase', marginBottom:3, display:'block' }}>Version</label><div style={{ background:t.bgAlt, padding:'7px 10px', borderRadius:6, fontSize:12, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>v{mbr?.current_version||1}</div></div>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginTop:8 }}>
      <Input size="sm" label="Strength" value={data.strength} onChange={v=>setData({...data,strength:v})} t={t} required placeholder="200mg" disabled={disabled}/>
      <Select size="sm" placeholder="Select..." label="Market" value={data.market} onChange={v=>setData({...data,market:v})} t={t} options={MARKETS} required/>
      <Select size="sm" placeholder="Select..." label="Batch Type" value={data.batch_type} onChange={v=>setData({...data,batch_type:v})} t={t} options={BATCH_TYPES} required/>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:4 }}>
      <Input size="sm" label="SAP Recipe ID (COOSPI)" value={data.sap_recipe_id} onChange={v=>setData({...data,sap_recipe_id:v})} t={t} placeholder="REC-001"/>
      <Input size="sm" label="SAP Material Number" value={data.sap_material_number} onChange={v=>setData({...data,sap_material_number:v})} t={t} placeholder="MAT-50001234"/>
    </div>
  </div>;
}
