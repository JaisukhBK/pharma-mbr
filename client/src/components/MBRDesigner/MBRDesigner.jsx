// ============================================================================
// PharmaMES.AI — MBR Designer (ISA-88 / ISA-95 Compliant)
// Inline styles matching App.jsx ThemeContext | Drag & Drop | Part 11
// ============================================================================

import { mbrService } from '../../services/apiService';
import { DEMO_MBR, DEMO_BOM, DEMO_PHASES, DEMO_SIGNATURES } from './mbrDemoData';
import ApprovalWorkflowBar from './ApprovalWorkflowBar';
import VersionHistoryPanel from './VersionHistoryPanel';
import { useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
import {
  Shield, FileText, Plus, Trash2, ChevronDown, ChevronRight,
  GripVertical, AlertTriangle, CheckCircle, Clock, Lock, Unlock,
  Cpu, Settings2, PenTool, Eye, History, X, Save, RotateCcw,
  ArrowRight, Layers, Package, Hash, Loader2, Play, Pause,
  Move, Zap, Activity, Target, Beaker, FlaskConical, ChevronUp,
  Radio, Wifi, Database, Bell, ArrowUpDown, Link2, Server, Gauge,
  TestTube, Calculator, Droplets, Thermometer, ClipboardCheck, Scale
} from "lucide-react";

// ISA-88 Recipe Hierarchy:
// Procedure (MBR) → Unit Procedure (Phase) → Operation (Step) → Phase (Sub-step)
// We map: MBR = Procedure, Phase = Unit Procedure, Step = Operation

const createId = () => crypto.randomUUID();

const DOSAGE_FORMS = ["Tablet", "Capsule", "Injectable", "Oral Liquid", "Topical", "Powder", "Lyophilized"];
const STEP_TYPES = ["Processing", "Verification", "Sampling", "Weighing", "IPC", "Cleaning", "Hold", "Transfer"];
const MATERIAL_TYPES = ["API", "Excipient", "Raw Material", "Packaging", "Solvent"];
const EQUIPMENT_TYPES = ["Reactor", "Granulator", "Tablet Press", "Coater", "Blender", "FBD", "Mill", "Autoclave", "Homogenizer"];
const SIGNATURE_ROLES = [
  { role: "Author", meaning: "I authored this Master Batch Record" },
  { role: "Reviewer", meaning: "I have reviewed and verified the content" },
  { role: "Approver", meaning: "I approve this MBR for manufacturing use" },
  { role: "QA_Approver", meaning: "QA final approval for production release" },
];

const STATUS_META = {
  Draft:        { color: '#f5a623', icon: PenTool },
  'In Review':  { color: '#2dceef', icon: Eye },
  Approved:     { color: '#00e5a0', icon: CheckCircle },
  Effective:    { color: '#00e5a0', icon: Shield },
  Superseded:   { color: '#7a8ba8', icon: RotateCcw },
  Obsolete:     { color: '#f5365c', icon: X },
};

// ════════════════════════════════════════════════════════════════════════════
// SHARED UI HELPERS (inline styles, theme-aware)
// ════════════════════════════════════════════════════════════════════════════

function MBRBadge({ children, color, t }) {
  return <span style={{ display:'inline-flex', alignItems:'center', gap:4, background:color+'15', border:'1px solid '+color+'30', color, borderRadius:5, padding:'2px 9px', fontSize:11, fontWeight:600 }}>{children}</span>;
}

function MBRStatusBadge({ status, t }) {
  const meta = STATUS_META[status] || STATUS_META.Draft;
  const Icon = meta.icon;
  return <MBRBadge color={meta.color} t={t}><Icon size={11}/>{status}</MBRBadge>;
}

function MBRCard({ children, t, style }) {
  return <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, padding:18, ...style }}>{children}</div>;
}

function MBRBtn({ children, t, variant='primary', size='md', disabled, ...props }) {
  const base = { border:'none', borderRadius:8, cursor: disabled?'not-allowed':'pointer', fontWeight:600, display:'inline-flex', alignItems:'center', gap:6, fontSize: size==='sm'?12:13, padding: size==='sm'?'5px 12px':'9px 18px', opacity: disabled?0.4:1, transition:'all 0.2s' };
  const v = {
    primary: { background:t.accent, color:'#fff' },
    ghost: { background:'transparent', color:t.textDim, border:'1px solid '+t.cardBorder },
    danger: { background:t.danger+'15', color:t.danger, border:'1px solid '+t.danger+'30' },
    accent: { background:t.accent+'15', color:t.accent, border:'1px solid '+t.accent+'30' },
  };
  return <button {...props} disabled={disabled} style={{ ...base, ...v[variant], ...props.style }}>{children}</button>;
}

function MBRInput({ label, t, required, unit, ...props }) {
  return <div style={{ marginBottom:10 }}>
    <label style={{ color:t.textDim, fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4, display:'block' }}>
      {label} {required && <span style={{color:t.danger}}>*</span>}
    </label>
    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
      <input {...props} style={{ flex:1, boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:8, padding:'9px 12px', fontSize:13, outline:'none', ...props.style }} />
      {unit && <span style={{ color:t.textMuted, fontSize:11, fontFamily:"'DM Mono',monospace" }}>{unit}</span>}
    </div>
  </div>;
}

function MBRSelect({ label, t, options, required, ...props }) {
  return <div style={{ marginBottom:10 }}>
    <label style={{ color:t.textDim, fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4, display:'block' }}>
      {label} {required && <span style={{color:t.danger}}>*</span>}
    </label>
    <select {...props} style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:8, padding:'9px 12px', fontSize:13, outline:'none', ...props.style }}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  </div>;
}

function ToggleChip({ label, active, onClick, color, t }) {
  const c = active ? (color || t.accent) : t.textMuted;
  return <button onClick={onClick} style={{ background: active ? c+'18' : 'transparent', border:'1px solid '+(active ? c+'40' : t.cardBorder), color: c, borderRadius:5, padding:'2px 8px', fontSize:10, fontWeight:700, fontFamily:"'DM Mono',monospace", cursor:'pointer', transition:'all 0.15s' }}>{label}</button>;
}

function SectionTitle({ icon: Icon, title, count, t, right }) {
  return <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:12 }}>
    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
      <div style={{ background:t.accent+'12', borderRadius:7, padding:6, display:'flex' }}><Icon size={15} color={t.accent}/></div>
      <span style={{ color:t.text, fontSize:14, fontWeight:700 }}>{title}</span>
      {count !== undefined && <span style={{ background:t.bgAlt, color:t.textMuted, fontSize:10, fontFamily:"'DM Mono',monospace", padding:'1px 7px', borderRadius:4 }}>{count}</span>}
    </div>
    {right}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// ISA-88 PROCESS FLOW VISUALIZATION
// ════════════════════════════════════════════════════════════════════════════

