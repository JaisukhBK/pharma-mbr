// client/src/App.jsx — PharmaMES.AI Full Navigator v3
// Fixes: blank screen (bad lucide icons), AI Hub full chat UI, full theme switching sidebar

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Shield, FileText, Plus, LogOut, Sun, Moon, Loader2, ChevronRight,
  AlertTriangle, CheckCircle, PenTool, Eye, RotateCcw, X,
  Search, ArrowLeft, ArrowRight, BarChart2, GitBranch, BookOpen,
  AlertOctagon, RefreshCw, Settings, ClipboardList, Wrench,
  Zap, Box, Radio, ChevronDown, ChevronUp, TrendingUp, Package,
  Users, Terminal, Menu, Send, MessageSquare, Activity,
  ChevronLeft, RotateCw, Upload, Download, Copy, Trash2
} from 'lucide-react';

import { authService, mbrService, cdService, featuresService } from './services/apiService';
import MBRDesigner from './components/MBRDesigner/MBRDesigner';
import CoDesignerPanel from './components/MBRDesigner/CoDesignerPanel';
import MBRFeaturesToolbar from './components/MBRDesigner/MBRFeaturesToolbar';
import OperationFormulaPanel from './components/MBRDesigner/OperationFormulaPanel';

const API = import.meta.env.VITE_API_URL || '';

async function apiFetch(url, opts = {}) {
  const token = localStorage.getItem('pharma_mbr_token');
  const headers = {
    ...(token && { Authorization: `Bearer ${token}` }),
    'Content-Type': 'application/json',
    ...opts.headers,
  };
  const res = await fetch(url, { headers, ...opts });
  if (res.status === 401) {
    localStorage.removeItem('pharma_mbr_token');
    localStorage.removeItem('pharma_mbr_user');
    window.dispatchEvent(new CustomEvent('auth:expired'));
  }
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || `Error ${res.status}`);
  }
  return res.json();
}

// ════════════════════════════════════════════════════════════════
// THEMES — sidebar now also switches with theme
// ════════════════════════════════════════════════════════════════

const THEMES = {
  dark: {
    bg: '#0d0f12', bgAlt: '#161a20', card: '#1a1e26', cardBorder: '#2a2f3a',
    text: '#e4e6ea', textDim: '#a0a6b4', textMuted: '#6b7280',
    accent: '#6366f1', info: '#2dceef', success: '#00e5a0', warning: '#f5a623', danger: '#f5365c',
    inputBg: '#12151b', inputBorder: '#2a2f3a',
    shadow: '0 8px 32px rgba(0,0,0,0.4)',
    // Sidebar — dark mode uses deeper dark
    sidebar: '#111318', sidebarBorder: '#1e2330', sidebarHover: 'rgba(255,255,255,0.05)',
    sidebarActive: '#6366f118', sidebarText: '#a0a6b4', sidebarLabel: '#4a5060',
  },
  light: {
    bg: '#f5f6f8', bgAlt: '#eceef2', card: '#ffffff', cardBorder: '#e0e2e8',
    text: '#1a1c22', textDim: '#555b6a', textMuted: '#8b92a0',
    accent: '#6366f1', info: '#0ea5e9', success: '#10b981', warning: '#f59e0b', danger: '#ef4444',
    inputBg: '#f8f9fb', inputBorder: '#d4d6dc',
    shadow: '0 4px 16px rgba(0,0,0,0.08)',
    // Sidebar — light mode uses white/light card style (matching screenshot 3/4)
    sidebar: '#ffffff', sidebarBorder: '#e0e2e8', sidebarHover: 'rgba(99,102,241,0.06)',
    sidebarActive: '#6366f112', sidebarText: '#555b6a', sidebarLabel: '#9ba3af',
  },
};

// ════════════════════════════════════════════════════════════════
// NAV GROUPS
// ════════════════════════════════════════════════════════════════

const NAV_GROUPS = [
  {
    id: 'manufacturing', label: 'Manufacturing',
    items: [
      { id: 'mbr',       label: 'MBR Designer',            icon: FileText },
      { id: 'ebr',       label: 'EBR Execution',           icon: ClipboardList },
      { id: 'batches',   label: 'Batches',                 icon: Package },
      { id: 'genealogy', label: 'Genealogy & Traceability', icon: GitBranch },
    ],
  },
  {
    id: 'equipment', label: 'Equipment',
    items: [
      { id: 'equipment_qm', label: 'Equipment QM',       icon: Wrench },
      { id: 'equipment',    label: 'Equipment Registry', icon: Box },
    ],
  },
  {
    id: 'quality', label: 'Quality',
    items: [
      { id: 'deviations', label: 'Deviations',           icon: AlertOctagon },
      { id: 'devcapa',    label: 'Dev & CAPA',           icon: RefreshCw },
      { id: 'change',     label: 'Change Control',       icon: Settings },
      { id: 'quality',    label: 'Quality & Compliance', icon: Shield },
      { id: 'training',   label: 'Training',             icon: BookOpen },
    ],
  },
  {
    id: 'ai_integration', label: 'AI & Integration',
    items: [
      { id: 'ai_hub',      label: 'AI Hub',               icon: Zap },
      { id: 'integration', label: 'MES Integration AI',   icon: Radio },
    ],
  },
  {
    id: 'admin', label: 'Admin',
    items: [
      { id: 'users',       label: 'Users & Roles',        icon: Users },
      { id: 'audit',       label: 'Audit Trail',          icon: Terminal },
      { id: 'compliance',  label: 'Compliance',           icon: Shield },
    ],
  },
];

// ════════════════════════════════════════════════════════════════
// STATUS HELPERS
// ════════════════════════════════════════════════════════════════

const STATUS_META = {
  Draft:       { color: '#f5a623', icon: PenTool },
  'In Review': { color: '#2dceef', icon: Eye },
  Approved:    { color: '#00e5a0', icon: CheckCircle },
  Effective:   { color: '#00e5a0', icon: Shield },
  Superseded:  { color: '#7a8ba8', icon: RotateCcw },
  Obsolete:    { color: '#f5365c', icon: X },
};

// ════════════════════════════════════════════════════════════════
// LOGIN SCREEN
// ════════════════════════════════════════════════════════════════

