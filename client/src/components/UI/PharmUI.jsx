// ============================================================================
// PharmaMES.AI — Shared UI Component Library
// Single source of truth for all UI primitives across MBR/EBR/Co-Designer
// Theme-aware inline styles matching App.jsx ThemeContext
// ============================================================================

import { PenTool, Eye, CheckCircle, Shield, ShieldOff, RotateCcw, X, AlertTriangle } from 'lucide-react';

// ════════════════════════════════════════════════════════════════════════════
// STATUS METADATA — used by StatusBadge and shared across modules
// ════════════════════════════════════════════════════════════════════════════

export const STATUS_META = {
  Draft:        { color: '#f5a623', icon: PenTool },
  'In Review':  { color: '#2dceef', icon: Eye },
  Approved:     { color: '#00e5a0', icon: CheckCircle },
  Effective:    { color: '#00e5a0', icon: Shield },
  Ineffective:  { color: '#b45309', icon: ShieldOff },
  Superseded:   { color: '#7a8ba8', icon: RotateCcw },
  Obsolete:     { color: '#f5365c', icon: X },
};

// EBR-specific status colors
export const EBR_STATUS_COLORS = {
  Ready: '#2dceef', 'In Progress': '#f5a623', Complete: '#00e5a0',
  Released: '#00e5a0', Rejected: '#f5365c', Pending: '#7a8ba8',
  Completed: '#00e5a0', Verified: '#5046e5',
};

// ════════════════════════════════════════════════════════════════════════════
// BADGE — inline status/label pill
// ════════════════════════════════════════════════════════════════════════════
// Usage:  <Badge color="#f5365c" t={t}>CPP</Badge>
//         <Badge color="#f5365c" t={t} tiny>CPP</Badge>