function ProcessFlowBar({ phases, currentPhase, t }) {
  if (!phases || phases.length === 0) return null;
  return <div style={{ display:'flex', alignItems:'center', gap:0, marginBottom:20, padding:'12px 16px', background:t.bgAlt, borderRadius:10, border:'1px solid '+t.cardBorder, overflowX:'auto' }}>
    {phases.map((phase, idx) => {
      const isActive = currentPhase === phase.id;
      const stepCount = phase.steps?.length || 0;
      const criticalSteps = (phase.steps || []).filter(s => s.is_critical).length;
      return <div key={phase.id} style={{ display:'flex', alignItems:'center' }}>
        <div onClick={() => {}} style={{
          display:'flex', flexDirection:'column', alignItems:'center', padding:'8px 16px', borderRadius:8, cursor:'pointer', transition:'all 0.2s',
          background: isActive ? t.accent+'15' : 'transparent', border: isActive ? '1px solid '+t.accent+'30' : '1px solid transparent',
          minWidth:100
        }}>
          <div style={{ display:'flex', alignItems:'center', gap:5, marginBottom:3 }}>
            <div style={{ width:22, height:22, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, fontFamily:"'DM Mono',monospace", background: isActive ? t.accent : t.cardBorder, color: isActive ? '#fff' : t.textDim }}>{idx+1}</div>
            <span style={{ fontSize:12, fontWeight:600, color: isActive ? t.text : t.textDim, maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{phase.phase_name || 'Unnamed'}</span>
          </div>
          <div style={{ display:'flex', gap:6, fontSize:10, color:t.textMuted }}>
            <span>{stepCount} ops</span>
            {criticalSteps > 0 && <span style={{ color:t.danger }}>{criticalSteps} CPP</span>}
          </div>
        </div>
        {idx < phases.length - 1 && <div style={{ width:24, height:2, background:t.cardBorder, margin:'0 2px' }}><div style={{ width:'100%', height:'100%', background:t.accent+'40' }}/></div>}
      </div>;
    })}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// PARAMETER ROW (actuals vs targets)
// ════════════════════════════════════════════════════════════════════════════

function ParamRow({ param, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.7fr 0.5fr 0.5fr 0.5fr auto auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'40' }}>
    <MBRInput label="Parameter" t={t} value={param.param_name} onChange={e => onUpdate({ ...param, param_name:e.target.value })} disabled={disabled} placeholder="e.g. Temperature" />
    <MBRInput label="Target" t={t} value={param.target_value} onChange={e => onUpdate({ ...param, target_value:e.target.value })} disabled={disabled} placeholder="60" />
    <MBRInput label="Unit" t={t} value={param.unit} onChange={e => onUpdate({ ...param, unit:e.target.value })} disabled={disabled} placeholder="°C" />
    <MBRInput label="Low" t={t} value={param.lower_limit} onChange={e => onUpdate({ ...param, lower_limit:e.target.value })} disabled={disabled} type="number" />
    <MBRInput label="High" t={t} value={param.upper_limit} onChange={e => onUpdate({ ...param, upper_limit:e.target.value })} disabled={disabled} type="number" />
    <div style={{ display:'flex', gap:4, paddingBottom:12 }}>
      <ToggleChip label="CPP" active={param.is_cpp} onClick={() => onUpdate({ ...param, is_cpp:!param.is_cpp })} color={t.danger} t={t} />
      <ToggleChip label="CQA" active={param.is_cqa} onClick={() => onUpdate({ ...param, is_cqa:!param.is_cqa })} color={t.warning} t={t} />
    </div>
    {!disabled && <button onClick={() => onDelete(param.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// MATERIAL ROW
// ════════════════════════════════════════════════════════════════════════════

function MaterialRow({ mat, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 0.8fr 0.5fr 0.4fr auto auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'40' }}>
    <MBRInput label="Code" t={t} value={mat.material_code} onChange={e => onUpdate({ ...mat, material_code:e.target.value })} disabled={disabled} placeholder="RM-001" />
    <MBRInput label="Name" t={t} value={mat.material_name} onChange={e => onUpdate({ ...mat, material_name:e.target.value })} disabled={disabled} placeholder="Microcrystalline Cellulose" />
    <MBRSelect label="Type" t={t} value={mat.material_type} onChange={e => onUpdate({ ...mat, material_type:e.target.value })} options={MATERIAL_TYPES} disabled={disabled} />
    <MBRInput label="Qty" t={t} value={mat.quantity} onChange={e => onUpdate({ ...mat, quantity:e.target.value })} disabled={disabled} type="number" />
    <MBRInput label="Unit" t={t} value={mat.unit} onChange={e => onUpdate({ ...mat, unit:e.target.value })} disabled={disabled} placeholder="kg" />
    <div style={{ paddingBottom:12 }}><ToggleChip label="API" active={mat.is_active} onClick={() => onUpdate({ ...mat, is_active:!mat.is_active })} color={t.danger} t={t} /></div>
    {!disabled && <button onClick={() => onDelete(mat.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// EQUIPMENT ROW
// ════════════════════════════════════════════════════════════════════════════

function EquipmentRow({ eq, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'0.7fr 1.5fr 0.8fr 0.6fr auto auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'40' }}>
    <MBRInput label="Code" t={t} value={eq.equipment_code} onChange={e => onUpdate({ ...eq, equipment_code:e.target.value })} disabled={disabled} placeholder="EQ-GRN-001" />
    <MBRInput label="Name" t={t} value={eq.equipment_name} onChange={e => onUpdate({ ...eq, equipment_name:e.target.value })} disabled={disabled} placeholder="High-Shear Granulator" />
    <MBRSelect label="Type" t={t} value={eq.equipment_type} onChange={e => onUpdate({ ...eq, equipment_type:e.target.value })} options={EQUIPMENT_TYPES} disabled={disabled} />
    <MBRInput label="Capacity" t={t} value={eq.capacity} onChange={e => onUpdate({ ...eq, capacity:e.target.value })} disabled={disabled} placeholder="300L" />
    <div style={{ paddingBottom:12 }}><ToggleChip label="Primary" active={eq.is_primary} onClick={() => onUpdate({ ...eq, is_primary:!eq.is_primary })} t={t} /></div>
    {!disabled && <button onClick={() => onDelete(eq.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// ISA-95 LEVEL 2 CONFIGURATION (SCADA/DCS/PLC Integration Layer)
// ════════════════════════════════════════════════════════════════════════════

const OPC_DATA_TYPES = ['Double', 'Float', 'Int32', 'Int16', 'Boolean', 'String', 'DateTime'];
const OPC_ACCESS = ['Read', 'Write', 'ReadWrite'];
const ALARM_PRIORITIES = ['Low', 'Medium', 'High', 'Critical', 'Emergency'];
const ALARM_TYPES = ['HiHi', 'Hi', 'Lo', 'LoLo', 'Deviation', 'Rate of Change'];
const HISTORIAN_MODES = ['Continuous', 'On Change', 'Periodic', 'Event-Driven'];
const SETPOINT_MODES = ['Auto Push', 'Manual Confirm', 'Operator Verify', 'Disabled'];
const CONTROL_MODULE_TYPES = ['PID Loop', 'Sequence', 'Interlock', 'Discrete', 'Regulatory', 'Advanced'];

function OpcUaTagRow({ tag, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1.2fr 2fr 0.7fr 0.7fr 0.6fr auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
    <MBRInput label="Tag Name" t={t} value={tag.tag_name} onChange={e => onUpdate({ ...tag, tag_name:e.target.value })} disabled={disabled} placeholder="TT-101.PV" />
    <MBRInput label="OPC-UA Node ID" t={t} value={tag.node_id} onChange={e => onUpdate({ ...tag, node_id:e.target.value })} disabled={disabled} placeholder="ns=2;s=PLC1.Granulator.TT101.PV" />
    <MBRSelect label="Data Type" t={t} value={tag.data_type} onChange={e => onUpdate({ ...tag, data_type:e.target.value })} options={OPC_DATA_TYPES} disabled={disabled} />
    <MBRSelect label="Access" t={t} value={tag.access} onChange={e => onUpdate({ ...tag, access:e.target.value })} options={OPC_ACCESS} disabled={disabled} />
    <MBRInput label="Eng Unit" t={t} value={tag.eng_unit} onChange={e => onUpdate({ ...tag, eng_unit:e.target.value })} disabled={disabled} placeholder="°C" />
    {!disabled && <button onClick={() => onDelete(tag.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

function ControlModuleRow({ cm, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1.5fr 0.8fr auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
    <MBRInput label="Module ID" t={t} value={cm.module_id} onChange={e => onUpdate({ ...cm, module_id:e.target.value })} disabled={disabled} placeholder="CM-GRN-TIC-101" />
    <MBRInput label="Module Name" t={t} value={cm.module_name} onChange={e => onUpdate({ ...cm, module_name:e.target.value })} disabled={disabled} placeholder="Granulator Temp Control" />
    <MBRSelect label="Type" t={t} value={cm.module_type} onChange={e => onUpdate({ ...cm, module_type:e.target.value })} options={CONTROL_MODULE_TYPES} disabled={disabled} />
    <MBRInput label="Equipment Phase" t={t} value={cm.equipment_phase} onChange={e => onUpdate({ ...cm, equipment_phase:e.target.value })} disabled={disabled} placeholder="e.g. Heat_Up, Mix, Dry" />
    <div style={{ display:'flex', gap:4, paddingBottom:12 }}>
      <ToggleChip label="Active" active={cm.is_active} onClick={() => onUpdate({ ...cm, is_active:!cm.is_active })} t={t} />
    </div>
    {!disabled && <button onClick={() => onDelete(cm.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

function AlarmConfigRow({ alarm, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1.2fr 0.8fr 0.8fr 0.7fr 0.6fr 0.6fr auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
    <MBRInput label="Tag Reference" t={t} value={alarm.tag_ref} onChange={e => onUpdate({ ...alarm, tag_ref:e.target.value })} disabled={disabled} placeholder="TT-101.PV" />
    <MBRSelect label="Alarm Type" t={t} value={alarm.alarm_type} onChange={e => onUpdate({ ...alarm, alarm_type:e.target.value })} options={ALARM_TYPES} disabled={disabled} />
    <MBRInput label="Setpoint" t={t} value={alarm.setpoint} onChange={e => onUpdate({ ...alarm, setpoint:e.target.value })} disabled={disabled} type="number" placeholder="65" />
    <MBRInput label="Deadband" t={t} value={alarm.deadband} onChange={e => onUpdate({ ...alarm, deadband:e.target.value })} disabled={disabled} type="number" placeholder="0.5" />
    <MBRSelect label="Priority" t={t} value={alarm.priority} onChange={e => onUpdate({ ...alarm, priority:e.target.value })} options={ALARM_PRIORITIES} disabled={disabled} />
    <MBRInput label="Delay (s)" t={t} value={alarm.delay_sec} onChange={e => onUpdate({ ...alarm, delay_sec:e.target.value })} disabled={disabled} type="number" placeholder="5" />
    {!disabled && <button onClick={() => onDelete(alarm.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

function HistorianTagRow({ htag, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1.2fr 1.5fr 0.8fr 0.7fr 0.7fr auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
    <MBRInput label="Tag Name" t={t} value={htag.tag_name} onChange={e => onUpdate({ ...htag, tag_name:e.target.value })} disabled={disabled} placeholder="TT-101.PV" />
    <MBRInput label="Historian Path" t={t} value={htag.historian_path} onChange={e => onUpdate({ ...htag, historian_path:e.target.value })} disabled={disabled} placeholder="\\\\PISERVER\\GRN.TT101.PV" />
    <MBRSelect label="Collection" t={t} value={htag.collection_mode} onChange={e => onUpdate({ ...htag, collection_mode:e.target.value })} options={HISTORIAN_MODES} disabled={disabled} />
    <MBRInput label="Interval" t={t} value={htag.interval_sec} onChange={e => onUpdate({ ...htag, interval_sec:e.target.value })} disabled={disabled} type="number" unit="sec" placeholder="10" />
    <div style={{ display:'flex', gap:4, paddingBottom:12 }}>
      <ToggleChip label="Archive" active={htag.archive_enabled} onClick={() => onUpdate({ ...htag, archive_enabled:!htag.archive_enabled })} t={t} />
      <ToggleChip label="Compress" active={htag.compression} onClick={() => onUpdate({ ...htag, compression:!htag.compression })} color={t.info} t={t} />
    </div>
    {!disabled && <button onClick={() => onDelete(htag.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

function SetpointConfigRow({ sp, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1fr 1.5fr 0.7fr 0.7fr 0.8fr auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
    <MBRInput label="Parameter" t={t} value={sp.param_name} onChange={e => onUpdate({ ...sp, param_name:e.target.value })} disabled={disabled} placeholder="Temperature" />
    <MBRInput label="Target OPC Tag" t={t} value={sp.target_tag} onChange={e => onUpdate({ ...sp, target_tag:e.target.value })} disabled={disabled} placeholder="ns=2;s=PLC1.GRN.TIC101.SP" />
    <MBRInput label="Value" t={t} value={sp.setpoint_value} onChange={e => onUpdate({ ...sp, setpoint_value:e.target.value })} disabled={disabled} type="number" placeholder="60" />
    <MBRInput label="Unit" t={t} value={sp.unit} onChange={e => onUpdate({ ...sp, unit:e.target.value })} disabled={disabled} placeholder="°C" />
    <MBRSelect label="Push Mode" t={t} value={sp.push_mode} onChange={e => onUpdate({ ...sp, push_mode:e.target.value })} options={SETPOINT_MODES} disabled={disabled} />
    {!disabled && <button onClick={() => onDelete(sp.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

function L2ConfigPanel({ l2Config, onUpdate, t, disabled }) {
  const [activeL2, setActiveL2] = useState('opcua');
  const cfg = l2Config || { opc_tags:[], control_modules:[], alarms:[], historian_tags:[], setpoints:[] };

  const addOpc = () => onUpdate({ ...cfg, opc_tags:[...cfg.opc_tags, { id:createId(), tag_name:'', node_id:'', data_type:'Double', access:'Read', eng_unit:'' }] });
  const addCM = () => onUpdate({ ...cfg, control_modules:[...cfg.control_modules, { id:createId(), module_id:'', module_name:'', module_type:'PID Loop', equipment_phase:'', is_active:true }] });
  const addAlarm = () => onUpdate({ ...cfg, alarms:[...cfg.alarms, { id:createId(), tag_ref:'', alarm_type:'Hi', setpoint:'', deadband:'', priority:'Medium', delay_sec:'5' }] });
  const addHist = () => onUpdate({ ...cfg, historian_tags:[...cfg.historian_tags, { id:createId(), tag_name:'', historian_path:'', collection_mode:'Continuous', interval_sec:'10', archive_enabled:true, compression:true }] });
  const addSP = () => onUpdate({ ...cfg, setpoints:[...cfg.setpoints, { id:createId(), param_name:'', target_tag:'', setpoint_value:'', unit:'', push_mode:'Manual Confirm' }] });

  const l2Tabs = [
    { key:'opcua', label:'OPC-UA Tags', icon:Radio, count:cfg.opc_tags?.length||0 },
    { key:'cm', label:'Control Modules', icon:Server, count:cfg.control_modules?.length||0 },
    { key:'setpoints', label:'Setpoint Push', icon:ArrowUpDown, count:cfg.setpoints?.length||0 },
    { key:'alarms', label:'Alarm Config', icon:Bell, count:cfg.alarms?.length||0 },
    { key:'historian', label:'Historian Tags', icon:Database, count:cfg.historian_tags?.length||0 },
  ];

  return <div>
    {/* L2 Header */}
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, padding:'8px 12px', background:t.info+'08', borderRadius:8, border:'1px solid '+t.info+'20' }}>
      <Wifi size={14} color={t.info}/>
      <span style={{ fontSize:11, fontWeight:700, color:t.info, textTransform:'uppercase', letterSpacing:0.5 }}>ISA-95 Level 2 — Process Control Integration</span>
      <span style={{ fontSize:10, color:t.textMuted, marginLeft:'auto', fontFamily:"'DM Mono',monospace" }}>
        {(cfg.opc_tags?.length||0)+(cfg.control_modules?.length||0)+(cfg.alarms?.length||0)+(cfg.historian_tags?.length||0)+(cfg.setpoints?.length||0)} total mappings
      </span>
    </div>

    {/* L2 Sub-tabs */}
    <div style={{ display:'flex', gap:2, borderBottom:'1px solid '+t.cardBorder, marginBottom:10 }}>
      {l2Tabs.map(tb => <button key={tb.key} onClick={() => setActiveL2(tb.key)} style={{
        display:'flex', alignItems:'center', gap:4, padding:'6px 10px', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:0.4,
        background:'transparent', border:'none', borderBottom: activeL2===tb.key ? '2px solid '+t.info : '2px solid transparent',
        color: activeL2===tb.key ? t.info : t.textMuted, cursor:'pointer', transition:'all 0.15s'
      }}><tb.icon size={11}/>{tb.label}<span style={{ background:t.bgAlt, padding:'0 4px', borderRadius:3, fontSize:9 }}>{tb.count}</span></button>)}
    </div>

    {/* OPC-UA Tags */}
    {activeL2 === 'opcua' && <div>
      <div style={{ fontSize:10, color:t.textMuted, marginBottom:8 }}>Map OPC-UA tags from SCADA/DCS/PLC to this operation. Tags are used for real-time data collection and setpoint writes.</div>
      {(cfg.opc_tags||[]).map(tag => <OpcUaTagRow key={tag.id} tag={tag} t={t} disabled={disabled}
        onUpdate={u => onUpdate({ ...cfg, opc_tags:cfg.opc_tags.map(x => x.id===tag.id?u:x) })}
        onDelete={id => onUpdate({ ...cfg, opc_tags:cfg.opc_tags.filter(x => x.id!==id) })} />)}
      {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addOpc} style={{marginTop:8}}><Plus size={12}/>Add OPC-UA Tag</MBRBtn>}
    </div>}

    {/* Control Modules */}
    {activeL2 === 'cm' && <div>
      <div style={{ fontSize:10, color:t.textMuted, marginBottom:8 }}>ISA-88 Control Modules — bind equipment-level control logic (PID loops, sequences, interlocks) to this operation.</div>
      {(cfg.control_modules||[]).map(cm => <ControlModuleRow key={cm.id} cm={cm} t={t} disabled={disabled}
        onUpdate={u => onUpdate({ ...cfg, control_modules:cfg.control_modules.map(x => x.id===cm.id?u:x) })}
        onDelete={id => onUpdate({ ...cfg, control_modules:cfg.control_modules.filter(x => x.id!==id) })} />)}
      {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addCM} style={{marginTop:8}}><Plus size={12}/>Add Control Module</MBRBtn>}
    </div>}

    {/* Setpoint Push */}
    {activeL2 === 'setpoints' && <div>
      <div style={{ fontSize:10, color:t.textMuted, marginBottom:8 }}>Configure automatic setpoint push from MBR target values to DCS/SCADA. Supports Auto Push, Manual Confirm, or Operator Verify modes.</div>
      {(cfg.setpoints||[]).map(sp => <SetpointConfigRow key={sp.id} sp={sp} t={t} disabled={disabled}
        onUpdate={u => onUpdate({ ...cfg, setpoints:cfg.setpoints.map(x => x.id===sp.id?u:x) })}
        onDelete={id => onUpdate({ ...cfg, setpoints:cfg.setpoints.filter(x => x.id!==id) })} />)}
      {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addSP} style={{marginTop:8}}><Plus size={12}/>Add Setpoint Config</MBRBtn>}
    </div>}

    {/* Alarm Config */}
    {activeL2 === 'alarms' && <div>
      <div style={{ fontSize:10, color:t.textMuted, marginBottom:8 }}>Configure alarm limits per parameter. Alarms trigger during EBR execution when actual values breach configured setpoints.</div>
      {(cfg.alarms||[]).map(a => <AlarmConfigRow key={a.id} alarm={a} t={t} disabled={disabled}
        onUpdate={u => onUpdate({ ...cfg, alarms:cfg.alarms.map(x => x.id===a.id?u:x) })}
        onDelete={id => onUpdate({ ...cfg, alarms:cfg.alarms.filter(x => x.id!==id) })} />)}
      {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addAlarm} style={{marginTop:8}}><Plus size={12}/>Add Alarm</MBRBtn>}
    </div>}

    {/* Historian Tags */}
    {activeL2 === 'historian' && <div>
      <div style={{ fontSize:10, color:t.textMuted, marginBottom:8 }}>Map historian tags (OSIsoft PI, Wonderware, etc.) for automatic data collection during batch execution.</div>
      {(cfg.historian_tags||[]).map(ht => <HistorianTagRow key={ht.id} htag={ht} t={t} disabled={disabled}
        onUpdate={u => onUpdate({ ...cfg, historian_tags:cfg.historian_tags.map(x => x.id===ht.id?u:x) })}
        onDelete={id => onUpdate({ ...cfg, historian_tags:cfg.historian_tags.filter(x => x.id!==id) })} />)}
      {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addHist} style={{marginTop:8}}><Plus size={12}/>Add Historian Tag</MBRBtn>}
    </div>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// IPC CHECK ROW (In-Process Control check per operation)
// ════════════════════════════════════════════════════════════════════════════

const IPC_CHECK_TYPES = ['Visual', 'Gravimetric', 'HPLC', 'UV-Vis', 'Dissolution', 'Sieve Analysis', 'Karl Fischer', 'pH', 'Conductivity', 'Particle Count', 'Hardness', 'Friability', 'Disintegration', 'Leak Test'];
const IPC_FREQUENCIES = ['Start of batch', 'End of step', 'Every 15 min', 'Every 30 min', 'Every 1 hour', 'Every 2 hours', 'Each unit', 'Per sublot', 'Beginning/Middle/End', '10 locations', 'Composite'];

function IPCCheckRow({ check, onUpdate, onDelete, t, disabled }) {
  return <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 1.2fr 0.8fr auto', gap:8, alignItems:'end', padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
    <MBRInput label="Check Name" t={t} value={check.check_name} onChange={e => onUpdate({ ...check, check_name:e.target.value })} disabled={disabled} placeholder="e.g. Blend Uniformity" />
    <MBRSelect label="Type" t={t} value={check.check_type} onChange={e => onUpdate({ ...check, check_type:e.target.value })} options={IPC_CHECK_TYPES} disabled={disabled} />
    <MBRInput label="Specification" t={t} value={check.specification} onChange={e => onUpdate({ ...check, specification:e.target.value })} disabled={disabled} placeholder="e.g. RSD ≤ 5%" />
    <MBRSelect label="Frequency" t={t} value={check.frequency} onChange={e => onUpdate({ ...check, frequency:e.target.value })} options={IPC_FREQUENCIES} disabled={disabled} />
    {!disabled && <button onClick={() => onDelete(check.id)} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// YIELD CALCULATION RULE (per Unit Procedure / Phase)
// ════════════════════════════════════════════════════════════════════════════

function YieldRulePanel({ yieldConfig, onUpdate, t, disabled }) {
  const cfg = yieldConfig || { theoretical_formula:'', expected_yield_pct:'', acceptable_range_low:'', acceptable_range_high:'', reconciliation_items:[] };

  const addReconItem = () => onUpdate({ ...cfg, reconciliation_items:[...cfg.reconciliation_items, { id:createId(), line_item:'', category:'Output', formula:'' }] });

  return <div>
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, padding:'6px 10px', background:t.info+'08', borderRadius:6, border:'1px solid '+t.info+'20' }}>
      <Calculator size={13} color={t.info}/>
      <span style={{ fontSize:11, fontWeight:600, color:t.info, textTransform:'uppercase', letterSpacing:0.5 }}>Yield Calculation Rules</span>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginBottom:10 }}>
      <MBRInput label="Theoretical Yield Formula" t={t} value={cfg.theoretical_formula} onChange={e => onUpdate({ ...cfg, theoretical_formula:e.target.value })} disabled={disabled} placeholder="e.g. batch_size × 0.97" style={{ gridColumn:'span 2' }} />
      <MBRInput label="Expected Yield" t={t} value={cfg.expected_yield_pct} onChange={e => onUpdate({ ...cfg, expected_yield_pct:e.target.value })} disabled={disabled} type="number" unit="%" placeholder="97" />
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6 }}>
        <MBRInput label="Low Limit" t={t} value={cfg.acceptable_range_low} onChange={e => onUpdate({ ...cfg, acceptable_range_low:e.target.value })} disabled={disabled} type="number" unit="%" placeholder="95" />
        <MBRInput label="High Limit" t={t} value={cfg.acceptable_range_high} onChange={e => onUpdate({ ...cfg, acceptable_range_high:e.target.value })} disabled={disabled} type="number" unit="%" placeholder="102" />
      </div>
    </div>
    {/* Reconciliation line items */}
    <div style={{ fontSize:10, color:t.textDim, textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Yield Reconciliation Items</div>
    {(cfg.reconciliation_items||[]).map(item => (
      <div key={item.id} style={{ display:'grid', gridTemplateColumns:'1.5fr 0.7fr 1fr auto', gap:8, alignItems:'end', padding:'6px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
        <MBRInput label="Line Item" t={t} value={item.line_item} onChange={e => onUpdate({ ...cfg, reconciliation_items:cfg.reconciliation_items.map(x => x.id===item.id?{...item,line_item:e.target.value}:x) })} disabled={disabled} placeholder="e.g. Finished Tablets, Samples, Waste" />
        <MBRSelect label="Category" t={t} value={item.category} onChange={e => onUpdate({ ...cfg, reconciliation_items:cfg.reconciliation_items.map(x => x.id===item.id?{...item,category:e.target.value}:x) })} options={['Input','Output','Loss','Retained','Sample','Waste']} disabled={disabled} />
        <MBRInput label="Formula / Qty" t={t} value={item.formula} onChange={e => onUpdate({ ...cfg, reconciliation_items:cfg.reconciliation_items.map(x => x.id===item.id?{...item,formula:e.target.value}:x) })} disabled={disabled} placeholder="e.g. weigh at end" />
        {!disabled && <button onClick={() => onUpdate({ ...cfg, reconciliation_items:cfg.reconciliation_items.filter(x => x.id!==item.id) })} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4, paddingBottom:14 }}><Trash2 size={13}/></button>}
      </div>
    ))}
    {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addReconItem} style={{marginTop:6}}><Plus size={12}/>Add Reconciliation Item</MBRBtn>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// BOM (Bill of Materials) — MBR-level structured material list
// ════════════════════════════════════════════════════════════════════════════

function BOMSection({ bom, onUpdate, t, disabled, batchSize, batchUnit }) {
  const items = bom || [];

  const addItem = () => onUpdate([...items, {
    id:createId(), _isNew:true, material_code:'', material_name:'', material_type:'Excipient',
    quantity_per_batch:'', unit:'kg', tolerance_pct:'', tolerance_type:'±',
    alternate_material:'', supplier:'', grade:'', is_active_ingredient:false,
    dispensing_sequence:items.length+1, overage_pct:'0', phase_used:''
  }]);

  const totalQty = items.reduce((s, i) => s + (parseFloat(i.quantity_per_batch)||0), 0);
  const apiItems = items.filter(i => i.is_active_ingredient);
  const exItems = items.filter(i => !i.is_active_ingredient);

  return <div>
    <SectionTitle icon={Package} title="Bill of Materials (BOM)" count={items.length} t={t}
      right={<div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:10, fontFamily:"'DM Mono',monospace", color:t.textDim }}>Total: {totalQty.toFixed(2)} {batchUnit||'kg'} / {batchSize||'—'} {batchUnit||'kg'} batch</span>
        {!disabled && <MBRBtn t={t} variant="accent" size="sm" onClick={addItem}><Plus size={12}/>Add Material</MBRBtn>}
      </div>} />

    <MBRCard t={t} style={{ padding:14 }}>
      {items.length === 0 ? (
        <div style={{ textAlign:'center', padding:'30px 0', color:t.textMuted, fontSize:13 }}>
          <Package size={24} color={t.textMuted} style={{marginBottom:8}}/>
          <div>No BOM items defined. Add raw materials, APIs, and excipients.</div>
        </div>
      ) : (
        <div>
          {/* Header row */}
          <div style={{ display:'grid', gridTemplateColumns:'0.3fr 0.7fr 1.5fr 0.6fr 0.5fr 0.5fr 0.5fr 0.8fr 0.7fr auto', gap:6, padding:'6px 0', borderBottom:'2px solid '+t.cardBorder, marginBottom:4 }}>
            {['#','Code','Material Name','Qty/Batch','Unit','Tol %','Ovg %','Supplier','Grade',''].map(h => (
              <span key={h} style={{ fontSize:9, fontWeight:700, color:t.textMuted, textTransform:'uppercase', letterSpacing:0.5 }}>{h}</span>
            ))}
          </div>
          {/* Items */}
          {items.map((item, idx) => (
            <div key={item.id} style={{ display:'grid', gridTemplateColumns:'0.3fr 0.7fr 1.5fr 0.6fr 0.5fr 0.5fr 0.5fr 0.8fr 0.7fr auto', gap:6, padding:'6px 0', borderBottom:'1px solid '+t.cardBorder+'30', background:item.is_active_ingredient ? t.danger+'06' : 'transparent' }}>
              <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", color:t.textMuted, alignSelf:'center' }}>{idx+1}</span>
              <input value={item.material_code} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,material_code:e.target.value}:x))} disabled={disabled} placeholder="RM-001"
                style={{ background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 7px', fontSize:11, outline:'none', fontFamily:"'DM Mono',monospace" }} />
              <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                <input value={item.material_name} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,material_name:e.target.value}:x))} disabled={disabled} placeholder="Microcrystalline Cellulose"
                  style={{ flex:1, background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 7px', fontSize:11, outline:'none' }} />
                {item.is_active_ingredient && <MBRBadge color={t.danger} t={t}>API</MBRBadge>}
              </div>
              <input value={item.quantity_per_batch} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,quantity_per_batch:e.target.value}:x))} disabled={disabled} type="number" placeholder="100"
                style={{ background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 7px', fontSize:11, outline:'none', fontFamily:"'DM Mono',monospace", textAlign:'right' }} />
              <select value={item.unit} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,unit:e.target.value}:x))} disabled={disabled}
                style={{ background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 4px', fontSize:10, outline:'none' }}>
                {['kg','g','mg','L','mL','units','rolls','pcs'].map(u => <option key={u}>{u}</option>)}
              </select>
              <input value={item.tolerance_pct} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,tolerance_pct:e.target.value}:x))} disabled={disabled} type="number" placeholder="±1.0"
                style={{ background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 7px', fontSize:11, outline:'none', fontFamily:"'DM Mono',monospace", textAlign:'right' }} />
              <input value={item.overage_pct} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,overage_pct:e.target.value}:x))} disabled={disabled} type="number" placeholder="0"
                style={{ background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 7px', fontSize:11, outline:'none', fontFamily:"'DM Mono',monospace", textAlign:'right' }} />
              <input value={item.supplier} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,supplier:e.target.value}:x))} disabled={disabled} placeholder="Supplier"
                style={{ background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 7px', fontSize:11, outline:'none' }} />
              <input value={item.grade} onChange={e => onUpdate(items.map(x => x.id===item.id?{...item,grade:e.target.value}:x))} disabled={disabled} placeholder="USP"
                style={{ background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:5, padding:'5px 7px', fontSize:11, outline:'none' }} />
              <div style={{ display:'flex', gap:3, alignItems:'center' }}>
                <ToggleChip label="API" active={item.is_active_ingredient} onClick={() => onUpdate(items.map(x => x.id===item.id?{...item,is_active_ingredient:!item.is_active_ingredient}:x))} color={t.danger} t={t} />
                {!disabled && <button onClick={() => onUpdate(items.filter(x => x.id!==item.id))} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:2 }}><Trash2 size={12}/></button>}
              </div>
            </div>
          ))}
          {/* Summary row */}
          <div style={{ display:'flex', justifyContent:'space-between', padding:'10px 0 0', marginTop:6, borderTop:'2px solid '+t.cardBorder }}>
            <div style={{ display:'flex', gap:12, fontSize:11 }}>
              <span style={{ color:t.textDim }}>APIs: <span style={{ fontWeight:700, color:t.danger }}>{apiItems.length}</span></span>
              <span style={{ color:t.textDim }}>Excipients: <span style={{ fontWeight:700, color:t.text }}>{exItems.length}</span></span>
              <span style={{ color:t.textDim }}>Total items: <span style={{ fontWeight:700, color:t.text }}>{items.length}</span></span>
            </div>
            <span style={{ fontSize:11, fontFamily:"'DM Mono',monospace", fontWeight:700, color:t.accent }}>Total: {totalQty.toFixed(2)} {batchUnit||'kg'}</span>
          </div>
        </div>
      )}
    </MBRCard>
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// WEIGHING / DISPENSING INSTRUCTIONS (per operation)
// ════════════════════════════════════════════════════════════════════════════

const DISPENSING_METHODS = ['Manual Scoop', 'Gravity Feed', 'Vacuum Transfer', 'Pneumatic Transfer', 'Peristaltic Pump', 'Piston Pump', 'Loss-in-Weight Feeder', 'Volumetric Dispense'];
const VERIFICATION_TYPES = ['Single Weigh', 'Double Weigh (4-eye)', 'Triple Check', 'Barcode Scan + Weigh', 'Auto-ID + Weigh', 'RFID Verification'];
const TARE_METHODS = ['Pre-tared Container', 'Tare on Scale', 'Calculated Tare', 'Zero-Point Tare'];

function WeighingInstructionPanel({ weighConfig, onUpdate, t, disabled }) {
  const cfg = weighConfig || { instructions:[] };

  const addInstruction = () => onUpdate({ ...cfg, instructions:[...cfg.instructions, {
    id:createId(), sequence:cfg.instructions.length+1, material_ref:'', target_weight:'', unit:'kg',
    tolerance_pct:'1.0', tolerance_type:'±', method:DISPENSING_METHODS[0], verification:VERIFICATION_TYPES[0],
    tare_method:TARE_METHODS[0], container_type:'', scale_id:'', min_scale_division:'',
    special_instructions:'', ppe_required:'Gloves, Mask', potent_compound:false
  }] });

  return <div>
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, padding:'6px 10px', background:t.warning+'08', borderRadius:6, border:'1px solid '+t.warning+'20' }}>
      <Scale size={13} color={t.warning}/>
      <span style={{ fontSize:11, fontWeight:600, color:t.warning, textTransform:'uppercase', letterSpacing:0.5 }}>Weighing & Dispensing Instructions</span>
      <span style={{ fontSize:10, color:t.textMuted, marginLeft:'auto' }}>{cfg.instructions.length} items</span>
    </div>
    {(cfg.instructions||[]).map((inst, idx) => (
      <MBRCard key={inst.id} t={t} style={{ padding:12, marginBottom:8, borderLeft:'3px solid '+t.warning+'40' }}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
          <span style={{ fontSize:12, fontWeight:700, color:t.text }}>Step {inst.sequence}: {inst.material_ref || 'Material'}</span>
          <div style={{ display:'flex', gap:4, alignItems:'center' }}>
            {inst.potent_compound && <MBRBadge color={t.danger} t={t}>POTENT</MBRBadge>}
            {!disabled && <button onClick={() => onUpdate({ ...cfg, instructions:cfg.instructions.filter(x => x.id!==inst.id) })} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted }}><Trash2 size={12}/></button>}
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.7fr 0.5fr 0.5fr 1fr', gap:8 }}>
          <MBRInput label="Material Reference" t={t} value={inst.material_ref} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,material_ref:e.target.value}:x) })} disabled={disabled} placeholder="Metformin HCl API" />
          <MBRInput label="Target Weight" t={t} value={inst.target_weight} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,target_weight:e.target.value}:x) })} disabled={disabled} type="number" unit={inst.unit} />
          <MBRInput label="Tolerance" t={t} value={inst.tolerance_pct} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,tolerance_pct:e.target.value}:x) })} disabled={disabled} unit="%" />
          <MBRInput label="Scale ID" t={t} value={inst.scale_id} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,scale_id:e.target.value}:x) })} disabled={disabled} placeholder="BAL-001" />
          <MBRSelect label="Method" t={t} value={inst.method} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,method:e.target.value}:x) })} options={DISPENSING_METHODS} disabled={disabled} />
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:8, marginTop:4 }}>
          <MBRSelect label="Verification" t={t} value={inst.verification} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,verification:e.target.value}:x) })} options={VERIFICATION_TYPES} disabled={disabled} />
          <MBRSelect label="Tare Method" t={t} value={inst.tare_method} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,tare_method:e.target.value}:x) })} options={TARE_METHODS} disabled={disabled} />
          <MBRInput label="Container Type" t={t} value={inst.container_type} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,container_type:e.target.value}:x) })} disabled={disabled} placeholder="SS Drum, PE Bag" />
          <MBRInput label="PPE Required" t={t} value={inst.ppe_required} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,ppe_required:e.target.value}:x) })} disabled={disabled} placeholder="Gloves, Mask" />
        </div>
        <div style={{ marginTop:4 }}>
          <MBRInput label="Special Instructions" t={t} value={inst.special_instructions} onChange={e => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,special_instructions:e.target.value}:x) })} disabled={disabled} placeholder="e.g. Dispense under LAF, double-bag potent compound" />
        </div>
        <div style={{ marginTop:4, display:'flex', gap:6 }}>
          <ToggleChip label="Potent Compound" active={inst.potent_compound} onClick={() => onUpdate({ ...cfg, instructions:cfg.instructions.map(x => x.id===inst.id?{...inst,potent_compound:!inst.potent_compound}:x) })} color={t.danger} t={t} />
        </div>
      </MBRCard>
    ))}
    {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addInstruction} style={{marginTop:6}}><Plus size={12}/>Add Weighing Instruction</MBRBtn>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// SAMPLING PLAN (per operation)