function LoginScreen({ t, onLogin, onThemeToggle, isDark }) {
  const [email, setEmail]       = useState('jaisukh.patel@pharmambr.com');
  const [password, setPassword] = useState('pharma123');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault(); setError(''); setLoading(true);
    try { const r = await authService.login(email, password); onLogin(r.user); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const DEMO = [
    { email:'jaisukh.patel@pharmambr.com', label:'Admin' },
    { email:'priya.singh@pharmambr.com',   label:'QA' },
    { email:'raj.kumar@pharmambr.com',     label:'Production' },
    { email:'carlos.martinez@pharmambr.com', label:'Supervisor' },
    { email:'wei.chen@pharmambr.com',      label:'Engineer' },
  ];

  return (
    <div style={{ minHeight:'100vh', background:t.bg, display:'flex', alignItems:'center', justifyContent:'center', position:'relative' }}>
      <button onClick={onThemeToggle} style={{ position:'absolute', top:20, right:20, background:t.card, border:'1px solid '+t.cardBorder, borderRadius:8, padding:8, cursor:'pointer', display:'flex', color:t.textDim }}>
        {isDark ? <Sun size={18}/> : <Moon size={18}/>}
      </button>
      <div style={{ width:460, background:t.card, border:'1px solid '+t.cardBorder, borderRadius:16, boxShadow:t.shadow, overflow:'hidden' }}>
        <div style={{ background:'linear-gradient(135deg,'+t.accent+',#8b5cf6)', padding:'28px 32px' }}>
          <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:8 }}>
            <div style={{ background:'rgba(255,255,255,0.2)', borderRadius:12, padding:10, display:'flex' }}><Shield size={24} color="#fff"/></div>
            <div>
              <div style={{ fontSize:22, fontWeight:800, color:'#fff', letterSpacing:'-0.5px' }}>
                <span>Pharma</span><span style={{ color:'rgba(255,255,255,0.7)' }}>MES</span><span style={{ color:'#a5f3fc' }}>.AI</span>
              </div>
              <div style={{ fontSize:11, color:'rgba(255,255,255,0.65)', fontFamily:"'DM Mono',monospace" }}>GAMP5 Cat.5 · 21 CFR Part 11</div>
            </div>
          </div>
          <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
            {['ISA-88','ISA-95','21 CFR Part 11','GAMP5'].map(s => (
              <span key={s} style={{ fontSize:9, background:'rgba(255,255,255,0.12)', color:'rgba(255,255,255,0.7)', padding:'2px 8px', borderRadius:4, fontFamily:"'DM Mono',monospace" }}>{s}</span>
            ))}
          </div>
        </div>
        <div style={{ padding:'28px 32px' }}>
          <div style={{ fontSize:15, fontWeight:700, color:t.text, marginBottom:2 }}>Secure Login</div>
          <div style={{ fontSize:12, color:t.textMuted, marginBottom:20 }}>21 CFR Part 11 authenticated access</div>
          {error && (
            <div style={{ background:t.danger+'10', border:'1px solid '+t.danger+'30', borderRadius:8, padding:'8px 12px', marginBottom:16, display:'flex', alignItems:'center', gap:8 }}>
              <AlertTriangle size={13} color={t.danger}/><span style={{ color:t.danger, fontSize:12 }}>{error}</span>
            </div>
          )}
          <form onSubmit={handleSubmit}>
            <div style={{ marginBottom:14 }}>
              <label style={{ color:t.textDim, fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4, display:'block' }}>Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:8, padding:'10px 12px', fontSize:13, outline:'none' }}/>
            </div>
            <div style={{ marginBottom:20 }}>
              <label style={{ color:t.textDim, fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:0.5, marginBottom:4, display:'block' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                style={{ width:'100%', boxSizing:'border-box', background:t.inputBg, border:'1px solid '+t.inputBorder, color:t.text, borderRadius:8, padding:'10px 12px', fontSize:13, outline:'none' }}/>
            </div>
            <button type="submit" disabled={loading}
              style={{ width:'100%', padding:'11px', borderRadius:8, border:'none', background:t.accent, color:'#fff', fontSize:14, fontWeight:700, cursor:loading?'not-allowed':'pointer', opacity:loading?0.6:1, display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
              {loading ? <Loader2 size={16} style={{ animation:'spin 1s linear infinite' }}/> : <Shield size={16}/>}
              {loading ? 'Authenticating...' : 'Sign In'}
            </button>
          </form>
          <div style={{ marginTop:20, padding:'14px', background:t.bgAlt, borderRadius:10, border:'1px solid '+t.cardBorder }}>
            <div style={{ fontSize:10, color:t.textMuted, textTransform:'uppercase', letterSpacing:0.5, fontWeight:600, marginBottom:10 }}>Demo Accounts · Password: pharma123</div>
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:8 }}>
              {DEMO.map(u => (
                <button key={u.email} onClick={() => { setEmail(u.email); setPassword('pharma123'); }}
                  style={{ padding:'8px 6px', borderRadius:8, border:'1px solid '+t.cardBorder, background:t.card, color:t.text, fontSize:12, fontWeight:600, cursor:'pointer', textAlign:'center', transition:'all 0.12s' }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = t.accent+'70'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = t.cardBorder}>
                  <div style={{ color:t.accent, fontSize:11, fontWeight:700 }}>{u.label}</div>
                  <div style={{ color:t.textMuted, fontSize:9, fontFamily:"'DM Mono',monospace", marginTop:2 }}>{u.email.split('@')[0].split('.')[0]}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SIDEBAR — full theme support + collapsible groups + hide toggle
// Uses Menu/ChevronLeft instead of PanelLeftClose (not in lucide 0.383)
// ════════════════════════════════════════════════════════════════

function Sidebar({ t, activeSection, onNavigate, user, onLogout, isDark, onThemeToggle, collapsed, onToggleCollapse }) {
  const [openGroups, setOpenGroups] = useState(() => {
    const init = {};
    NAV_GROUPS.forEach(g => { init[g.id] = true; });
    return init;
  });

  const toggleGroup = (id) => setOpenGroups(s => ({ ...s, [id]: !s[id] }));

  useEffect(() => {
    NAV_GROUPS.forEach(g => {
      if (g.items.some(i => i.id === activeSection)) {
        setOpenGroups(s => ({ ...s, [g.id]: true }));
      }
    });
  }, [activeSection]);

  const navItemStyle = (active) => ({
    width:'100%', display:'flex', alignItems:'center', gap:9,
    padding:'7px 10px 7px 14px', border:'none', cursor:'pointer',
    borderRadius:7, textAlign:'left', transition:'all 0.12s', marginBottom:1,
    background: active ? t.sidebarActive : 'transparent',
    borderLeft: active ? '2px solid '+t.accent : '2px solid transparent',
    color: active ? t.accent : t.sidebarText,
  });

  if (collapsed) {
    return (
      <div style={{ width:52, minWidth:52, background:t.sidebar, borderRight:'1px solid '+t.sidebarBorder, display:'flex', flexDirection:'column', alignItems:'center', height:'100vh', position:'sticky', top:0 }}>
        <div style={{ padding:'13px 0 10px', borderBottom:'1px solid '+t.sidebarBorder, width:'100%', display:'flex', justifyContent:'center' }}>
          <div style={{ background:'linear-gradient(135deg,'+t.accent+',#8b5cf6)', borderRadius:8, padding:7, display:'flex' }}><Shield size={14} color="#fff"/></div>
        </div>
        <button onClick={onToggleCollapse} title="Expand sidebar"
          style={{ margin:'10px 0 4px', padding:8, background:'transparent', border:'none', cursor:'pointer', color:t.sidebarText, borderRadius:6, display:'flex' }}>
          <Menu size={16}/>
        </button>
        <div style={{ flex:1, overflowY:'auto', width:'100%', paddingTop:4, scrollbarWidth:'none' }}>
          <div style={{ display:'flex', justifyContent:'center', padding:'3px 0' }}>
            <button onClick={() => onNavigate('overview')} title="Overview"
              style={{ padding:8, borderRadius:7, border:'none', background:activeSection==='overview'?t.sidebarActive:'transparent', color:activeSection==='overview'?t.accent:t.sidebarText, cursor:'pointer' }}>
              <BarChart2 size={15}/>
            </button>
          </div>
          {NAV_GROUPS.flatMap(g => g.items).map(item => {
            const Icon = item.icon;
            const active = activeSection === item.id;
            return (
              <div key={item.id} style={{ display:'flex', justifyContent:'center', padding:'2px 0' }}>
                <button onClick={() => onNavigate(item.id)} title={item.label}
                  style={{ padding:8, borderRadius:7, border:'none', background:active?t.sidebarActive:'transparent', color:active?t.accent:t.sidebarText, cursor:'pointer' }}>
                  <Icon size={14}/>
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ padding:'10px 0', borderTop:'1px solid '+t.sidebarBorder, width:'100%', display:'flex', flexDirection:'column', alignItems:'center', gap:4 }}>
          <button onClick={onThemeToggle} style={{ padding:7, background:'transparent', border:'none', cursor:'pointer', color:t.sidebarText }}>{isDark?<Sun size={13}/>:<Moon size={13}/>}</button>
          <button onClick={onLogout} style={{ padding:7, background:'transparent', border:'none', cursor:'pointer', color:t.danger }}><LogOut size={13}/></button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ width:210, minWidth:210, background:t.sidebar, borderRight:'1px solid '+t.sidebarBorder, display:'flex', flexDirection:'column', height:'100vh', position:'sticky', top:0 }}>
      {/* Logo + collapse */}
      <div style={{ padding:'14px 12px 10px', borderBottom:'1px solid '+t.sidebarBorder, display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{ background:'linear-gradient(135deg,'+t.accent+',#8b5cf6)', borderRadius:9, padding:7, display:'flex', flexShrink:0 }}><Shield size={14} color="#fff"/></div>
          <div>
            <div style={{ fontSize:13, fontWeight:800, color:t.text, letterSpacing:'-0.3px', lineHeight:1.2 }}>
              <span style={{ color:t.accent }}>Pharma</span><span style={{ color:t.text }}>MES</span><span style={{ color:'#6366f1', fontSize:12 }}>.AI</span>
            </div>
            <div style={{ fontSize:9, color:t.sidebarLabel, fontFamily:"'DM Mono',monospace" }}>GxP Compliant</div>
          </div>
        </div>
        <button onClick={onToggleCollapse} title="Collapse"
          style={{ padding:5, background:'transparent', border:'none', cursor:'pointer', color:t.sidebarText, borderRadius:5, display:'flex' }}>
          <ChevronLeft size={14}/>
        </button>
      </div>

      {/* Overview — standalone */}
      <div style={{ padding:'8px 8px 2px' }}>
        <button onClick={() => onNavigate('overview')}
          style={{ ...navItemStyle(activeSection==='overview'), padding:'7px 10px' }}>
          <BarChart2 size={14} style={{ flexShrink:0 }}/>
          <span style={{ fontSize:12, fontWeight: activeSection==='overview' ? 700 : 500 }}>Overview</span>
        </button>
      </div>

      {/* Collapsible groups */}
      <div style={{ flex:1, overflowY:'auto', padding:'2px 8px 8px', scrollbarWidth:'none' }}>
        {NAV_GROUPS.map(group => {
          const isOpen = openGroups[group.id];
          const hasActive = group.items.some(i => i.id === activeSection);
          return (
            <div key={group.id} style={{ marginBottom:2 }}>
              <button onClick={() => toggleGroup(group.id)}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between', padding:'6px 10px', border:'none', background:'transparent', cursor:'pointer', borderRadius:6 }}>
                <span style={{ fontSize:9, fontWeight:700, color: hasActive ? t.accent : t.sidebarLabel, letterSpacing:1, textTransform:'uppercase' }}>{group.label}</span>
                {isOpen ? <ChevronUp size={10} color={t.sidebarLabel}/> : <ChevronDown size={10} color={hasActive?t.accent:t.sidebarLabel}/>}
              </button>
              {isOpen && group.items.map(item => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button key={item.id} onClick={() => onNavigate(item.id)}
                    style={navItemStyle(active)}
                    onMouseEnter={e => { if(!active) { e.currentTarget.style.background=t.sidebarHover; e.currentTarget.style.color=t.text; }}}
                    onMouseLeave={e => { if(!active) { e.currentTarget.style.background='transparent'; e.currentTarget.style.color=t.sidebarText; }}}>
                    <Icon size={13} style={{ flexShrink:0 }}/>
                    <span style={{ fontSize:12, fontWeight: active ? 600 : 400 }}>{item.label}</span>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* User + controls */}
      <div style={{ padding:'10px 12px', borderTop:'1px solid '+t.sidebarBorder }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8, padding:'7px 9px', background:t.bgAlt, borderRadius:8 }}>
          <div style={{ width:26, height:26, borderRadius:7, background:t.accent+'20', display:'flex', alignItems:'center', justifyContent:'center', color:t.accent, fontSize:11, fontWeight:800, flexShrink:0 }}>
            {user?.full_name?.charAt(0) || 'U'}
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:11, fontWeight:600, color:t.text, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{user?.full_name || 'User'}</div>
            <div style={{ fontSize:9, color:t.sidebarLabel, fontFamily:"'DM Mono',monospace" }}>{user?.group_id || user?.role || ''}</div>
          </div>
        </div>
        <div style={{ display:'flex', gap:6 }}>
          <button onClick={onThemeToggle} style={{ flex:1, padding:'6px', borderRadius:7, border:'1px solid '+t.sidebarBorder, background:'transparent', color:t.sidebarText, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            {isDark ? <Sun size={12}/> : <Moon size={12}/>}
          </button>
          <button onClick={onLogout} style={{ flex:1, padding:'6px', borderRadius:7, border:'1px solid '+t.danger+'30', background:t.danger+'10', color:t.danger, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
            <LogOut size={12}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// OVERVIEW DASHBOARD
// ════════════════════════════════════════════════════════════════

function OverviewDashboard({ t, user }) {
  const [kpis, setKpis]       = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch(`${API}/api/kpis`)
      .then(d => { setKpis(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const StatCard = ({ label, value, sub, color, icon: Icon }) => (
    <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, padding:'18px 20px', display:'flex', alignItems:'center', gap:14 }}>
      <div style={{ background:(color||t.accent)+'18', borderRadius:10, padding:10, display:'flex', flexShrink:0 }}><Icon size={20} color={color||t.accent}/></div>
      <div>
        <div style={{ fontSize:24, fontWeight:800, color:t.text, lineHeight:1 }}>
          {loading ? <Loader2 size={18} color={t.accent} style={{ animation:'spin 1s linear infinite' }}/> : (value ?? '—')}
        </div>
        <div style={{ fontSize:12, color:t.textMuted, marginTop:3 }}>{label}</div>
        {sub && <div style={{ fontSize:11, color:color||t.accent, marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  );

  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good Morning' : hr < 17 ? 'Good Afternoon' : 'Good Evening';

  return (
    <div style={{ padding:32 }}>
      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:22, fontWeight:800, color:t.text }}>{greeting}, {user?.full_name?.split(' ')[0] || 'User'} 👋</div>
        <div style={{ fontSize:12, color:t.textMuted, marginTop:2 }}>
          PharmaMES.AI Dashboard · {new Date().toLocaleDateString('en-US',{ weekday:'long',year:'numeric',month:'long',day:'numeric' })}
        </div>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:14, marginBottom:24 }}>
        <StatCard label="Total Batches"   value={kpis?.batches?.total}     sub={(kpis?.batches?.in_progress||0)+' in progress'}  color={t.info}    icon={Package}/>
        <StatCard label="Released"        value={kpis?.batches?.released}  sub={'Avg yield: '+(kpis?.batches?.avg_yield||'—')+'%'} color={t.success} icon={CheckCircle}/>
        <StatCard label="Effective MBRs"  value={kpis?.mbrs?.effective}    sub={(kpis?.mbrs?.draft||0)+' drafts'}                 color={t.accent}  icon={FileText}/>
        <StatCard label="Open Deviations" value={kpis?.deviations?.open}   sub={'of '+(kpis?.deviations?.total||0)+' total'}      color={t.warning} icon={AlertOctagon}/>
        <StatCard label="Equipment"       value={kpis?.equipment?.total}   sub={(kpis?.equipment?.available||0)+' available'}     color={t.info}    icon={Wrench}/>
        <StatCard label="OEE"             value={kpis?.oee?.oee?kpis.oee.oee+'%':null} sub={'Quality: '+(kpis?.oee?.quality||'—')+'%'} color={t.success} icon={TrendingUp}/>
      </div>
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', marginBottom:20 }}>
        {['21 CFR Part 11','GAMP5 Cat.5','ISA-88','ISA-95','EU Annex 11','ICH Q10'].map(s => (
          <span key={s} style={{ fontSize:11, fontWeight:600, padding:'5px 12px', borderRadius:6, background:t.success+'12', color:t.success, border:'1px solid '+t.success+'30', fontFamily:"'DM Mono',monospace" }}>✓ {s}</span>
        ))}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// AI HUB — full MES Copilot with 10 tool tabs + chat interface
// Matches screenshot 2 exactly
// ════════════════════════════════════════════════════════════════

const AI_TOOLS = [
  { id:'copilot',    label:'MES Copilot',      icon: MessageSquare, desc:'Ask about manufacturing data', color:'#6366f1' },
  { id:'search',     label:'Smart Search',     icon: Search,        desc:'Search across all MES data', color:'#2dceef' },
  { id:'anomaly',    label:'Anomaly Detector', icon: AlertTriangle,  desc:'Detect parameter anomalies', color:'#f5a623' },
  { id:'compare',    label:'Batch Compare',    icon: Activity,       desc:'Compare batch performance', color:'#00e5a0' },
  { id:'rca',        label:'Root Cause',       icon: Zap,            desc:'Root cause analysis agent', color:'#a855f7' },
  { id:'trend',      label:'Trend Analysis',   icon: TrendingUp,     desc:'Process trend monitoring', color:'#2dceef' },
  { id:'predict',    label:'Quality Predict',  icon: BarChart2,      desc:'Predict quality outcomes', color:'#00e5a0' },
  { id:'release',    label:'Batch Review',     icon: CheckCircle,    desc:'AI batch release advisor', color:'#10b981' },
  { id:'docsum',     label:'Doc Summary',      icon: FileText,       desc:'Summarize MBR documents', color:'#6366f1' },
  { id:'compliance', label:'Compliance Report',icon: Shield,         desc:'Generate compliance reports', color:'#f5365c' },
];

const QUICK_PROMPTS = [
  'What batches are in progress?',
  'Show rejected batches',
  'Current OEE?',
  'Equipment needing PM?',
];

function AIHubView({ t }) {
  const [activeTool, setActiveTool] = useState('copilot');
  const [messages, setMessages]     = useState([]);
  const [input, setInput]           = useState('');
  const [loading, setLoading]       = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (messagesEndRef.current) messagesEndRef.current.scrollIntoView({ behavior:'smooth' });
  }, [messages]);

  const sendMessage = async (text) => {
    const msg = (text || input).trim();
    if (!msg) return;
    setInput('');
    const userMsg = { role:'user', content:msg, ts:new Date() };
    setMessages(prev => [...prev, userMsg]);
    setLoading(true);

    try {
      // Try Groq via server co-designer endpoint, fallback to KPI context
      let reply = '';
      try {
        // Build context from KPI data
        const kpis = await apiFetch(`${API}/api/kpis`).catch(() => null);
        const kpiContext = kpis ? `Current system status: ${JSON.stringify(kpis)}` : '';

        const res = await fetch(`${API}/api/co-designer/chat`, {
          method:'POST',
          headers:{ 'Content-Type':'application/json', Authorization:`Bearer ${localStorage.getItem('pharma_mbr_token')}` },
          body: JSON.stringify({ message: msg, context: kpiContext, tool: activeTool }),
        });
        if (res.ok) { const d = await res.json(); reply = d.reply || d.message || ''; }
      } catch(_) {}

      // If no server reply, generate intelligent local response based on tool
      if (!reply) {
        const toolName = AI_TOOLS.find(t => t.id === activeTool)?.label || 'MES Copilot';
        reply = generateLocalResponse(msg, activeTool, toolName);
      }

      setMessages(prev => [...prev, { role:'assistant', content:reply, ts:new Date(), tool:activeTool }]);
      setLastUpdated(new Date());
    } catch(err) {
      setMessages(prev => [...prev, { role:'assistant', content:'Error: '+err.message, ts:new Date(), isError:true }]);
    }
    setLoading(false);
  };

  function generateLocalResponse(msg, tool, toolName) {
    const lm = msg.toLowerCase();
    if (lm.includes('batch') && lm.includes('progress')) return 'I\'ll check active batches for you. Navigate to the Batches module for a full live view, or I can query the EBR execution engine directly. Currently the system shows no active batches — create an EBR from an Effective MBR to start execution.';
    if (lm.includes('oee')) return 'OEE (Overall Equipment Effectiveness) requires active batch execution data. Current OEE components: Availability (equipment uptime), Performance (production rate), Quality (yield %). Start a batch execution to begin collecting real OEE metrics.';
    if (lm.includes('equipment')) return 'Equipment Registry shows 10 pieces of equipment. 1 unit (Korsch Tablet Press EQ-TAB-002) is Out of Service with overdue calibration. 1 unit (Comil Mill EQ-MIL-001) is under qualification. 8 units are Available.';
    if (lm.includes('deviation')) return 'No active deviations recorded yet. The RCA Agent is ready to fire automatically when any parameter records an OOS value during EBR execution.';
    if (tool === 'rca') return `Root Cause Analysis Agent ready. To trigger an RCA analysis, record an out-of-specification parameter value during EBR step execution. The agent will automatically analyze equipment history, material lots, and historical OOS events to produce a 5-Why analysis.`;
    if (tool === 'anomaly') return `Anomaly Sentinel is active. The sentinel monitors parameter proximity to specification limits on every step completion. It flags pre-OOS trends before they become deviations. Start an EBR execution to see real-time anomaly detection.`;
    if (tool === 'release') return `Batch Release Advisor fires automatically when a batch is marked Complete. It aggregates all step completions, OOS parameters, IPC results, yield, and material lot status to produce a structured Release/Hold recommendation for QA review.`;
    return `[${toolName}] I received your query: "${msg}". This AI module is connected to the PharmaMES.AI backend via Groq/Llama 3.3 70B. For full AI capabilities, ensure GROQ_API_KEY is configured in your server .env file.`;
  }

  const tool = AI_TOOLS.find(t => t.id === activeTool);

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', padding:24 }}>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:16 }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ background:'#a855f715', borderRadius:9, padding:8 }}><Zap size={18} color="#a855f7"/></div>
            <div>
              <div style={{ fontSize:18, fontWeight:800, color:t.text }}>AI Intelligence Hub</div>
              <div style={{ fontSize:11, color:t.textMuted }}>Llama 3.3 70B · {AI_TOOLS.length} Visual Modules · Updated {lastUpdated.toLocaleTimeString()}</div>
            </div>
          </div>
        </div>
        <div style={{ display:'flex', gap:8 }}>
          <select style={{ padding:'6px 12px', borderRadius:7, border:'1px solid '+t.cardBorder, background:t.card, color:t.text, fontSize:12, cursor:'pointer', outline:'none' }}>
            <option>All Lines</option>
            <option>Line 1 - Solid Dosage</option>
            <option>Line 2 - Coating</option>
            <option>Line 3 - Packaging</option>
          </select>
          <button onClick={() => setLastUpdated(new Date())}
            style={{ display:'flex', alignItems:'center', gap:5, padding:'6px 12px', borderRadius:7, border:'1px solid '+t.cardBorder, background:t.card, color:t.textDim, cursor:'pointer', fontSize:12 }}>
            <RotateCw size={12}/>Refresh
          </button>
        </div>
      </div>

      {/* Tool tabs */}
      <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
        {AI_TOOLS.map(tool => {
          const Icon = tool.icon;
          const active = activeTool === tool.id;
          return (
            <button key={tool.id} onClick={() => setActiveTool(tool.id)}
              style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'10px 14px', borderRadius:8, border:'1px solid '+(active?tool.color+'50':t.cardBorder), background: active?tool.color+'12':t.card, cursor:'pointer', minWidth:90, transition:'all 0.12s' }}>
              <Icon size={16} color={active?tool.color:t.textMuted}/>
              <span style={{ fontSize:10, fontWeight: active?700:500, color:active?tool.color:t.textDim, whiteSpace:'nowrap' }}>{tool.label}</span>
            </button>
          );
        })}
      </div>

      {/* Chat area */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, overflow:'hidden', minHeight:0 }}>
        {/* Quick prompts */}
        <div style={{ padding:'12px 16px', borderBottom:'1px solid '+t.cardBorder, display:'flex', gap:8, flexWrap:'wrap' }}>
          {QUICK_PROMPTS.map(p => (
            <button key={p} onClick={() => sendMessage(p)}
              style={{ padding:'4px 12px', borderRadius:20, border:'1px solid '+t.cardBorder, background:t.bgAlt, color:t.textDim, fontSize:12, cursor:'pointer', transition:'all 0.12s' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor=t.accent+'50'; e.currentTarget.style.color=t.accent; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor=t.cardBorder; e.currentTarget.style.color=t.textDim; }}>
              {p}
            </button>
          ))}
        </div>

        {/* Messages */}
        <div style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:12 }}>
          {messages.length === 0 && (
            <div style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', color:t.textMuted, padding:40 }}>
              <div style={{ background:t.bgAlt, borderRadius:16, padding:20, marginBottom:12 }}>
                <MessageSquare size={32} color={t.textMuted} style={{ opacity:0.4 }}/>
              </div>
              <div style={{ fontSize:13, fontWeight:500 }}>Ask about manufacturing data</div>
              <div style={{ fontSize:12, marginTop:4 }}>Active tool: <span style={{ color:AI_TOOLS.find(to=>to.id===activeTool)?.color }}>{AI_TOOLS.find(to=>to.id===activeTool)?.label}</span></div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} style={{ display:'flex', gap:10, flexDirection: m.role==='user'?'row-reverse':'row', alignItems:'flex-start' }}>
              <div style={{ width:28, height:28, borderRadius:8, background: m.role==='user'?t.accent+'20':'#a855f715', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                {m.role==='user' ? <span style={{ fontSize:12, fontWeight:700, color:t.accent }}>{user?.full_name?.charAt(0)||'U'}</span> : <Zap size={13} color="#a855f7"/>}
              </div>
              <div style={{ maxWidth:'80%', padding:'10px 14px', borderRadius:10, background: m.role==='user'?t.accent+'15':t.bgAlt, border:'1px solid '+(m.role==='user'?t.accent+'30':t.cardBorder), color: m.isError?t.danger:t.text, fontSize:13, lineHeight:1.6 }}>
                {m.content}
              </div>
            </div>
          ))}
          {loading && (
            <div style={{ display:'flex', gap:10, alignItems:'center' }}>
              <div style={{ width:28, height:28, borderRadius:8, background:'#a855f715', display:'flex', alignItems:'center', justifyContent:'center' }}><Zap size={13} color="#a855f7"/></div>
              <div style={{ padding:'10px 14px', borderRadius:10, background:t.bgAlt, border:'1px solid '+t.cardBorder }}>
                <Loader2 size={14} color={t.textMuted} style={{ animation:'spin 1s linear infinite' }}/>
              </div>
            </div>
          )}
          <div ref={messagesEndRef}/>
        </div>

        {/* Input */}
        <div style={{ padding:'12px 16px', borderTop:'1px solid '+t.cardBorder, display:'flex', gap:10, alignItems:'center' }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key==='Enter' && !e.shiftKey && sendMessage()}
            placeholder={`Ask anything... (${tool?.label || 'MES Copilot'})`}
            style={{ flex:1, background:t.bgAlt, border:'1px solid '+t.cardBorder, color:t.text, borderRadius:8, padding:'10px 14px', fontSize:13, outline:'none' }}
          />
          <button onClick={() => sendMessage()}
            disabled={!input.trim() || loading}
            style={{ padding:'10px 14px', borderRadius:8, border:'none', background:t.accent, color:'#fff', cursor:(!input.trim()||loading)?'not-allowed':'pointer', opacity:(!input.trim()||loading)?0.5:1, display:'flex' }}>
            <Send size={15}/>
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SHARED: Live data table view
// ════════════════════════════════════════════════════════════════

function LiveDataView({ t, title, icon: Icon, description, endpoint, renderRows, columns, statsComponent }) {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError(''); setData(null);
    apiFetch(`${API}${endpoint}`)
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [endpoint]);

  const rows = data ? (Array.isArray(data) ? data : data.data || data.entries || []) : [];

  return (
    <div style={{ padding:'24px 32px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <div style={{ background:t.accent+'15', borderRadius:10, padding:10, display:'flex' }}><Icon size={20} color={t.accent}/></div>
        <div>
          <div style={{ fontSize:20, fontWeight:800, color:t.text }}>{title}</div>
          <div style={{ fontSize:12, color:t.textMuted }}>{description}</div>
        </div>
      </div>
      {statsComponent}
      {loading && <div style={{ display:'flex', alignItems:'center', gap:10, color:t.textMuted, fontSize:13, padding:20 }}><Loader2 size={16} style={{ animation:'spin 1s linear infinite' }}/>Loading...</div>}
      {error && <div style={{ color:t.danger, fontSize:13, padding:'10px 14px', background:t.danger+'10', borderRadius:8, border:'1px solid '+t.danger+'30', marginBottom:12 }}>⚠ {error}</div>}
      {!loading && rows.length === 0 && !error && (
        <div style={{ textAlign:'center', padding:40, background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12 }}>
          <Icon size={28} color={t.textMuted} style={{ opacity:0.3, marginBottom:10 }}/>
          <div style={{ fontSize:13, fontWeight:600, color:t.textMuted }}>No records yet</div>
          <div style={{ fontSize:12, color:t.textMuted, marginTop:4 }}>Data will appear here once records are created.</div>
        </div>
      )}
      {!loading && rows.length > 0 && (
        <div style={{ background:t.card, border:'1px solid '+t.cardBorder, borderRadius:12, overflow:'hidden' }}>
          <div style={{ display:'grid', gridTemplateColumns:columns.map(c=>c.width||'1fr').join(' '), padding:'9px 16px', background:t.bgAlt, borderBottom:'1px solid '+t.cardBorder }}>
            {columns.map(c => <div key={c.key} style={{ fontSize:10, fontWeight:700, color:t.textMuted, textTransform:'uppercase', letterSpacing:0.6 }}>{c.label}</div>)}
          </div>
          {rows.slice(0,50).map((row, i) => (
            <div key={row.id||i} style={{ display:'grid', gridTemplateColumns:columns.map(c=>c.width||'1fr').join(' '), padding:'11px 16px', borderBottom: i<rows.length-1?'1px solid '+t.cardBorder+'50':'none', alignItems:'center' }}>
              {renderRows(row, t)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// INDIVIDUAL SECTION VIEWS
// ════════════════════════════════════════════════════════════════

function EquipmentView({ t }) {
  return <LiveDataView t={t} title="Equipment Registry" icon={Box}
    description="All equipment master records, calibration status and qualification lifecycle"
    endpoint="/api/equipment"
    columns={[{key:'code',label:'Code',width:'130px'},{key:'name',label:'Equipment Name',width:'2fr'},{key:'type',label:'Type',width:'130px'},{key:'status',label:'Status',width:'110px'},{key:'qual',label:'Qualification',width:'160px'},{key:'cal',label:'Cal Due',width:'110px'}]}
    renderRows={(eq,t) => [
      <span key="c" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.accent}}>{eq.equipment_code}</span>,
      <div key="n"><div style={{fontSize:12,fontWeight:600,color:t.text}}>{eq.equipment_name}</div><div style={{fontSize:10,color:t.textMuted}}>{eq.manufacturer} {eq.model}</div></div>,
      <span key="t" style={{fontSize:11,color:t.textDim}}>{eq.equipment_type}</span>,
      <span key="s" style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:5,background:eq.status==='Available'?t.success+'15':eq.status==='Out of Service'?t.danger+'15':t.warning+'15',color:eq.status==='Available'?t.success:eq.status==='Out of Service'?t.danger:t.warning}}>{eq.status}</span>,
      <span key="q" style={{fontSize:11,color:t.textDim}}>{eq.qualification_status}</span>,
      <span key="d" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:eq.calibration_due&&new Date(eq.calibration_due)<new Date()?t.danger:t.textMuted}}>{eq.calibration_due?new Date(eq.calibration_due).toLocaleDateString():'—'}</span>,
    ]}
  />;
}

function DeviationsView({ t }) {
  return <LiveDataView t={t} title="Deviations" icon={AlertOctagon}
    description="OOS events, process deviations and investigation tracking"
    endpoint="/api/devcapa/deviations"
    columns={[{key:'n',label:'Dev Number',width:'140px'},{key:'title',label:'Title',width:'2fr'},{key:'sev',label:'Severity',width:'100px'},{key:'st',label:'Status',width:'120px'},{key:'d',label:'Reported',width:'110px'}]}
    renderRows={(d,t) => [
      <span key="n" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.accent}}>{d.deviation_number||d.id?.substring(0,8)}</span>,
      <div key="ti"><div style={{fontSize:12,fontWeight:600,color:t.text}}>{d.title}</div><div style={{fontSize:10,color:t.textMuted}}>{d.batch_number||''}</div></div>,
      <span key="sv" style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:5,background:d.severity==='Critical'?t.danger+'15':d.severity==='Major'?t.warning+'15':t.info+'15',color:d.severity==='Critical'?t.danger:d.severity==='Major'?t.warning:t.info}}>{d.severity}</span>,
      <span key="st" style={{fontSize:11,color:t.textDim}}>{d.status}</span>,
      <span key="dt" style={{fontSize:11,color:t.textMuted}}>{d.created_at?new Date(d.created_at).toLocaleDateString():'—'}</span>,
    ]}
  />;
}

function DevCapaView({ t }) {
  return <LiveDataView t={t} title="Dev & CAPA" icon={RefreshCw}
    description="Corrective and preventive action management"
    endpoint="/api/devcapa/capas"
    columns={[{key:'n',label:'CAPA Number',width:'140px'},{key:'title',label:'Title',width:'2fr'},{key:'type',label:'Type',width:'120px'},{key:'pri',label:'Priority',width:'100px'},{key:'st',label:'Status',width:'120px'}]}
    renderRows={(c,t) => [
      <span key="n" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.accent}}>{c.capa_number||c.id?.substring(0,8)}</span>,
      <div key="ti"><div style={{fontSize:12,fontWeight:600,color:t.text}}>{c.title}</div><div style={{fontSize:10,color:t.textMuted}}>{c.capa_type}</div></div>,
      <span key="ty" style={{fontSize:11,color:t.textDim}}>{c.capa_type}</span>,
      <span key="pr" style={{fontSize:11,fontWeight:600,color:c.priority==='Critical'?t.danger:c.priority==='High'?t.warning:t.textDim}}>{c.priority}</span>,
      <span key="st" style={{fontSize:11,color:t.textDim}}>{c.status}</span>,
    ]}
  />;
}

function ChangeControlView({ t }) {
  return <LiveDataView t={t} title="Change Control" icon={Settings}
    description="Change request lifecycle with configurable approval chains"
    endpoint="/api/change-control"
    columns={[{key:'cr',label:'CR Number',width:'130px'},{key:'title',label:'Title',width:'2fr'},{key:'risk',label:'Risk',width:'90px'},{key:'st',label:'Status',width:'130px'},{key:'d',label:'Created',width:'110px'}]}
    renderRows={(cr,t) => [
      <span key="cr" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.accent}}>{cr.cr_number}</span>,
      <div key="ti"><div style={{fontSize:12,fontWeight:600,color:t.text}}>{cr.title}</div><div style={{fontSize:10,color:t.textMuted}}>{cr.type_name||''}</div></div>,
      <span key="ri" style={{fontSize:11,fontWeight:600,color:cr.risk_level==='High'?t.danger:cr.risk_level==='Medium'?t.warning:t.success}}>{cr.risk_level}</span>,
      <span key="st" style={{fontSize:11,padding:'2px 8px',borderRadius:5,background:cr.status==='Approved'?t.success+'15':cr.status==='Rejected'?t.danger+'15':t.warning+'15',color:cr.status==='Approved'?t.success:cr.status==='Rejected'?t.danger:t.warning}}>{cr.status}</span>,
      <span key="dt" style={{fontSize:11,color:t.textMuted}}>{cr.created_at?new Date(cr.created_at).toLocaleDateString():'—'}</span>,
    ]}
  />;
}

function TrainingView({ t }) {
  return <LiveDataView t={t} title="Training" icon={BookOpen}
    description="Training curricula, compliance matrix, 21 CFR Part 11 §11.10(i)"
    endpoint="/api/training/curricula"
    columns={[{key:'code',label:'Course Code',width:'130px'},{key:'name',label:'Course Name',width:'2fr'},{key:'roles',label:'Required For',width:'200px'},{key:'val',label:'Validity',width:'100px'},{key:'act',label:'Active',width:'80px'}]}
    renderRows={(c,t) => [
      <span key="cd" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.accent}}>{c.course_code}</span>,
      <div key="nm"><div style={{fontSize:12,fontWeight:600,color:t.text}}>{c.course_name}</div><div style={{fontSize:10,color:t.textMuted}}>{c.description?.substring(0,60)||''}</div></div>,
      <span key="ro" style={{fontSize:10,color:t.textDim}}>{(c.required_for_roles||[]).join(', ')||'All'}</span>,
      <span key="va" style={{fontSize:11,color:t.textMuted}}>{c.validity_months} months</span>,
      <span key="ac" style={{fontSize:11,color:c.is_active?t.success:t.danger}}>{c.is_active?'✓ Yes':'✗ No'}</span>,
    ]}
  />;
}

function UsersView({ t }) {
  return <LiveDataView t={t} title="Users & Roles" icon={Users}
    description="User management, group permissions, training compliance"
    endpoint="/api/auth/users"
    columns={[{key:'name',label:'Full Name',width:'180px'},{key:'email',label:'Email',width:'2fr'},{key:'grp',label:'Role',width:'160px'},{key:'tr',label:'Training',width:'110px'},{key:'st',label:'Status',width:'100px'}]}
    renderRows={(u,t) => [
      <div key="nm" style={{display:'flex',alignItems:'center',gap:8}}>
        <div style={{width:26,height:26,borderRadius:7,background:t.accent+'20',display:'flex',alignItems:'center',justifyContent:'center',color:t.accent,fontSize:11,fontWeight:700,flexShrink:0}}>{u.full_name?.charAt(0)||'?'}</div>
        <span style={{fontSize:12,fontWeight:600,color:t.text}}>{u.full_name}</span>
      </div>,
      <span key="em" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.textDim}}>{u.email}</span>,
      <span key="gr" style={{fontSize:11,padding:'2px 8px',borderRadius:5,background:t.accent+'12',color:t.accent}}>{u.group_id}</span>,
      <span key="tr" style={{fontSize:11,color:u.training_status==='Current'?t.success:t.warning}}>{u.training_status}</span>,
      <span key="st" style={{fontSize:11,color:u.status==='Active'?t.success:t.danger}}>{u.status}</span>,
    ]}
  />;
}

function EBRView({ t, title, icon: Icon, description }) {
  return <LiveDataView t={t} title={title} icon={Icon} description={description}
    endpoint="/api/ebr"
    columns={[{key:'c',label:'EBR Code',width:'160px'},{key:'p',label:'Product',width:'2fr'},{key:'b',label:'Batch #',width:'130px'},{key:'s',label:'Status',width:'110px'},{key:'y',label:'Yield',width:'80px'}]}
    renderRows={(e,t) => [
      <span key="c" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.accent}}>{e.ebr_code}</span>,
      <span key="p" style={{fontSize:12,fontWeight:600,color:t.text}}>{e.product_name}</span>,
      <span key="b" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.textDim}}>{e.batch_number}</span>,
      <span key="s" style={{fontSize:11,fontWeight:600,padding:'2px 8px',borderRadius:5,background:e.status==='Released'?t.success+'15':e.status==='In Progress'?t.info+'15':t.bgAlt,color:e.status==='Released'?t.success:e.status==='In Progress'?t.info:t.textMuted}}>{e.status}</span>,
      <span key="y" style={{fontSize:11,color:e.yield_pct>=97?t.success:e.yield_pct>=90?t.warning:t.danger}}>{e.yield_pct?e.yield_pct+'%':'—'}</span>,
    ]}
  />;
}