export function Badge({ children, color, t, tiny }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      background: color + '15', border: '1px solid ' + color + '30', color,
      borderRadius: tiny ? 3 : 5,
      padding: tiny ? '1px 4px' : '2px 9px',
      fontSize: tiny ? 8 : 11, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STATUS BADGE — renders icon + status text with correct color from STATUS_META
// ════════════════════════════════════════════════════════════════════════════

export function StatusBadge({ status, t }) {
  const meta = STATUS_META[status] || STATUS_META.Draft;
  const Icon = meta.icon;
  return <Badge color={meta.color} t={t}><Icon size={11} />{status}</Badge>;
}

// ════════════════════════════════════════════════════════════════════════════
// CARD — theme-aware container with border and rounded corners
// ════════════════════════════════════════════════════════════════════════════

export function Card({ children, t, style }) {
  return (
    <div style={{
      background: t.card, border: '1px solid ' + t.cardBorder,
      borderRadius: 12, padding: 18, ...style,
    }}>
      {children}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SUM CARD — metric summary (number + label + subtitle)
// ════════════════════════════════════════════════════════════════════════════

export function SumCard({ label, val, sub, color, t }) {
  return (
    <Card t={t} style={{ padding: '12px 16px' }}>
      <Label t={t}>{label}</Label>
      <div style={{ fontSize: 20, fontWeight: 800, color, fontFamily: "'DM Mono',monospace" }}>{val}</div>
      <div style={{ fontSize: 10, color: t.textDim, marginTop: 2 }}>{sub}</div>
    </Card>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SECTION TITLE — icon + heading + optional count + right-side content
// ════════════════════════════════════════════════════════════════════════════

export function SectionTitle({ icon: Icon, title, count, t, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ background: t.accent + '12', borderRadius: 7, padding: 6, display: 'flex' }}>
          <Icon size={15} color={t.accent} />
        </div>
        <span style={{ color: t.text, fontSize: 14, fontWeight: 700 }}>{title}</span>
        {count !== undefined && (
          <span style={{ background: t.bgAlt, color: t.textMuted, fontSize: 10, fontFamily: "'DM Mono',monospace", padding: '1px 7px', borderRadius: 4 }}>
            {count}
          </span>
        )}
      </div>
      {right}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// BTN — unified button with variant + size system
// ════════════════════════════════════════════════════════════════════════════
// Variants: 'primary' | 'ghost' | 'danger' | 'accent' | 'warn'
// Sizes:    'sm' | 'md' (default)

export function Btn({ children, t, variant = 'primary', size = 'md', disabled, onClick, style: extStyle, ...rest }) {
  const sm = size === 'sm';
  const base = {
    border: 'none', borderRadius: sm ? 6 : 8, cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: sm ? 5 : 6,
    fontSize: sm ? 11 : 13, padding: sm ? '5px 12px' : '9px 18px',
    opacity: disabled ? 0.4 : 1, transition: 'all 0.2s', whiteSpace: 'nowrap',
  };
  const variants = {
    primary: { background: t.accent, color: '#fff' },
    ghost:   { background: 'transparent', color: t.textDim, border: '1px solid ' + t.cardBorder },
    danger:  { background: (t.danger || '#f5365c') + '15', color: t.danger || '#f5365c', border: '1px solid ' + (t.danger || '#f5365c') + '30' },
    accent:  { background: t.accent + '15', color: t.accent, border: '1px solid ' + t.accent + '30' },
    warn:    { background: '#f5a623', color: '#fff' },
  };
  return (
    <button onClick={onClick} disabled={disabled} {...rest}
      style={{ ...base, ...(variants[variant] || variants.primary), ...extStyle }}>
      {children}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// LABEL — tiny uppercase field label
// ════════════════════════════════════════════════════════════════════════════

export function Label({ t, children, required, style: extStyle }) {
  return (
    <div style={{
      fontSize: 10, fontWeight: 600, color: t.textDim,
      textTransform: 'uppercase', letterSpacing: 0.4,
      marginBottom: 3, display: 'block', ...extStyle,
    }}>
      {children} {required && <span style={{ color: t.danger || '#f5365c' }}>*</span>}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// INPUT — themed text input with label, unit, required indicator
// ════════════════════════════════════════════════════════════════════════════
// Supports: type, placeholder, disabled, rows (textarea), unit suffix

export function Input({ label, t, required, unit, value, onChange, placeholder, type = 'text', disabled, rows, size, style: extStyle, ...rest }) {
  const sm = size === 'sm';
  const fieldStyle = {
    width: '100%', boxSizing: 'border-box',
    background: t.inputBg, border: '1px solid ' + t.inputBorder,
    color: t.text, borderRadius: sm ? 6 : 8, padding: sm ? '6px 10px' : '9px 12px',
    fontSize: sm ? 11 : 13, outline: 'none', fontFamily: 'inherit',
    ...extStyle,
  };
  return (
    <div style={{ marginBottom: sm ? 6 : 10 }}>
      {label && (
        <label style={{ color: t.textDim, fontSize: sm ? 9 : 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: sm ? 0.4 : 0.5, marginBottom: sm ? 2 : 4, display: 'block' }}>
          {label} {required && <span style={{ color: t.danger || '#f5365c' }}>*</span>}
        </label>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        {rows ? (
          <textarea value={value || ''} onChange={e => onChange && onChange(e.target.value)} placeholder={placeholder}
            disabled={disabled} rows={rows} style={{ ...fieldStyle, resize: 'none' }} {...rest} />
        ) : (
          <input type={type} value={value || ''} onChange={e => onChange && onChange(e.target.value)} placeholder={placeholder}
            disabled={disabled} style={{ ...fieldStyle, flex: unit ? 1 : undefined }} {...rest} />
        )}
        {unit && <span style={{ color: t.textMuted, fontSize: 11, fontFamily: "'DM Mono',monospace" }}>{unit}</span>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// SELECT — themed dropdown with label
// ════════════════════════════════════════════════════════════════════════════

export function Select({ label, t, options, required, value, onChange, placeholder, disabled, size, style: extStyle, ...rest }) {
  const sm = size === 'sm';
  return (
    <div style={{ marginBottom: sm ? 6 : 10 }}>
      {label && (
        <label style={{ color: t.textDim, fontSize: sm ? 9 : 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: sm ? 0.4 : 0.5, marginBottom: sm ? 2 : 4, display: 'block' }}>
          {label} {required && <span style={{ color: t.danger || '#f5365c' }}>*</span>}
        </label>
      )}
      <select value={value || ''} onChange={e => onChange && onChange(e.target.value)} disabled={disabled} {...rest}
        style={{
          width: '100%', boxSizing: 'border-box',
          background: t.inputBg, border: '1px solid ' + t.inputBorder,
          color: t.text, borderRadius: sm ? 6 : 8, padding: sm ? '6px 10px' : '9px 12px',
          fontSize: sm ? 11 : 13, outline: 'none', ...extStyle,
        }}>
        {placeholder && <option value="">{placeholder}</option>}
        {(options || []).map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// TOGGLE CHIP — small on/off pill for boolean toggles
// ════════════════════════════════════════════════════════════════════════════

export function ToggleChip({ label, active, onClick, color, t }) {
  const c = active ? (color || t.accent) : t.textMuted;
  return (
    <button onClick={onClick} style={{
      background: active ? c + '18' : 'transparent',
      border: '1px solid ' + (active ? c + '40' : t.cardBorder),
      color: c, borderRadius: 5, padding: '2px 8px',
      fontSize: 10, fontWeight: 700, fontFamily: "'DM Mono',monospace",
      cursor: 'pointer', transition: 'all 0.15s',
    }}>
      {label}
    </button>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// PROGRESS BAR — horizontal fill bar
// ════════════════════════════════════════════════════════════════════════════

export function ProgressBar({ pct, color, width = '100%', height = 6 }) {
  return (
    <div style={{ width, height, background: '#e2e6ea20', borderRadius: height / 2, overflow: 'hidden' }}>
      <div style={{ width: pct + '%', height: '100%', background: color, borderRadius: height / 2, transition: 'width 0.5s ease' }} />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// ERR BOX — inline error banner
// ════════════════════════════════════════════════════════════════════════════

export function ErrBox({ children, onDismiss }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6, marginTop: 8,
      padding: '6px 10px', background: '#f5365c10',
      border: '1px solid #f5365c30', borderRadius: 6,
    }}>
      <AlertTriangle size={12} color="#f5365c" />
      <span style={{ fontSize: 11, color: '#f5365c', flex: 1 }}>{children}</span>
      {onDismiss && (
        <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#f5365c', padding: 0 }}>
          <X size={12} />
        </button>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// CENTER — centered empty-state container
// ════════════════════════════════════════════════════════════════════════════

export function Center({ t, children }) {
  return <div style={{ textAlign: 'center', padding: 50, color: t.textMuted }}>{children}</div>;
}

// ════════════════════════════════════════════════════════════════════════════
// UTILITY: inputStyle — raw style object for one-off <input> elements
// ════════════════════════════════════════════════════════════════════════════

export function inputStyle(t) {
  return {
    background: t.inputBg, border: '1px solid ' + t.inputBorder,
    color: t.text, borderRadius: 8, padding: '9px 12px',
    fontSize: 12, outline: 'none',
  };
}