// ════════════════════════════════════════════════════════════════════════════

const SAMPLE_TYPES = ['Chemical', 'Microbiological', 'Physical', 'Identity', 'Assay', 'Dissolution', 'Moisture', 'Particle Size', 'Blend Uniformity', 'Content Uniformity', 'Stability'];
const SAMPLE_LOCATIONS = ['Top', 'Middle', 'Bottom', 'Left', 'Right', 'Center', 'Random', 'Beginning', 'End', 'Composite', '10 Locations (ASTM)', '20+1 (Blend)'];
const SAMPLE_CONTAINERS = ['Glass Vial', 'HDPE Bottle', 'Amber Glass', 'Sterile Container', 'Swab', 'Petri Dish', 'Double Bag'];
const SAMPLE_DESTINATIONS = ['QC Lab', 'Micro Lab', 'Stability Chamber', 'Retain', 'Customer', 'Regulatory'];

function SamplingPlanPanel({ samplingPlan, onUpdate, t, disabled }) {
  const plan = samplingPlan || { samples:[] };

  const addSample = () => onUpdate({ ...plan, samples:[...plan.samples, {
    id:createId(), sample_name:'', sample_type:SAMPLE_TYPES[0], quantity:'', unit:'g',
    location:SAMPLE_LOCATIONS[0], container:SAMPLE_CONTAINERS[0], destination:SAMPLE_DESTINATIONS[0],
    test_method:'', specification:'', frequency:'', storage_conditions:'Room Temperature',
    hold_time_hours:'', is_retain:false, is_stability:false
  }] });

  return <div>
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, padding:'6px 10px', background:t.accent+'08', borderRadius:6, border:'1px solid '+t.accent+'20' }}>
      <TestTube size={13} color={t.accent}/>
      <span style={{ fontSize:11, fontWeight:600, color:t.accent, textTransform:'uppercase', letterSpacing:0.5 }}>Sampling Plan</span>
      <span style={{ fontSize:10, color:t.textMuted, marginLeft:'auto' }}>{plan.samples.length} samples defined</span>
    </div>
    {(plan.samples||[]).map(sample => (
      <div key={sample.id} style={{ padding:'8px 0', borderBottom:'1px solid '+t.cardBorder+'30' }}>
        <div style={{ display:'grid', gridTemplateColumns:'1.5fr 0.8fr 0.5fr 0.4fr 0.8fr 0.8fr auto', gap:8, alignItems:'end' }}>
          <MBRInput label="Sample Name" t={t} value={sample.sample_name} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,sample_name:e.target.value}:x) })} disabled={disabled} placeholder="Blend Uniformity Sample" />
          <MBRSelect label="Type" t={t} value={sample.sample_type} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,sample_type:e.target.value}:x) })} options={SAMPLE_TYPES} disabled={disabled} />
          <MBRInput label="Qty" t={t} value={sample.quantity} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,quantity:e.target.value}:x) })} disabled={disabled} type="number" unit={sample.unit} />
          <MBRSelect label="Location" t={t} value={sample.location} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,location:e.target.value}:x) })} options={SAMPLE_LOCATIONS} disabled={disabled} />
          <MBRInput label="Test Method" t={t} value={sample.test_method} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,test_method:e.target.value}:x) })} disabled={disabled} placeholder="USP <905>" />
          <MBRInput label="Specification" t={t} value={sample.specification} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,specification:e.target.value}:x) })} disabled={disabled} placeholder="RSD ≤ 5%" />
          {!disabled && <button onClick={() => onUpdate({ ...plan, samples:plan.samples.filter(x => x.id!==sample.id) })} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, paddingBottom:14 }}><Trash2 size={13}/></button>}
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr auto', gap:8, marginTop:4, alignItems:'end' }}>
          <MBRSelect label="Container" t={t} value={sample.container} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,container:e.target.value}:x) })} options={SAMPLE_CONTAINERS} disabled={disabled} />
          <MBRSelect label="Destination" t={t} value={sample.destination} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,destination:e.target.value}:x) })} options={SAMPLE_DESTINATIONS} disabled={disabled} />
          <MBRInput label="Storage" t={t} value={sample.storage_conditions} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,storage_conditions:e.target.value}:x) })} disabled={disabled} placeholder="2-8°C" />
          <MBRInput label="Hold Time" t={t} value={sample.hold_time_hours} onChange={e => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,hold_time_hours:e.target.value}:x) })} disabled={disabled} type="number" unit="hrs" />
          <div style={{ display:'flex', gap:4, paddingBottom:12 }}>
            <ToggleChip label="Retain" active={sample.is_retain} onClick={() => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,is_retain:!sample.is_retain}:x) })} color={t.info} t={t} />
            <ToggleChip label="Stability" active={sample.is_stability} onClick={() => onUpdate({ ...plan, samples:plan.samples.map(x => x.id===sample.id?{...sample,is_stability:!sample.is_stability}:x) })} color={t.warning} t={t} />
          </div>
        </div>
      </div>
    ))}
    {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addSample} style={{marginTop:6}}><Plus size={12}/>Add Sample</MBRBtn>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// CLEAN / DIRTY HOLD TIMES (per operation)