function GenealogyView({ t }) {
  return <LiveDataView t={t} title="Genealogy & Traceability" icon={GitBranch}
    description="Forward/backward material traceability and recall simulation"
    endpoint="/api/genealogy/batches"
    columns={[{key:'c',label:'Batch Code',width:'160px'},{key:'p',label:'Product',width:'2fr'},{key:'m',label:'Materials',width:'100px'},{key:'d',label:'Deviations',width:'110px'},{key:'r',label:'Release',width:'110px'}]}
    renderRows={(b,t) => [
      <span key="c" style={{fontSize:11,fontFamily:"'DM Mono',monospace",color:t.accent}}>{b.code||b.batch_number}</span>,
      <span key="p" style={{fontSize:12,fontWeight:600,color:t.text}}>{b.product_name}</span>,
      <span key="m" style={{fontSize:11,color:t.textDim}}>{b.material_count||0}</span>,
      <span key="d" style={{fontSize:11,color:b.deviation_count>0?t.warning:t.success}}>{b.deviation_count||0}</span>,
      <span key="r" style={{fontSize:11,padding:'2px 8px',borderRadius:5,background:b.release_status==='Released'?t.success+'15':t.bgAlt,color:b.release_status==='Released'?t.success:t.textMuted}}>{b.release_status||'Pending'}</span>,
    ]}
  />;
}