// ════════════════════════════════════════════════════════════════════════════

const CLEAN_STATUSES = ['Clean', 'Dirty', 'Dedicated', 'Campaign'];
const CLEANING_TYPES = ['CIP (Clean-in-Place)', 'COP (Clean-out-of-Place)', 'Manual Clean', 'Wipe Down', 'Solvent Rinse', 'Sterilization (SIP)', 'Depyrogenation'];

function HoldTimePanel({ holdConfig, onUpdate, t, disabled }) {
  const cfg = holdConfig || {
    dirty_hold_max_hours:'', clean_hold_max_hours:'', campaign_max_batches:'',
    cleaning_type:'', cleaning_sop:'', cleaning_agent:'', rinse_solvent:'',
    swab_test_required:false, rinse_test_required:false, toc_limit:'', residue_limit:'',
    visual_inspection:true, cleaning_validation_ref:'', notes:''
  };

  const set = (k, v) => onUpdate({ ...cfg, [k]:v });

  return <div>
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, padding:'6px 10px', background:t.danger+'08', borderRadius:6, border:'1px solid '+t.danger+'20' }}>
      <Clock size={13} color={t.danger}/>
      <span style={{ fontSize:11, fontWeight:600, color:t.danger, textTransform:'uppercase', letterSpacing:0.5 }}>Clean / Dirty Hold Times & Cleaning Requirements</span>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
      <MBRInput label="Dirty Hold Max" t={t} value={cfg.dirty_hold_max_hours} onChange={e => set('dirty_hold_max_hours',e.target.value)} disabled={disabled} type="number" unit="hours" placeholder="24" />
      <MBRInput label="Clean Hold Max" t={t} value={cfg.clean_hold_max_hours} onChange={e => set('clean_hold_max_hours',e.target.value)} disabled={disabled} type="number" unit="hours" placeholder="72" />
      <MBRInput label="Campaign Max" t={t} value={cfg.campaign_max_batches} onChange={e => set('campaign_max_batches',e.target.value)} disabled={disabled} type="number" unit="batches" placeholder="5" />
      <MBRSelect label="Cleaning Type" t={t} value={cfg.cleaning_type} onChange={e => set('cleaning_type',e.target.value)} options={CLEANING_TYPES} disabled={disabled} />
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginTop:4 }}>
      <MBRInput label="Cleaning SOP" t={t} value={cfg.cleaning_sop} onChange={e => set('cleaning_sop',e.target.value)} disabled={disabled} placeholder="SOP-CLN-001" />
      <MBRInput label="Cleaning Agent" t={t} value={cfg.cleaning_agent} onChange={e => set('cleaning_agent',e.target.value)} disabled={disabled} placeholder="0.5N NaOH" />
      <MBRInput label="Rinse Solvent" t={t} value={cfg.rinse_solvent} onChange={e => set('rinse_solvent',e.target.value)} disabled={disabled} placeholder="Purified Water USP" />
      <MBRInput label="Cleaning Validation" t={t} value={cfg.cleaning_validation_ref} onChange={e => set('cleaning_validation_ref',e.target.value)} disabled={disabled} placeholder="CV-001" />
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginTop:4 }}>
      <MBRInput label="TOC Limit" t={t} value={cfg.toc_limit} onChange={e => set('toc_limit',e.target.value)} disabled={disabled} placeholder="500 ppb" />
      <MBRInput label="Residue Limit" t={t} value={cfg.residue_limit} onChange={e => set('residue_limit',e.target.value)} disabled={disabled} placeholder="10 ppm" />
      <div style={{ display:'flex', gap:6, alignItems:'end', paddingBottom:12, flexWrap:'wrap' }}>
        <ToggleChip label="Swab Test" active={cfg.swab_test_required} onClick={() => set('swab_test_required',!cfg.swab_test_required)} color={t.info} t={t} />
        <ToggleChip label="Rinse Test" active={cfg.rinse_test_required} onClick={() => set('rinse_test_required',!cfg.rinse_test_required)} color={t.info} t={t} />
        <ToggleChip label="Visual Check" active={cfg.visual_inspection} onClick={() => set('visual_inspection',!cfg.visual_inspection)} t={t} />
      </div>
    </div>
    <MBRInput label="Additional Notes" t={t} value={cfg.notes} onChange={e => set('notes',e.target.value)} disabled={disabled} placeholder="e.g. Dedicated equipment — no product changeover cleaning required" />
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// ROOM / ENVIRONMENT REQUIREMENTS (per operation)
// ════════════════════════════════════════════════════════════════════════════

const CLEAN_ROOM_CLASSES = ['ISO 5 (Class 100)', 'ISO 6 (Class 1,000)', 'ISO 7 (Class 10,000)', 'ISO 8 (Class 100,000)', 'Grade A', 'Grade B', 'Grade C', 'Grade D', 'CNC (Controlled Non-Classified)', 'Unclassified'];
const GOWNING_LEVELS = ['Standard (Lab coat, hairnet)', 'Enhanced (Coverall, shoe covers)', 'Full Gowning (Sterile gown, goggles, double gloves)', 'Aseptic (Full sterile barrier)'];

function RoomEnvironmentPanel({ envConfig, onUpdate, t, disabled }) {
  const cfg = envConfig || {
    room_number:'', room_name:'', clean_room_class:'CNC (Controlled Non-Classified)',
    temp_min:'', temp_max:'', temp_unit:'°C', humidity_min:'', humidity_max:'',
    differential_pressure:'', dp_unit:'Pa', air_changes_per_hour:'',
    lighting_lux:'', gowning_level:GOWNING_LEVELS[0],
    monitoring_required:true, monitoring_frequency:'',
    special_requirements:'', access_restrictions:''
  };

  const set = (k, v) => onUpdate({ ...cfg, [k]:v });

  return <div>
    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:10, padding:'6px 10px', background:'#a78bfa08', borderRadius:6, border:'1px solid #a78bfa20' }}>
      <Thermometer size={13} color="#a78bfa"/>
      <span style={{ fontSize:11, fontWeight:600, color:'#a78bfa', textTransform:'uppercase', letterSpacing:0.5 }}>Room & Environmental Requirements</span>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
      <MBRInput label="Room Number" t={t} value={cfg.room_number} onChange={e => set('room_number',e.target.value)} disabled={disabled} placeholder="RM-201" />
      <MBRInput label="Room Name" t={t} value={cfg.room_name} onChange={e => set('room_name',e.target.value)} disabled={disabled} placeholder="Granulation Suite" />
      <MBRSelect label="Clean Room Class" t={t} value={cfg.clean_room_class} onChange={e => set('clean_room_class',e.target.value)} options={CLEAN_ROOM_CLASSES} disabled={disabled} />
      <MBRSelect label="Gowning Level" t={t} value={cfg.gowning_level} onChange={e => set('gowning_level',e.target.value)} options={GOWNING_LEVELS} disabled={disabled} />
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr 1fr', gap:10, marginTop:4 }}>
      <MBRInput label="Temp Min" t={t} value={cfg.temp_min} onChange={e => set('temp_min',e.target.value)} disabled={disabled} type="number" unit={cfg.temp_unit} placeholder="18" />
      <MBRInput label="Temp Max" t={t} value={cfg.temp_max} onChange={e => set('temp_max',e.target.value)} disabled={disabled} type="number" unit={cfg.temp_unit} placeholder="25" />
      <MBRInput label="RH Min" t={t} value={cfg.humidity_min} onChange={e => set('humidity_min',e.target.value)} disabled={disabled} type="number" unit="%" placeholder="30" />
      <MBRInput label="RH Max" t={t} value={cfg.humidity_max} onChange={e => set('humidity_max',e.target.value)} disabled={disabled} type="number" unit="%" placeholder="65" />
      <MBRInput label="ΔP" t={t} value={cfg.differential_pressure} onChange={e => set('differential_pressure',e.target.value)} disabled={disabled} type="number" unit={cfg.dp_unit} placeholder="15" />
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginTop:4 }}>
      <MBRInput label="Air Changes/Hr" t={t} value={cfg.air_changes_per_hour} onChange={e => set('air_changes_per_hour',e.target.value)} disabled={disabled} type="number" unit="ACH" placeholder="20" />
      <MBRInput label="Lighting" t={t} value={cfg.lighting_lux} onChange={e => set('lighting_lux',e.target.value)} disabled={disabled} type="number" unit="lux" placeholder="500" />
      <MBRInput label="Monitoring Freq" t={t} value={cfg.monitoring_frequency} onChange={e => set('monitoring_frequency',e.target.value)} disabled={disabled} placeholder="Continuous / Hourly" />
      <div style={{ display:'flex', gap:6, alignItems:'end', paddingBottom:12 }}>
        <ToggleChip label="EMS Monitoring" active={cfg.monitoring_required} onClick={() => set('monitoring_required',!cfg.monitoring_required)} t={t} />
      </div>
    </div>
    <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:4 }}>
      <MBRInput label="Special Requirements" t={t} value={cfg.special_requirements} onChange={e => set('special_requirements',e.target.value)} disabled={disabled} placeholder="e.g. Anti-static flooring, explosion-proof area" />
      <MBRInput label="Access Restrictions" t={t} value={cfg.access_restrictions} onChange={e => set('access_restrictions',e.target.value)} disabled={disabled} placeholder="e.g. Qualified operators only, gown-in required" />
    </div>
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// VISUAL PROCESS FLOW DIAGRAM (interactive, drag-position)
// ════════════════════════════════════════════════════════════════════════════