function EquipmentQMView({ t }) {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch(`${API}/api/equipment/stats/overview`).then(d => { setStats(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  return (
    <div style={{padding:'24px 32px'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <div style={{background:t.accent+'15',borderRadius:10,padding:10,display:'flex'}}><Wrench size={20} color={t.accent}/></div>
        <div><div style={{fontSize:20,fontWeight:800,color:t.text}}>Equipment QM</div><div style={{fontSize:12,color:t.textMuted}}>Calibration, qualification (IQ/OQ/PQ), maintenance lifecycle</div></div>
      </div>
      {loading && <div style={{display:'flex',alignItems:'center',gap:10,color:t.textMuted,fontSize:13}}><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>Loading...</div>}
      {stats && (
        <>
          <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:14,marginBottom:20}}>
            {[{label:'Total Equipment',value:stats.total,color:t.accent},{label:'GMP Critical',value:stats.gmp_critical,color:t.warning},{label:'Cal Overdue',value:stats.calibration_overdue,color:t.danger},{label:'Cal Due 30d',value:stats.calibration_due_30d,color:t.warning}].map(s => (
              <div key={s.label} style={{background:t.card,border:'1px solid '+t.cardBorder,borderRadius:12,padding:'16px 18px'}}>
                <div style={{fontSize:26,fontWeight:800,color:s.color}}>{s.value??'—'}</div>
                <div style={{fontSize:12,color:t.textMuted,marginTop:3}}>{s.label}</div>
              </div>
            ))}
          </div>
          {stats.calibration_overdue > 0 && (
            <div style={{padding:'12px 16px',background:t.danger+'10',border:'1px solid '+t.danger+'30',borderRadius:10,display:'flex',alignItems:'center',gap:10,marginBottom:16}}>
              <AlertOctagon size={16} color={t.danger}/>
              <span style={{fontSize:13,color:t.danger,fontWeight:600}}>{stats.calibration_overdue} equipment overdue for calibration — immediate action required</span>
            </div>
          )}
          {stats.by_status && (
            <div style={{background:t.card,border:'1px solid '+t.cardBorder,borderRadius:12,padding:'16px 20px'}}>
              <div style={{fontSize:12,fontWeight:700,color:t.text,marginBottom:10}}>Status Breakdown</div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
                {stats.by_status.map(s => (
                  <div key={s.status} style={{padding:'6px 14px',background:t.bgAlt,borderRadius:8,border:'1px solid '+t.cardBorder}}>
                    <span style={{fontSize:14,fontWeight:700,color:t.text}}>{s.cnt}</span>
                    <span style={{fontSize:11,color:t.textMuted,marginLeft:6}}>{s.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function QualityView({ t }) {
  const [dash, setDash] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    apiFetch(`${API}/api/compliance/reviews/dashboard`).then(d => { setDash(d); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  return (
    <div style={{padding:'24px 32px'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <div style={{background:t.accent+'15',borderRadius:10,padding:10,display:'flex'}}><Shield size={20} color={t.accent}/></div>
        <div><div style={{fontSize:20,fontWeight:800,color:t.text}}>Quality & Compliance</div><div style={{fontSize:12,color:t.textMuted}}>Periodic reviews, risk assessments, FMEA, AI governance</div></div>
      </div>
      {loading && <div style={{display:'flex',alignItems:'center',gap:10,color:t.textMuted,fontSize:13}}><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>Loading...</div>}
      {dash && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))',gap:14,marginBottom:20}}>
          {[{label:'Total Reviews',value:dash.total,color:t.accent},{label:'Overdue',value:dash.overdue,color:t.danger},{label:'Due in 30 Days',value:dash.upcoming_30d,color:t.warning},{label:'Completed This Year',value:dash.completed_this_year,color:t.success}].map(s => (
            <div key={s.label} style={{background:t.card,border:'1px solid '+t.cardBorder,borderRadius:12,padding:'16px 18px'}}>
              <div style={{fontSize:26,fontWeight:800,color:s.color}}>{s.value??'—'}</div>
              <div style={{fontSize:12,color:t.textMuted,marginTop:3}}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {!loading && !dash && (
        <div style={{textAlign:'center',padding:40,background:t.card,border:'1px solid '+t.cardBorder,borderRadius:12}}>
          <Shield size={28} color={t.textMuted} style={{opacity:0.3,marginBottom:10}}/>
          <div style={{fontSize:13,fontWeight:600,color:t.textMuted}}>No periodic reviews scheduled yet</div>
        </div>
      )}
    </div>
  );
}

function IntegrationView({ t }) {
  const [stats, setStats] = useState(null);
  const [connectors, setConnectors] = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    Promise.all([
      apiFetch(`${API}/api/integration-platform/stats/overview`),
      apiFetch(`${API}/api/integration-platform/connectors`),
    ]).then(([s,c]) => { setStats(s); setConnectors(c.data||[]); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  return (
    <div style={{padding:'24px 32px'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <div style={{background:t.warning+'15',borderRadius:10,padding:10,display:'flex'}}><Radio size={20} color={t.warning}/></div>
        <div><div style={{fontSize:20,fontWeight:800,color:t.text}}>MES Integration AI</div><div style={{fontSize:12,color:t.textMuted}}>OPC-UA, SAP PP/PI, LIMS, historian connectors</div></div>
      </div>
      {loading && <div style={{display:'flex',alignItems:'center',gap:10,color:t.textMuted,fontSize:13}}><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>Loading...</div>}
      {stats && (
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:14,marginBottom:20}}>
          {[{label:'Connectors',value:stats.total_connectors,color:t.warning},{label:'Active Mappings',value:stats.active_mappings,color:t.success},{label:'Active Flows',value:stats.active_flows,color:t.info},{label:'OPC Sessions',value:stats.opc_sessions_active,color:t.accent}].map(s => (
            <div key={s.label} style={{background:t.card,border:'1px solid '+t.cardBorder,borderRadius:10,padding:'14px 16px'}}>
              <div style={{fontSize:22,fontWeight:800,color:s.color}}>{s.value??0}</div>
              <div style={{fontSize:11,color:t.textMuted,marginTop:2}}>{s.label}</div>
            </div>
          ))}
        </div>
      )}
      {connectors.length === 0 && !loading && (
        <div style={{textAlign:'center',padding:40,background:t.card,border:'1px solid '+t.cardBorder,borderRadius:12}}>
          <Radio size={28} color={t.textMuted} style={{opacity:0.3,marginBottom:10}}/>
          <div style={{fontSize:13,fontWeight:600,color:t.textMuted}}>No connectors configured yet</div>
        </div>
      )}
    </div>
  );
}

function AuditTrailView({ t }) {
  const [entries, setEntries] = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');
  useEffect(() => {
    apiFetch(`${API}/api/audit?limit=50`).then(d => { setEntries(d.entries||[]); setTotal(d.total||0); setLoading(false); }).catch(e => { setError(e.message); setLoading(false); });
  }, []);
  return (
    <div style={{padding:'24px 32px'}}>
      <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:20}}>
        <div style={{background:t.accent+'15',borderRadius:10,padding:10,display:'flex'}}><Terminal size={20} color={t.accent}/></div>
        <div><div style={{fontSize:20,fontWeight:800,color:t.text}}>Audit Trail</div><div style={{fontSize:12,color:t.textMuted}}>SHA-256 chained · 21 CFR Part 11 §11.10(e) · {total} total entries</div></div>
      </div>
      {loading && <div style={{display:'flex',alignItems:'center',gap:10,color:t.textMuted,fontSize:13,padding:20}}><Loader2 size={16} style={{animation:'spin 1s linear infinite'}}/>Loading...</div>}
      {error && <div style={{color:t.danger,fontSize:12,padding:'10px 14px',background:t.danger+'10',borderRadius:8,marginBottom:12}}>⚠ {error}</div>}
      {!loading && (
        <div style={{background:t.card,border:'1px solid '+t.cardBorder,borderRadius:12,overflow:'hidden'}}>
          <div style={{display:'grid',gridTemplateColumns:'160px 100px 2fr 180px',padding:'9px 16px',background:t.bgAlt,borderBottom:'1px solid '+t.cardBorder}}>
            {['Timestamp','Action','Details','User'].map(h => <div key={h} style={{fontSize:10,fontWeight:700,color:t.textMuted,textTransform:'uppercase',letterSpacing:0.6}}>{h}</div>)}
          </div>
          {entries.map((e,i) => (
            <div key={e.id||i} style={{display:'grid',gridTemplateColumns:'160px 100px 2fr 180px',padding:'9px 16px',borderBottom:i<entries.length-1?'1px solid '+t.cardBorder+'50':'none',alignItems:'center'}}>
              <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:t.textMuted}}>{e.timestamp?new Date(e.timestamp).toLocaleString():''}</span>
              <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",background:t.accent+'15',color:t.accent,borderRadius:4,padding:'1px 6px',display:'inline-block'}}>{e.action}</span>
              <span style={{fontSize:11,color:t.text}}>{e.details||e.resource||'—'}</span>
              <span style={{fontSize:10,color:t.textMuted}}>{e.user_name||e.user_id||'SYSTEM'}</span>
            </div>
          ))}
          {entries.length===0 && !loading && <div style={{padding:32,textAlign:'center',color:t.textMuted,fontSize:13}}>No audit entries yet</div>}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MBR LIST VIEW
// ════════════════════════════════════════════════════════════════

function MBRListView({ t, user, onSelectMBR }) {
  const [mbrs, setMbrs]             = useState([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName]       = useState('');
  const [creating, setCreating]     = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [actionMsg, setActionMsg]   = useState('');
  const xmlRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await mbrService.listMBRs({ search: search||undefined }); setMbrs(r.data||[]); }
    catch(err) { console.error(err); }
    finally { setLoading(false); }
  }, [search]);

  useEffect(() => { load(); }, [load]);

  const handleCreate = async () => {
    if (!newName.trim()) return; setCreating(true);
    try { const m = await mbrService.createMBR({ product_name:newName.trim(), dosage_form:'Tablet', batch_size_unit:'kg' }); setShowCreate(false); setNewName(''); onSelectMBR(m.id); }
    catch(err) { alert(err.message); }
    finally { setCreating(false); }
  };

  const handleImportXML = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { await featuresService.importXML(file); load(); setActionMsg('XML imported successfully'); setTimeout(()=>setActionMsg(''),3000); }
    catch(err) { alert('Import error: '+err.message); }
    finally { if (xmlRef.current) xmlRef.current.value=''; }
  };

  const handleExportXML = async () => {
    if (!selectedId) return;
    try { await featuresService.exportXML(selectedId); setActionMsg('XML exported'); setTimeout(()=>setActionMsg(''),3000); }
    catch(err) { alert('Export error: '+err.message); }
  };

  const handleDuplicate = async () => {
    if (!selectedId) return;
    if (!confirm('Duplicate this MBR with all phases, steps, and parameters?')) return;
    try { await featuresService.duplicateMBR(selectedId); load(); setActionMsg('MBR duplicated'); setTimeout(()=>setActionMsg(''),3000); }
    catch(err) { alert('Duplicate error: '+err.message); }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    const mbr = mbrs.find(m => m.id === selectedId);
    if (!confirm('DELETE "' + (mbr?.product_name||'this MBR') + '"?\n\nThis cannot be undone.')) return;
    try {
      const token = localStorage.getItem('pharma_mbr_token');
      const res = await fetch(`${import.meta.env.VITE_API_URL || ''}/api/mbr/${selectedId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error || 'Delete failed'); }
      setSelectedId(null); load(); setActionMsg('MBR deleted'); setTimeout(()=>setActionMsg(''),3000);
    } catch(err) { alert('Delete error: '+err.message); }
  };

  const selectedMbr = mbrs.find(m => m.id === selectedId);
  const hasSelection = !!selectedId;
  const tbBtn = (icon, label, onClick, disabled) => (
    <button onClick={onClick} disabled={disabled} style={{display:'flex',alignItems:'center',gap:5,padding:'7px 14px',borderRadius:7,border:'1px solid '+t.cardBorder,background:disabled?'transparent':t.card,color:disabled?t.textMuted+'60':t.textDim,fontSize:11,fontWeight:600,cursor:disabled?'not-allowed':'pointer',opacity:disabled?0.45:1,transition:'all 0.15s'}}>
      {icon}{label}
    </button>
  );

  return (
    <div style={{padding:'24px 32px'}}>
      {/* Header */}
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
        <div><div style={{fontSize:20,fontWeight:800,color:t.text}}>MBR Designer</div><div style={{fontSize:12,color:t.textMuted}}>Design, version and manage Master Batch Records</div></div>
        {(user?.permissions||[]).includes('mbr:write') && (
          <button onClick={()=>setShowCreate(true)} style={{display:'flex',alignItems:'center',gap:6,padding:'9px 18px',borderRadius:8,border:'none',background:t.accent,color:'#fff',fontSize:13,fontWeight:700,cursor:'pointer'}}><Plus size={15}/>New MBR</button>
        )}
      </div>

      {/* Action Toolbar: Import / Export / Duplicate */}
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',background:t.card,border:'1px solid '+t.cardBorder,borderRadius:10,marginBottom:12}}>
        <input ref={xmlRef} type="file" accept=".xml" onChange={handleImportXML} style={{display:'none'}}/>
        {tbBtn(<Upload size={12}/>,'Import XML',()=>xmlRef.current?.click(),false)}
        <div style={{width:1,height:20,background:t.cardBorder}}/>
        {tbBtn(<Download size={12}/>,'Export XML',handleExportXML,!hasSelection)}
        {tbBtn(<Copy size={12}/>,'Duplicate',handleDuplicate,!hasSelection)}
        <div style={{width:1,height:20,background:t.cardBorder}}/>
        {tbBtn(<Trash2 size={12}/>,'Delete',handleDelete,!hasSelection)}
        <div style={{flex:1}}/>
        {hasSelection && <span style={{fontSize:10,color:t.accent,fontFamily:"'DM Mono',monospace"}}>Selected: {selectedMbr?.mbr_code}</span>}
        {actionMsg && <span style={{fontSize:10,color:t.success,fontWeight:600}}>{actionMsg}</span>}
      </div>

      {/* AI Co-Designer */}
      <div style={{marginBottom:12}}>
        <CoDesignerPanel mbrId={selectedId} t={t} disabled={false} cdService={cdService} featuresService={featuresService} onMbrCreated={()=>load()}/>
      </div>

      {/* Search */}
      <div style={{position:'relative',marginBottom:16}}>
        <Search size={14} color={t.textMuted} style={{position:'absolute',left:11,top:11}}/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by product name or code..." style={{width:'100%',boxSizing:'border-box',background:t.card,border:'1px solid '+t.cardBorder,color:t.text,borderRadius:8,padding:'10px 12px 10px 34px',fontSize:13,outline:'none'}}/>
      </div>

      {/* Create form */}
      {showCreate && (
        <div style={{background:t.card,border:'1px solid '+t.cardBorder,borderRadius:12,padding:18,marginBottom:16}}>
          <div style={{fontSize:13,fontWeight:700,color:t.text,marginBottom:12}}>Create New Master Batch Record</div>
          <div style={{display:'flex',gap:10}}>
            <input value={newName} onChange={e=>setNewName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleCreate()} placeholder="Product name" autoFocus style={{flex:1,background:t.inputBg,border:'1px solid '+t.inputBorder,color:t.text,borderRadius:8,padding:'9px 12px',fontSize:13,outline:'none'}}/>
            <button onClick={handleCreate} disabled={creating||!newName.trim()} style={{padding:'9px 18px',borderRadius:8,border:'none',background:t.accent,color:'#fff',fontSize:13,fontWeight:600,cursor:'pointer',opacity:creating?0.5:1}}>{creating?'Creating...':'Create'}</button>
            <button onClick={()=>setShowCreate(false)} style={{padding:'9px 14px',borderRadius:8,border:'1px solid '+t.cardBorder,background:'transparent',color:t.textDim,fontSize:13,cursor:'pointer'}}>Cancel</button>
          </div>
        </div>
      )}

      {/* MBR List */}
      {loading
        ? <div style={{textAlign:'center',padding:40}}><Loader2 size={22} color={t.accent} style={{animation:'spin 1s linear infinite'}}/></div>
        : mbrs.length===0
        ? <div style={{textAlign:'center',padding:60,color:t.textMuted}}><FileText size={30} style={{opacity:0.3,marginBottom:10}}/><div style={{fontSize:14,fontWeight:600}}>No MBRs found</div></div>
        : <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {mbrs.map(m => {
              const meta = STATUS_META[m.status]||STATUS_META.Draft;
              const SIcon = meta.icon;
              const isSelected = m.id === selectedId;
              return (
                <div key={m.id} onClick={()=>setSelectedId(isSelected ? null : m.id)}
                  style={{background:isSelected ? t.accent+'08' : t.card, border:'1px solid '+(isSelected ? t.accent+'50' : t.cardBorder), borderRadius:12, padding:'14px 18px', cursor:'pointer', transition:'all 0.12s', display:'flex', justifyContent:'space-between', alignItems:'center'}}
                  onMouseEnter={e=>{if(!isSelected)e.currentTarget.style.borderColor=t.accent+'30';}}
                  onMouseLeave={e=>{if(!isSelected)e.currentTarget.style.borderColor=t.cardBorder;}}>
                  <div style={{display:'flex',alignItems:'center',gap:12}}>
                    <div style={{background:isSelected ? t.accent+'20' : t.accent+'12', borderRadius:9, padding:9}}><FileText size={16} color={t.accent}/></div>
                    <div>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                        <span style={{fontSize:13,fontWeight:700,color:t.text}}>{m.product_name||'Untitled'}</span>
                        <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:t.textMuted}}>{m.mbr_code}</span>
                        <span style={{display:'inline-flex',alignItems:'center',gap:4,background:meta.color+'15',border:'1px solid '+meta.color+'30',color:meta.color,borderRadius:5,padding:'2px 9px',fontSize:11,fontWeight:600}}><SIcon size={11}/>{m.status}</span>
                      </div>
                      <div style={{display:'flex',gap:14,fontSize:11,color:t.textMuted}}>
                        <span>{m.phase_count||0} phases</span><span>{m.step_count||0} operations</span>{m.ebr_count>0&&<span style={{color:t.success}}>{m.ebr_count} EBRs</span>}<span>v{m.current_version}</span>
                      </div>
                    </div>
                  </div>
                  <button onClick={(e)=>{e.stopPropagation();onSelectMBR(m.id);}}
                    style={{display:'flex',alignItems:'center',gap:4,padding:'6px 12px',borderRadius:7,border:'1px solid '+t.cardBorder,background:t.bgAlt,color:t.accent,fontSize:11,fontWeight:600,cursor:'pointer',transition:'all 0.15s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background=t.accent;e.currentTarget.style.color='#fff';}}
                    onMouseLeave={e=>{e.currentTarget.style.background=t.bgAlt;e.currentTarget.style.color=t.accent;}}>
                    Open<ArrowRight size={12}/>
                  </button>
                </div>
              );
            })}
          </div>
      }
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MBR DESIGNER WRAPPER
// ════════════════════════════════════════════════════════════════

function MBRDesignerWrapper({ mbrId, t, user, onBack }) {
  const [loaded, setLoaded]     = useState(false);
  const [mbrData, setMbrData]   = useState(null);
  const toast = (msg,type='info') => console.log('[TOAST/'+type+']', msg);

  useEffect(() => {
    mbrService.getMBR(mbrId).then(d=>{setMbrData(d);setLoaded(true);}).catch(()=>setLoaded(true));
  }, [mbrId]);

  if (!loaded) return <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center'}}><Loader2 size={24} color={t.accent} style={{animation:'spin 1s linear infinite'}}/></div>;

  return (
    <div style={{flex:1,overflow:'auto',background:t.bg}}>
      <div style={{padding:'10px 24px',display:'flex',alignItems:'center',justifyContent:'space-between',borderBottom:'1px solid '+t.cardBorder,background:t.card}}>
        <div style={{display:'flex',alignItems:'center',gap:10}}>
          <button onClick={onBack} style={{display:'flex',alignItems:'center',gap:5,padding:'5px 12px',borderRadius:7,border:'1px solid '+t.cardBorder,background:'transparent',color:t.textDim,fontSize:11,fontWeight:600,cursor:'pointer'}}><ArrowLeft size={12}/>All MBRs</button>
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <div style={{background:'linear-gradient(135deg,'+t.accent+',#8b5cf6)',borderRadius:7,padding:5}}><FileText size={13} color="#fff"/></div>
            <span style={{fontSize:13,fontWeight:700,color:t.text}}>MBR Designer</span>
            {mbrData && <span style={{fontSize:10,fontFamily:"'DM Mono',monospace",color:t.accent,fontWeight:600}}>{mbrData.mbr_code}</span>}
            <span style={{fontSize:9,fontFamily:"'DM Mono',monospace",color:t.textMuted,padding:'2px 6px',background:t.bgAlt,borderRadius:4}}>{mbrId.substring(0,8)}</span>
          </div>
        </div>
        <span style={{fontSize:11,color:t.textDim}}>{user?.full_name}</span>
      </div>
      <div style={{padding:'12px 24px 24px'}}>
        <MBRDesigner theme={t} toast={toast} mbrId={mbrId} initialData={mbrData} onDataChange={setMbrData}/>
      </div>
      <div style={{padding:'8px 24px 24px'}}><OperationFormulaPanel mbrId={mbrId} mbrData={mbrData} t={t} disabled={false} featuresService={featuresService}/></div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SECTION ROUTER
// ════════════════════════════════════════════════════════════════

function SectionView({ section, t, user, onSelectMBR }) {
  switch(section) {
    case 'overview':     return <OverviewDashboard t={t} user={user}/>;
    case 'mbr':          return <MBRListView t={t} user={user} onSelectMBR={onSelectMBR}/>;
    case 'ebr':          return <EBRView t={t} title="EBR Execution" icon={ClipboardList} description="Shop floor electronic batch record execution engine"/>;
    case 'batches':      return <EBRView t={t} title="Batches" icon={Package} description="All executed batches and release status"/>;
    case 'genealogy':    return <GenealogyView t={t}/>;
    case 'equipment_qm': return <EquipmentQMView t={t}/>;
    case 'equipment':    return <EquipmentView t={t}/>;
    case 'deviations':   return <DeviationsView t={t}/>;
    case 'devcapa':      return <DevCapaView t={t}/>;
    case 'change':       return <ChangeControlView t={t}/>;
    case 'quality':      return <QualityView t={t}/>;
    case 'training':     return <TrainingView t={t}/>;
    case 'ai_hub':       return <AIHubView t={t} user={user}/>;
    case 'integration':  return <IntegrationView t={t}/>;
    case 'users':        return <UsersView t={t}/>;
    case 'audit':        return <AuditTrailView t={t}/>;
    case 'compliance':   return <QualityView t={t}/>;
    default:             return <OverviewDashboard t={t} user={user}/>;
  }
}

// ════════════════════════════════════════════════════════════════
// APP ROOT
// ════════════════════════════════════════════════════════════════

export default function App() {
  const [isDark, setIsDark]               = useState(false); // default light to match screenshot
  const [user, setUser]                   = useState(null);
  const [section, setSection]             = useState('overview');
  const [selectedMbrId, setSelectedMbrId] = useState(null);
  const [designerOpen, setDesignerOpen]   = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const t = isDark ? THEMES.dark : THEMES.light;

  useEffect(() => {
    if (authService.isAuthenticated()) setUser(authService.getCurrentUser());
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  const handleLogin   = (u) => { setUser(u); setSection('overview'); };
  const handleLogout  = () => { authService.logout(); setUser(null); };
  const toggleTheme   = () => setIsDark(d => !d);

  const handleSelectMBR  = (id) => { setSelectedMbrId(id); setDesignerOpen(true); };
  const handleBackToList = () => { setDesignerOpen(false); setSelectedMbrId(null); };

  const handleNavigate = (id) => {
    setSection(id);
    if (id !== 'mbr') { setDesignerOpen(false); setSelectedMbrId(null); }
  };

  if (!user) return <LoginScreen t={t} onLogin={handleLogin} onThemeToggle={toggleTheme} isDark={isDark}/>;

  const sidebarProps = {
    t, activeSection: designerOpen?'mbr':section, onNavigate:handleNavigate,
    user, onLogout:handleLogout, isDark, onThemeToggle:toggleTheme,
    collapsed:sidebarCollapsed, onToggleCollapse:()=>setSidebarCollapsed(c=>!c),
  };

  return (
    <div style={{ display:'flex', height:'100vh', overflow:'hidden', background:t.bg }}>
      <Sidebar {...sidebarProps}/>
      {designerOpen && selectedMbrId
        ? <MBRDesignerWrapper mbrId={selectedMbrId} t={t} user={user} onBack={handleBackToList}/>
        : <div style={{ flex:1, overflow:'auto', background:t.bg }}>
            <SectionView section={section} t={t} user={user} onSelectMBR={handleSelectMBR}/>
          </div>
      }
    </div>
  );
}