function ProcessFlowDiagram({ phases, t, onSelectPhase }) {
  if (!phases || phases.length === 0) return null;

  const nodeW = 140;
  const nodeH = 72;
  const gapX = 40;
  const startX = 20;
  const startY = 20;
  const rowMaxNodes = 5;
  const rowGapY = 50;

  const nodes = phases.map((phase, idx) => {
    const row = Math.floor(idx / rowMaxNodes);
    const col = row % 2 === 0 ? idx % rowMaxNodes : (rowMaxNodes - 1) - (idx % rowMaxNodes); // Zigzag
    const x = startX + col * (nodeW + gapX);
    const y = startY + row * (nodeH + rowGapY);
    const stepCount = phase.steps?.length || 0;
    const critCount = (phase.steps||[]).filter(s => s.is_critical).length;
    const ipcCount = (phase.steps||[]).reduce((s, st) => s + (st.ipc_checks?.length||0), 0);
    return { ...phase, x, y, stepCount, critCount, ipcCount, idx };
  });

  const totalW = Math.min(nodes.length, rowMaxNodes) * (nodeW + gapX) + startX;
  const totalRows = Math.ceil(nodes.length / rowMaxNodes);
  const totalH = totalRows * (nodeH + rowGapY) + startY + 10;

  return <MBRCard t={t} style={{ marginBottom:16, padding:14, overflowX:'auto' }}>
    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10 }}>
      <Activity size={14} color={t.accent}/>
      <span style={{ fontSize:12, fontWeight:700, color:t.text, textTransform:'uppercase', letterSpacing:0.5 }}>Process Flow Diagram</span>
      <span style={{ fontSize:10, color:t.textMuted }}>Click a phase to scroll to it</span>
    </div>
    <svg width={totalW} height={totalH} style={{ display:'block' }}>
      {/* Connection lines */}
      {nodes.map((node, idx) => {
        if (idx === 0) return null;
        const prev = nodes[idx-1];
        const fromX = prev.x + nodeW;
        const fromY = prev.y + nodeH/2;
        const toX = node.x;
        const toY = node.y + nodeH/2;
        const sameRow = Math.floor(idx/rowMaxNodes) === Math.floor((idx-1)/rowMaxNodes);
        if (sameRow) {
          return <line key={'line-'+idx} x1={fromX} y1={fromY} x2={toX} y2={toY} stroke={t.accent+'60'} strokeWidth={2} markerEnd="url(#flowArrow)"/>;
        } else {
          const midY = prev.y + nodeH + rowGapY/2;
          return <path key={'line-'+idx} d={`M${fromX} ${fromY} L${fromX+20} ${fromY} L${fromX+20} ${midY} L${toX+nodeW-20} ${midY} L${toX+nodeW-20} ${toY} L${toX+nodeW} ${toY}`} fill="none" stroke={t.accent+'60'} strokeWidth={2}/>;
        }
      })}
      <defs>
        <marker id="flowArrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M2 1L8 5L2 9" fill="none" stroke={t.accent+'60'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </marker>
      </defs>
      {/* Nodes */}
      {nodes.map(node => (
        <g key={node.id} onClick={() => onSelectPhase && onSelectPhase(node.id)} style={{ cursor:'pointer' }}>
          <rect x={node.x} y={node.y} width={nodeW} height={nodeH} rx={8} fill={t.card} stroke={t.accent+'40'} strokeWidth={1.5}/>
          <rect x={node.x} y={node.y} width={nodeW} height={4} rx={2} fill={t.accent}/>
          {/* Phase number */}
          <circle cx={node.x+16} cy={node.y+22} r={9} fill={t.accent+'20'}/>
          <text x={node.x+16} y={node.y+22} textAnchor="middle" dominantBaseline="central" fill={t.accent} fontSize={10} fontWeight={700} fontFamily="'DM Mono',monospace">{node.idx+1}</text>
          {/* Name */}
          <text x={node.x+32} y={node.y+22} fill={t.text} fontSize={11} fontWeight={600}>
            {(node.phase_name || 'Unnamed').slice(0, 14)}{(node.phase_name||'').length > 14 ? '…' : ''}
          </text>
          {/* Stats */}
          <text x={node.x+8} y={node.y+44} fill={t.textDim} fontSize={9} fontFamily="'DM Mono',monospace">{node.stepCount} ops</text>
          {node.critCount > 0 && <text x={node.x+55} y={node.y+44} fill={t.danger} fontSize={9} fontFamily="'DM Mono',monospace">{node.critCount} CPP</text>}
          {node.ipcCount > 0 && <text x={node.x+95} y={node.y+44} fill={t.info} fontSize={9} fontFamily="'DM Mono',monospace">{node.ipcCount} IPC</text>}
          {/* Duration */}
          <text x={node.x+8} y={node.y+58} fill={t.textMuted} fontSize={8} fontFamily="'DM Mono',monospace">
            {(node.steps||[]).reduce((s,st) => s+(parseFloat(st.duration_min)||0), 0)}min
          </text>
        </g>
      ))}
    </svg>
  </MBRCard>;
}

// ════════════════════════════════════════════════════════════════════════════
// OPERATION CARD (ISA-88 Operation = MBR Step) — with drag handle
// ════════════════════════════════════════════════════════════════════════════

function OperationCard({ step, onUpdate, onDelete, t, disabled, dragHandleProps }) {
  const [expanded, setExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState('params');

  const addParam = () => onUpdate({ ...step, parameters:[...(step.parameters||[]), { id:createId(), _isNew:true, param_name:'', param_type:'numeric', target_value:'', unit:'', lower_limit:'', upper_limit:'', is_cpp:false, is_cqa:false }] });
  const addMat = () => onUpdate({ ...step, materials:[...(step.materials||[]), { id:createId(), _isNew:true, material_code:'', material_name:'', material_type:'Raw Material', quantity:'', unit:'kg', is_active:false }] });
  const addEq = () => onUpdate({ ...step, equipment:[...(step.equipment||[]), { id:createId(), _isNew:true, equipment_code:'', equipment_name:'', equipment_type:'Reactor', capacity:'', is_primary:true }] });

  const l2Count = (step.l2_config?.opc_tags?.length||0)+(step.l2_config?.control_modules?.length||0)+(step.l2_config?.alarms?.length||0)+(step.l2_config?.historian_tags?.length||0)+(step.l2_config?.setpoints?.length||0);

  const tabs = [
    { key:'params', label:'Parameters', icon:Settings2, count:step.parameters?.length||0 },
    { key:'materials', label:'Materials', icon:Package, count:step.materials?.length||0 },
    { key:'equipment', label:'Equipment', icon:Cpu, count:step.equipment?.length||0 },
    { key:'ipc', label:'IPC Checks', icon:ClipboardCheck, count:step.ipc_checks?.length||0 },
    { key:'weighing', label:'Weighing', icon:Scale, count:step.weighing_config?.instructions?.length||0 },
    { key:'sampling', label:'Sampling', icon:TestTube, count:step.sampling_plan?.samples?.length||0 },
    { key:'yield', label:'Yield Rules', icon:Calculator, count:step.yield_config?.reconciliation_items?.length||0 },
    { key:'holdtimes', label:'Hold Times', icon:Clock, count:step.hold_config?.dirty_hold_max_hours?1:0 },
    { key:'room', label:'Room/Env', icon:Thermometer, count:step.env_config?.room_number?1:0 },
    { key:'l2config', label:'L2 Config', icon:Radio, count:l2Count },
  ];

  const borderColor = step.is_critical ? t.danger+'40' : t.cardBorder;
  const bgTint = step.is_critical ? t.danger+'05' : 'transparent';

  return <div style={{ border:'1px solid '+borderColor, borderRadius:10, background:bgTint, marginBottom:8, transition:'all 0.2s' }}>
    {/* Header */}
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', cursor:'pointer', userSelect:'none' }} onClick={() => setExpanded(!expanded)}>
      {!disabled && <div {...(dragHandleProps||{})} style={{ cursor:'grab', color:t.textMuted, display:'flex' }}><GripVertical size={14}/></div>}
      <div style={{ width:26, height:26, borderRadius:6, display:'flex', alignItems:'center', justifyContent:'center', background:t.accent+'12', color:t.accent, fontSize:11, fontWeight:700, fontFamily:"'DM Mono',monospace" }}>{step.step_number}</div>
      <input value={step.step_name} onChange={e => { e.stopPropagation(); onUpdate({ ...step, step_name:e.target.value }); }} onClick={e => e.stopPropagation()} disabled={disabled}
        placeholder="Operation name..." style={{ flex:1, background:'transparent', border:'none', color:t.text, fontSize:13, fontWeight:600, outline:'none', opacity:disabled?0.6:1 }} />
      <div style={{ display:'flex', alignItems:'center', gap:6 }}>
        <MBRBadge color={t.textMuted} t={t}>{step.step_type}</MBRBadge>
        {step.is_critical && <MBRBadge color={t.danger} t={t}>CPP</MBRBadge>}
        {step.is_gmp_critical && <MBRBadge color={t.warning} t={t}>GMP</MBRBadge>}
        {l2Count > 0 && <MBRBadge color={t.info} t={t}><Radio size={9}/>L2:{l2Count}</MBRBadge>}
        {(step.ipc_checks?.length||0) > 0 && <MBRBadge color={t.success} t={t}><ClipboardCheck size={9}/>{step.ipc_checks.length} IPC</MBRBadge>}
        {step.duration_min && <span style={{ fontSize:10, color:t.textMuted, fontFamily:"'DM Mono',monospace", display:'flex', alignItems:'center', gap:3 }}><Clock size={10}/>{step.duration_min}m</span>}
        {expanded ? <ChevronUp size={15} color={t.textMuted}/> : <ChevronDown size={15} color={t.textMuted}/>}
      </div>
    </div>

    {/* Expanded */}
    {expanded && <div style={{ padding:'0 14px 14px', borderTop:'1px solid '+t.cardBorder+'40' }}>
      {/* Operation details */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10, marginTop:12 }}>
        <MBRSelect label="Operation Type" t={t} value={step.step_type} onChange={e => onUpdate({ ...step, step_type:e.target.value })} options={STEP_TYPES} disabled={disabled} />
        <MBRInput label="Duration" t={t} value={step.duration_min} onChange={e => onUpdate({ ...step, duration_min:e.target.value })} type="number" unit="min" disabled={disabled} />
        <div style={{ display:'flex', gap:6, alignItems:'end', paddingBottom:12 }}>
          <ToggleChip label="Critical Process" active={step.is_critical} onClick={() => onUpdate({ ...step, is_critical:!step.is_critical })} color={t.danger} t={t} />
          <ToggleChip label="GMP Critical" active={step.is_gmp_critical} onClick={() => onUpdate({ ...step, is_gmp_critical:!step.is_gmp_critical })} color={t.warning} t={t} />
        </div>
        {!disabled && <div style={{ display:'flex', alignItems:'end', paddingBottom:12, justifyContent:'flex-end' }}>
          <MBRBtn t={t} variant="danger" size="sm" onClick={() => onDelete(step.id)}><Trash2 size={12}/>Remove</MBRBtn>
        </div>}
      </div>

      {/* Instruction */}
      <div style={{ marginTop:4 }}>
        <label style={{ color:t.textDim, fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4, display:'block' }}>Work Instruction</label>
        <textarea value={step.instruction||''} onChange={e => onUpdate({ ...step, instruction:e.target.value })} disabled={disabled} rows={2} placeholder="Detailed work instruction for this operation..."
          style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:8, padding:'9px 12px', fontSize:13, outline:'none', resize:'none', fontFamily:'inherit' }} />
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginTop:14, borderBottom:'1px solid '+t.cardBorder, overflowX:'auto', overflowY:'hidden', scrollbarWidth:'none', WebkitOverflowScrolling:'touch', msOverflowStyle:'none' }}>
        {tabs.map(tb => <button key={tb.key} onClick={() => setActiveTab(tb.key)} style={{
          display:'flex', alignItems:'center', gap:5, padding:'7px 12px', fontSize:10, fontWeight:600, textTransform:'uppercase', letterSpacing:0.4,
          background:'transparent', border:'none', borderBottom: activeTab===tb.key ? '2px solid '+t.accent : '2px solid transparent',
          color: activeTab===tb.key ? t.accent : t.textMuted, cursor:'pointer', transition:'all 0.15s', whiteSpace:'nowrap', flexShrink:0
        }}><tb.icon size={11}/>{tb.label}<span style={{ background:t.bgAlt, padding:'0 4px', borderRadius:3, fontSize:9 }}>{tb.count}</span></button>)}
      </div>

      {/* Tab Content */}
      <div style={{ marginTop:10 }}>
        {activeTab === 'params' && <div>
          {(step.parameters||[]).map(p => <ParamRow key={p.id} param={p} t={t} disabled={disabled}
            onUpdate={u => onUpdate({ ...step, parameters:step.parameters.map(x => x.id===p.id?u:x) })}
            onDelete={id => onUpdate({ ...step, parameters:step.parameters.filter(x => x.id!==id) })} />)}
          {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addParam} style={{marginTop:8}}><Plus size={12}/>Add Parameter</MBRBtn>}
        </div>}
        {activeTab === 'materials' && <div>
          {(step.materials||[]).map(m => <MaterialRow key={m.id} mat={m} t={t} disabled={disabled}
            onUpdate={u => onUpdate({ ...step, materials:step.materials.map(x => x.id===m.id?u:x) })}
            onDelete={id => onUpdate({ ...step, materials:step.materials.filter(x => x.id!==id) })} />)}
          {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addMat} style={{marginTop:8}}><Plus size={12}/>Add Material</MBRBtn>}
        </div>}
        {activeTab === 'equipment' && <div>
          {(step.equipment||[]).map(eq => <EquipmentRow key={eq.id} eq={eq} t={t} disabled={disabled}
            onUpdate={u => onUpdate({ ...step, equipment:step.equipment.map(x => x.id===eq.id?u:x) })}
            onDelete={id => onUpdate({ ...step, equipment:step.equipment.filter(x => x.id!==id) })} />)}
          {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={addEq} style={{marginTop:8}}><Plus size={12}/>Add Equipment</MBRBtn>}
        </div>}
        {activeTab === 'ipc' && <div>
          <div style={{ fontSize:10, color:t.textMuted, marginBottom:8 }}>Define In-Process Control checks for this operation. These will appear in EBR execution for operators to record.</div>
          {(step.ipc_checks||[]).map(c => <IPCCheckRow key={c.id} check={c} t={t} disabled={disabled}
            onUpdate={u => onUpdate({ ...step, ipc_checks:step.ipc_checks.map(x => x.id===c.id?u:x) })}
            onDelete={id => onUpdate({ ...step, ipc_checks:step.ipc_checks.filter(x => x.id!==id) })} />)}
          {!disabled && <MBRBtn t={t} variant="ghost" size="sm" onClick={() => onUpdate({ ...step, ipc_checks:[...(step.ipc_checks||[]), { id:createId(), _isNew:true, check_name:'', check_type:'Visual', specification:'', frequency:'Every 30 min' }] })} style={{marginTop:8}}><Plus size={12}/>Add IPC Check</MBRBtn>}
        </div>}
        {activeTab === 'yield' && <YieldRulePanel
          yieldConfig={step.yield_config || { theoretical_formula:'', expected_yield_pct:'', acceptable_range_low:'', acceptable_range_high:'', reconciliation_items:[] }}
          onUpdate={cfg => onUpdate({ ...step, yield_config:cfg })}
          t={t} disabled={disabled} />}
        {activeTab === 'weighing' && <WeighingInstructionPanel
          weighConfig={step.weighing_config || { instructions:[] }}
          onUpdate={cfg => onUpdate({ ...step, weighing_config:cfg })}
          t={t} disabled={disabled} />}
        {activeTab === 'sampling' && <SamplingPlanPanel
          samplingPlan={step.sampling_plan || { samples:[] }}
          onUpdate={plan => onUpdate({ ...step, sampling_plan:plan })}
          t={t} disabled={disabled} />}
        {activeTab === 'holdtimes' && <HoldTimePanel
          holdConfig={step.hold_config || {}}
          onUpdate={cfg => onUpdate({ ...step, hold_config:cfg })}
          t={t} disabled={disabled} />}
        {activeTab === 'room' && <RoomEnvironmentPanel
          envConfig={step.env_config || {}}
          onUpdate={cfg => onUpdate({ ...step, env_config:cfg })}
          t={t} disabled={disabled} />}
        {activeTab === 'l2config' && <L2ConfigPanel
          l2Config={step.l2_config || { opc_tags:[], control_modules:[], alarms:[], historian_tags:[], setpoints:[] }}
          onUpdate={cfg => onUpdate({ ...step, l2_config:cfg })}
          t={t} disabled={disabled} />}
      </div>
    </div>}
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// UNIT PROCEDURE CARD (ISA-88 Unit Procedure = MBR Phase) — with drag-drop
// ════════════════════════════════════════════════════════════════════════════

function UnitProcedureCard({ phase, onUpdate, onDelete, t, disabled }) {
  const [collapsed, setCollapsed] = useState(false);
  const [dragOverIdx, setDragOverIdx] = useState(null);
  const dragItem = useRef(null);

  const addOp = () => {
    const nextNum = (phase.steps?.length||0) + 1;
    onUpdate({ ...phase, steps:[...(phase.steps||[]), { id:createId(), _isNew:true, step_number:nextNum, step_name:'', instruction:'', step_type:'Processing', duration_min:'', is_critical:false, is_gmp_critical:false, parameters:[], materials:[], equipment:[] }] });
  };

  // Drag & Drop for operations within this unit procedure
  const handleDragStart = (idx) => { dragItem.current = idx; };
  const handleDragOver = (e, idx) => { e.preventDefault(); setDragOverIdx(idx); };
  const handleDrop = (idx) => {
    const items = [...(phase.steps||[])];
    const dragged = items.splice(dragItem.current, 1)[0];
    items.splice(idx, 0, dragged);
    // Re-number
    items.forEach((s, i) => { s.step_number = i+1; s.sort_order = i+1; });
    onUpdate({ ...phase, steps:items });
    dragItem.current = null;
    setDragOverIdx(null);
  };

  const totalOps = phase.steps?.length || 0;
  const criticalOps = (phase.steps||[]).filter(s => s.is_critical).length;
  const totalParams = (phase.steps||[]).reduce((s, st) => s + (st.parameters?.length||0), 0);

  return <MBRCard t={t} style={{ marginBottom:14, borderLeft:'3px solid '+t.accent, padding:0, overflow:'hidden' }}>
    {/* Header */}
    <div style={{ display:'flex', alignItems:'center', gap:10, padding:'14px 18px', background:t.bgAlt+'80', cursor:'pointer', userSelect:'none', borderBottom:'1px solid '+t.cardBorder+'40' }}
      onClick={() => setCollapsed(!collapsed)}>
      {!disabled && <div style={{ cursor:'grab', color:t.textMuted, display:'flex' }}><GripVertical size={16}/></div>}
      <div style={{ width:32, height:32, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', background:t.accent+'15', border:'1px solid '+t.accent+'25' }}>
        <span style={{ fontSize:14, fontWeight:700, fontFamily:"'DM Mono',monospace", color:t.accent }}>{phase.phase_number}</span>
      </div>
      <div style={{ flex:1 }}>
        <input value={phase.phase_name} onChange={e => { e.stopPropagation(); onUpdate({ ...phase, phase_name:e.target.value }); }} onClick={e => e.stopPropagation()} disabled={disabled}
          placeholder="Unit Procedure name (e.g. Granulation, Compression)..." style={{ background:'transparent', border:'none', color:t.text, fontSize:15, fontWeight:700, outline:'none', width:'100%', opacity:disabled?0.6:1 }} />
      </div>
      <div style={{ display:'flex', alignItems:'center', gap:10 }}>
        <span style={{ fontSize:11, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{totalOps} ops</span>
        {totalParams > 0 && <span style={{ fontSize:10, color:t.textMuted }}>{totalParams} params</span>}
        {criticalOps > 0 && <MBRBadge color={t.danger} t={t}>{criticalOps} CPP</MBRBadge>}
        {!disabled && <button onClick={e => { e.stopPropagation(); onDelete(phase.id); }} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted, padding:4 }}><Trash2 size={14}/></button>}
        {collapsed ? <ChevronRight size={16} color={t.textMuted}/> : <ChevronDown size={16} color={t.textMuted}/>}
      </div>
    </div>

    {/* Operations */}
    {!collapsed && <div style={{ padding:'14px 18px' }}>
      {(phase.steps||[]).map((step, idx) => (
        <div key={step.id}
          draggable={!disabled}
          onDragStart={() => handleDragStart(idx)}
          onDragOver={e => handleDragOver(e, idx)}
          onDrop={() => handleDrop(idx)}
          onDragEnd={() => setDragOverIdx(null)}
          style={{ borderTop: dragOverIdx===idx ? '2px solid '+t.accent : '2px solid transparent', transition:'border 0.15s' }}>
          <OperationCard step={step} t={t} disabled={disabled}
            onUpdate={u => onUpdate({ ...phase, steps:phase.steps.map(s => s.id===u.id?u:s) })}
            onDelete={id => onUpdate({ ...phase, steps:phase.steps.filter(s => s.id!==id) })} />
        </div>
      ))}
      {!disabled && <button onClick={addOp} style={{
        width:'100%', padding:'10px', border:'1px dashed '+t.cardBorder, borderRadius:8, background:'transparent',
        color:t.textMuted, fontSize:12, fontWeight:600, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6,
        transition:'all 0.15s'
      }} onMouseOver={e => { e.target.style.color=t.accent; e.target.style.borderColor=t.accent+'40'; }}
         onMouseOut={e => { e.target.style.color=t.textMuted; e.target.style.borderColor=t.cardBorder; }}>
        <Plus size={13}/>Add Operation (ISA-88)
      </button>}
    </div>}
  </MBRCard>;
}

// ════════════════════════════════════════════════════════════════════════════
// E-SIGNATURE MODAL (Part 11)
// ════════════════════════════════════════════════════════════════════════════

function ESignModal({ open, onClose, onSign, mbrId, mbrCode, signatures, t }) {
  const [role, setRole] = useState('');
  const [pw, setPw] = useState('');
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const handleSign = async () => {
    if (!role || !pw) { setError('Both role and password are required.'); return; }
    if (!mbrId) { setError('No MBR loaded.'); return; }
    setSigning(true); setError('');
    try {
      const meta = SIGNATURE_ROLES.find(r => r.role === role);
      const result = await mbrService.signMBR(mbrId, {
        signature_role: role,
        signature_meaning: meta.meaning,
        password: pw,
      });
      onSign(result);
      setPw(''); setRole(''); onClose();
    } catch (e) {
      setError(e.message || 'Signature failed');
    } finally { setSigning(false); }
  };

  const applied = signatures.map(s => s.signature_role);

  return <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }} onClick={onClose}>
    <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:16, padding:0, width:500, boxShadow:t.shadow }} onClick={e => e.stopPropagation()}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'16px 22px', borderBottom:'1px solid '+t.cardBorder }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ background:t.accent+'12', borderRadius:8, padding:8, display:'flex' }}><Shield size={18} color={t.accent}/></div>
          <div><div style={{ fontSize:15, fontWeight:700, color:t.text }}>Electronic Signature</div><div style={{ fontSize:10, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>21 CFR Part 11 §11.200</div></div>
        </div>
        <button onClick={onClose} style={{ background:'none', border:'none', cursor:'pointer', color:t.textMuted }}><X size={16}/></button>
      </div>
      {/* Body */}
      <div style={{ padding:'18px 22px' }}>
        <div style={{ background:t.bgAlt, borderRadius:8, padding:'10px 14px', marginBottom:16, border:'1px solid '+t.cardBorder }}>
          <div style={{ fontSize:10, color:t.textMuted, textTransform:'uppercase', marginBottom:2 }}>Signing</div>
          <div style={{ fontSize:13, fontWeight:600, color:t.text }}>{mbrCode}</div>
        </div>

        {applied.length > 0 && <div style={{ marginBottom:16 }}>
          <div style={{ fontSize:10, color:t.textMuted, textTransform:'uppercase', marginBottom:6 }}>Applied</div>
          {signatures.map(s => <div key={s.id} style={{ display:'flex', alignItems:'center', gap:6, fontSize:12, marginBottom:4 }}>
            <CheckCircle size={12} color={t.success}/><span style={{ fontWeight:600, color:t.success }}>{s.signature_role}</span>
            <span style={{ color:t.textDim }}>{s.signer_email}</span>
            <span style={{ marginLeft:'auto', fontSize:10, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>{new Date(s.signed_at).toLocaleString()}</span>
          </div>)}
        </div>}

        <div style={{ fontSize:10, color:t.textMuted, textTransform:'uppercase', marginBottom:6 }}>Select Role</div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:16 }}>
          {SIGNATURE_ROLES.map(r => {
            const done = applied.includes(r.role);
            return <button key={r.role} onClick={() => !done && setRole(r.role)} disabled={done} style={{
              textAlign:'left', padding:'10px 12px', borderRadius:8, cursor: done?'not-allowed':'pointer', opacity: done?0.4:1, transition:'all 0.15s',
              background: role===r.role ? t.accent+'12' : t.bgAlt, border:'1px solid '+(role===r.role ? t.accent+'40' : t.cardBorder),
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:5, fontSize:12, fontWeight:600, color:t.text }}>
                {done ? <CheckCircle size={12} color={t.success}/> : role===r.role ? <Lock size={12} color={t.accent}/> : <Unlock size={12} color={t.textMuted}/>}
                {r.role.replace('_',' ')}
              </div>
              <div style={{ fontSize:10, color:t.textMuted, marginTop:2 }}>{r.meaning}</div>
            </button>;
          })}
        </div>

        <MBRInput label="Re-enter Password" t={t} type="password" value={pw} onChange={e => setPw(e.target.value)} placeholder="Confirm identity..." required />
        {error && <div style={{ background:t.danger+'10', border:'1px solid '+t.danger+'30', borderRadius:8, padding:'8px 12px', display:'flex', alignItems:'center', gap:6, marginTop:8 }}><AlertTriangle size={12} color={t.danger}/><span style={{ color:t.danger, fontSize:12 }}>{error}</span></div>}
      </div>
      {/* Footer */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'14px 22px', borderTop:'1px solid '+t.cardBorder }}>
        <span style={{ fontSize:10, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>SHA-256 bound to content</span>
        <div style={{ display:'flex', gap:8 }}>
          <MBRBtn t={t} variant="ghost" onClick={onClose}>Cancel</MBRBtn>
          <MBRBtn t={t} onClick={handleSign} disabled={signing||!role||!pw}>{signing ? <Loader2 size={13} style={{animation:'spin 1s linear infinite'}}/> : <Shield size={13}/>}{signing ? 'Verifying...' : 'Apply Signature'}</MBRBtn>
        </div>
      </div>
    </div>
  </div>;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN: MBR DESIGNER (ISA-88 Procedure)
// ════════════════════════════════════════════════════════════════════════════

export default function MBRDesigner({ theme, toast, mbrId, initialData, onDataChange }) {
  const t = theme;
  // Use API data if provided, fall back to demo data
  const apiMbr = initialData || {};
  const [mbr, setMbr] = useState({
    ...DEMO_MBR,
    ...apiMbr,
    id: apiMbr.id || DEMO_MBR.id,
  });
  const [phases, setPhases] = useState(apiMbr.phases || DEMO_PHASES);
  const [bom, setBom] = useState(apiMbr.bom_items || apiMbr.bom || DEMO_BOM);
  const [signatures, setSignatures] = useState(apiMbr.signatures || DEMO_SIGNATURES);
  const [showSign, setShowSign] = useState(false);
  const [saveStatus, setSaveStatus] = useState('idle');
  const [currentPhase, setCurrentPhase] = useState(null);
  const [activeView, setActiveView] = useState('recipe');
  const [nextSig, setNextSig] = useState(null);

  // Load signatures from API
  useEffect(() => {
    if (mbrId) {
      mbrService.getSignatures(mbrId).then(data => {
        setSignatures(data.data || []);
        setNextSig(data.next_signature || null);
      }).catch(() => {});
    }
  }, [mbrId]);

  // Sync when initialData changes
  useEffect(() => {
    if (initialData) {
      setMbr(prev => ({ ...prev, ...initialData }));
      if (initialData.phases) setPhases(initialData.phases);
      if (initialData.bom_items || initialData.bom) setBom(initialData.bom_items || initialData.bom || []);
      if (initialData.signatures) setSignatures(initialData.signatures);
    }
  }, [initialData]);

  const disabled = !['Draft','In Review'].includes(mbr.status);

  const addPhase = () => {
    const nextNum = phases.length + 1;
    const newPhase = { id:createId(), _isNew:true, phase_number:nextNum, phase_name:'', description:'', sort_order:nextNum, steps:[] };
    setPhases(p => [...p, newPhase]);
  };

  const updatePhase = (u) => setPhases(p => p.map(x => x.id===u.id?u:x));
  const deletePhase = (id) => setPhases(p => p.filter(x => x.id!==id));

  const handleSign = async (result) => {
    // result comes from the API: { signature, mbr_status, content_hash, next_signature }
    if (result.signature) {
      setSignatures(p => [...p, result.signature]);
    }
    if (result.mbr_status) {
      setMbr(p => ({ ...p, status: result.mbr_status }));
    }
    setNextSig(result.next_signature || null);
    // Reload signatures from API
    if (mbrId) {
      try {
        const sigData = await mbrService.getSignatures(mbrId);
        setSignatures(sigData.data || []);
        setNextSig(sigData.next_signature || null);
      } catch {}
    }
  };

  const handleSave = async () => {
    setSaveStatus('saving');
    try {
      const saveId = mbrId || mbr.id;
      await mbrService.saveMBRDesignerState(saveId, mbr, phases, bom);
      if (onDataChange) onDataChange({ ...mbr, phases, bom_items: bom, signatures });
    } catch(e) { console.error(e); }
    setSaveStatus('saved');
    setTimeout(() => setSaveStatus('idle'), 2000);
  };

  // Stats
  const totalSteps = phases.reduce((s, p) => s + (p.steps?.length||0), 0);
  const totalParams = phases.reduce((s, p) => s + (p.steps||[]).reduce((s2, st) => s2 + (st.parameters?.length||0), 0), 0);
  const criticalSteps = phases.reduce((s, p) => s + (p.steps||[]).filter(st => st.is_critical).length, 0);

  return <div style={{ animation:'fadeIn 0.3s ease' }}>
    {/* ISA-88 Header */}
    <MBRCard t={t} style={{ marginBottom:16, padding:'16px 20px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
        <div style={{ display:'flex', alignItems:'center', gap:12 }}>
          <div style={{ background:'linear-gradient(135deg,'+t.accent+','+t.info+')', borderRadius:10, padding:8, display:'flex' }}><FileText size={18} color="#fff"/></div>
          <div>
            <div style={{ display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ fontSize:16, fontWeight:800, color:t.text }}>MBR Designer</span>
              <span style={{ fontSize:12, fontWeight:700, color:t.accent, fontFamily:"'DM Mono',monospace" }}>{mbr.mbr_code}</span>
              <MBRStatusBadge status={mbr.status} t={t}/>
              <span style={{ fontSize:10, color:t.textMuted, fontFamily:"'DM Mono',monospace" }}>v{mbr.current_version}</span>
            </div>
            <div style={{ fontSize:11, color:t.textMuted }}>ISA-88 Recipe Hierarchy · Procedure → Unit Procedure → Operation</div>
          </div>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {/* Stats */}
          <span style={{ fontSize:10, fontFamily:"'DM Mono',monospace", color:t.textDim, padding:'3px 8px', background:t.bgAlt, borderRadius:5 }}>{phases.length} phases</span>
          <span style={{ fontSize:10, fontFamily:"'DM Mono',monospace", color:t.textDim, padding:'3px 8px', background:t.bgAlt, borderRadius:5 }}>{totalSteps} ops</span>
          {criticalSteps > 0 && <MBRBadge color={t.danger} t={t}><AlertTriangle size={10}/>{criticalSteps} CPP</MBRBadge>}
          <MBRBtn t={t} variant="ghost" size="sm" onClick={() => setShowSign(true)}><Shield size={13}/>e-Sign</MBRBtn>
          <MBRBtn t={t} size="sm" onClick={handleSave} disabled={disabled||saveStatus==='saving'}>
            {saveStatus==='saving' ? <Loader2 size={13} style={{animation:'spin 1s linear infinite'}}/> : saveStatus==='saved' ? <CheckCircle size={13}/> : <Save size={13}/>}
            {saveStatus==='saving' ? 'Saving...' : saveStatus==='saved' ? 'Saved' : 'Save'}
          </MBRBtn>
        </div>
      </div>

      {/* Lock banner */}
      {disabled && <div style={{ background:t.warning+'10', border:'1px solid '+t.warning+'30', borderRadius:8, padding:'8px 14px', display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
        <Lock size={13} color={t.warning}/><span style={{ color:t.warning, fontSize:12, fontWeight:600 }}>Record locked — status: {mbr.status}</span>
      </div>}

      {/* Batch Record Details */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:12 }}>
        <MBRInput label="Product Name" t={t} value={mbr.product_name} onChange={e => setMbr(p => ({...p, product_name:e.target.value}))} required disabled={disabled} placeholder="e.g. Amoxicillin 500mg" />
        <MBRInput label="Product Code" t={t} value={mbr.product_code} onChange={e => setMbr(p => ({...p, product_code:e.target.value}))} disabled={disabled} placeholder="PROD-001" />
        <MBRSelect label="Dosage Form" t={t} value={mbr.dosage_form} onChange={e => setMbr(p => ({...p, dosage_form:e.target.value}))} options={DOSAGE_FORMS} disabled={disabled} />
        <MBRInput label="Batch Size" t={t} value={mbr.batch_size} onChange={e => setMbr(p => ({...p, batch_size:e.target.value}))} type="number" unit={mbr.batch_size_unit} disabled={disabled} placeholder="500" />
      </div>
      <div style={{ marginTop:4 }}>
        <label style={{ color:t.textDim, fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4, display:'block' }}>Description</label>
        <textarea value={mbr.description} onChange={e => setMbr(p => ({...p, description:e.target.value}))} disabled={disabled} rows={2} placeholder="Manufacturing procedure description..."
          style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:8, padding:'9px 12px', fontSize:13, outline:'none', resize:'none', fontFamily:'inherit' }} />
      </div>
    </MBRCard>

    {/* Approval Workflow Bar (real API) */}
    <ApprovalWorkflowBar
      mbrId={mbrId || mbr.id}
      status={mbr.status}
      signatures={signatures}
      nextSignature={nextSig}
      onSignRequest={(role) => setShowSign(true)}
      t={t}
    />

    {/* Version History Panel */}
    <VersionHistoryPanel
      mbrId={mbrId || mbr.id}
      currentVersion={mbr.current_version}
      status={mbr.status}
      t={t}
      onVersionCreated={(result) => {
        setMbr(p => ({ ...p, current_version: result.new_version, status: 'Draft' }));
        setSignatures([]);
        setNextSig('Author');
      }}
    />

    {/* View Toggle Tabs */}
    <div style={{ display:'flex', gap:4, marginBottom:16 }}>
      {[
        { key:'recipe', label:'Recipe Designer', icon:Layers },
        { key:'flow', label:'Process Flow', icon:Activity },
        { key:'bom', label:'Bill of Materials', icon:Package },
      ].map(v => (
        <button key={v.key} onClick={() => setActiveView(v.key)} style={{
          display:'flex', alignItems:'center', gap:6, padding:'8px 16px', borderRadius:8, cursor:'pointer', transition:'all 0.15s', fontSize:12, fontWeight:600,
          background: activeView===v.key ? t.accent+'15' : t.bgAlt, border:'1px solid '+(activeView===v.key ? t.accent+'40' : t.cardBorder),
          color: activeView===v.key ? t.accent : t.textDim
        }}><v.icon size={14}/>{v.label}</button>
      ))}
    </div>

    {/* VIEW: Process Flow Diagram */}
    {activeView === 'flow' && <ProcessFlowDiagram phases={phases} t={t} onSelectPhase={id => { setCurrentPhase(id); setActiveView('recipe'); }}/>}

    {/* VIEW: Bill of Materials */}
    {activeView === 'bom' && <BOMSection bom={bom} onUpdate={setBom} t={t} disabled={disabled} batchSize={mbr.batch_size} batchUnit={mbr.batch_size_unit}/>}

    {/* VIEW: Recipe Designer (ISA-88 hierarchy) */}
    {activeView === 'recipe' && <>

    {/* ISA-88 Process Flow Bar */}
    <ProcessFlowBar phases={phases} currentPhase={currentPhase} t={t}/>

    {/* Unit Procedures (Phases) */}
    <SectionTitle icon={Layers} title="ISA-88 Unit Procedures" count={phases.length} t={t}
      right={!disabled && <MBRBtn t={t} variant="accent" size="sm" onClick={addPhase}><Plus size={13}/>Add Unit Procedure</MBRBtn>} />

    {phases.length === 0 ? (
      <div style={{ border:'1px dashed '+t.cardBorder, borderRadius:12, padding:'48px 0', display:'flex', flexDirection:'column', alignItems:'center', gap:12 }}>
        <Layers size={28} color={t.textMuted}/>
        <p style={{ color:t.textMuted, fontSize:13 }}>No unit procedures defined yet.</p>
        <p style={{ color:t.textMuted, fontSize:11 }}>ISA-88: Procedure → Unit Procedure → Operation → Phase</p>
        {!disabled && <MBRBtn t={t} variant="accent" onClick={addPhase} style={{marginTop:8}}><Plus size={13}/>Create First Unit Procedure</MBRBtn>}
      </div>
    ) : phases.map(phase => (
      <UnitProcedureCard key={phase.id} phase={phase} t={t} disabled={disabled} onUpdate={updatePhase} onDelete={deletePhase}/>
    ))}

    </>}

    {/* E-Signature Modal */}
    <ESignModal open={showSign} onClose={() => setShowSign(false)} onSign={handleSign} mbrId={mbrId || mbr.id} mbrCode={mbr.mbr_code} signatures={signatures} t={t}/>
  </div>;
}
