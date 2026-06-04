// client/src/components/MBRDesigner/ApprovalWorkflowBar.jsx
// Shows: Author → Reviewer → Approver → QA_Approver chain with status
// Includes: Ineffective transition workflow (QA-only, CC number, e-signature)
import { useState } from 'react';
import { Shield, CheckCircle, Clock, AlertTriangle, ChevronRight, Lock, ShieldOff, Loader2, X, FileText } from 'lucide-react';

const ROLES = [
  { key: 'Author', label: 'Author', meaning: 'I authored this MBR' },
  { key: 'Reviewer', label: 'Reviewer', meaning: 'I reviewed and verified the content' },
  { key: 'Approver', label: 'Approver', meaning: 'I approve this MBR for manufacturing' },
  { key: 'QA_Approver', label: 'QA Approver', meaning: 'QA final approval for production' },
];

const QA_GROUPS = ['QA', 'QA_Approver', 'Quality Assurance', 'qa', 'admin'];

export default function ApprovalWorkflowBar({ mbrId, status, signatures, nextSignature, onSignRequest, onStatusChange, user, t }) {
  const sigMap = {};
  (signatures || []).forEach(s => { sigMap[s.signature_role] = s; });

  const allSigned = ROLES.every(r => sigMap[r.key]);
  const isLocked = status !== 'Draft';
  const isEffective = status === 'Effective';
  const isIneffective = status === 'Ineffective';

  // QA role check — user.role, user.groups, or user.user_role
  const userRole = user?.role || user?.user_role || '';
  const userGroups = user?.groups || [];
  const isQA = QA_GROUPS.includes(userRole) || userGroups.some(g => QA_GROUPS.includes(g)) || userRole === 'admin';

  // Ineffective modal state
  const [showIneffModal, setShowIneffModal] = useState(false);
  const [ccNumber, setCcNumber] = useState('');
  const [ineffReason, setIneffReason] = useState('');
  const [ineffPw, setIneffPw] = useState('');
  const [ineffBusy, setIneffBusy] = useState(false);
  const [ineffError, setIneffError] = useState('');

  const resetModal = () => { setShowIneffModal(false); setCcNumber(''); setIneffReason(''); setIneffPw(''); setIneffError(''); };

  const handleIneffectiveSign = async () => {
    setIneffError('');
    if (!ccNumber.trim()) { setIneffError('Change Control (CC) number is mandatory.'); return; }
    if (!ineffReason.trim()) { setIneffError('Reason for making MBR ineffective is mandatory.'); return; }
    if (!ineffPw) { setIneffError('Password is required to apply electronic signature.'); return; }

    setIneffBusy(true);
    try {
      // Step 1: Verify identity (21 CFR Part 11 §11.200)
      const API = import.meta.env.VITE_API_URL || '';
      const token = localStorage.getItem('pharma_mbr_token');
      const hdrs = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

      const vr = await fetch(API + '/api/auth/verify-password', { method: 'POST', headers: hdrs, body: JSON.stringify({ password: ineffPw }) });
      const vd = await vr.json().catch(() => ({}));
      if (!vr.ok || !vd.verified) throw new Error('Password verification failed. Signature not applied.');

      // Step 2: Execute transition with CC number and reason
      const tr = await fetch(API + '/api/mbr/' + mbrId + '/transition', {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({
          to_status: 'Ineffective',
          reason: ineffReason.trim(),
          cc_number: ccNumber.trim(),
          signature_meaning: 'I am withdrawing this MBR from manufacturing use under Change Control ' + ccNumber.trim(),
        }),
      });
      const td = await tr.json().catch(() => ({}));
      if (!tr.ok) throw new Error(td.error || 'Status transition failed (' + tr.status + ')');

      resetModal();
      if (onStatusChange) onStatusChange('Ineffective');
    } catch (e) { setIneffError(e.message); }
    finally { setIneffBusy(false); }
  };

  return (
    <div style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={14} color={t.accent} />
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Approval workflow</span>
          <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>21 CFR Part 11 §11.10(f)</span>
        </div>
        {isLocked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: isIneffective ? '#b45309' : '#f5a623', fontWeight: 600 }}>
            {isIneffective ? <ShieldOff size={10} /> : <Lock size={10} />}
            {isIneffective ? 'Record ineffective' : 'Record locked'} — {status}
          </div>
        )}
      </div>

      {/* Signature chain: Author → Reviewer → Approver → QA → [Ineffective] */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        {ROLES.map((role, i) => {
          const sig = sigMap[role.key];
          const isNext = nextSignature === role.key;
          const done = !!sig;
          const borderColor = done ? '#00e5a0' : isNext ? t.accent : t.cardBorder;
          const bgColor = done ? '#00e5a008' : isNext ? t.accent + '08' : 'transparent';

          return (
            <div key={role.key} style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
              <div
                onClick={() => { if (isNext && onSignRequest) onSignRequest(role); }}
                style={{
                  flex: 1, padding: '8px 12px', borderRadius: 8, cursor: isNext ? 'pointer' : 'default',
                  border: '1px solid ' + borderColor, background: bgColor, transition: 'all 0.2s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  {done ? <CheckCircle size={12} color="#00e5a0" /> : isNext ? <Clock size={12} color={t.accent} /> : <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid ' + t.textMuted }} />}
                  <span style={{ fontSize: 11, fontWeight: 600, color: done ? '#00e5a0' : isNext ? t.accent : t.textMuted }}>{role.label}</span>
                </div>
                {done && (
                  <div style={{ fontSize: 9, color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>
                    {sig.signer_name || sig.signer_email} · {new Date(sig.signed_at).toLocaleDateString()}
                  </div>
                )}
                {isNext && !done && (
                  <div style={{ fontSize: 9, color: t.accent, fontWeight: 600 }}>Click to sign</div>
                )}
              </div>
              {i < ROLES.length - 1 && <ChevronRight size={12} color={t.textMuted} style={{ flexShrink: 0 }} />}
            </div>
          );
        })}

        {/* ═══ INEFFECTIVE STEP — appears after full chain when Effective ═══ */}
        {(isEffective || isIneffective) && <>
          <ChevronRight size={12} color={t.textMuted} style={{ flexShrink: 0 }} />
          <div
            onClick={() => { if (isEffective && isQA) setShowIneffModal(true); }}
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8, transition: 'all 0.2s',
              cursor: isEffective && isQA ? 'pointer' : 'default',
              border: '1px solid ' + (isIneffective ? '#b45309' : isEffective && isQA ? '#b4530960' : t.cardBorder),
              background: isIneffective ? '#b4530908' : 'transparent',
              opacity: isEffective && !isQA ? 0.4 : 1,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
              {isIneffective
                ? <ShieldOff size={12} color="#b45309" />
                : <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px solid #b45309' }} />
              }
              <span style={{ fontSize: 11, fontWeight: 600, color: isIneffective ? '#b45309' : isEffective && isQA ? '#b45309' : t.textMuted }}>
                Ineffective
              </span>
            </div>
            {isIneffective && (
              <div style={{ fontSize: 9, color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>
                Withdrawn from use
              </div>
            )}
            {isEffective && isQA && (
              <div style={{ fontSize: 9, color: '#b45309', fontWeight: 600 }}>QA: Click to withdraw</div>
            )}
            {isEffective && !isQA && (
              <div style={{ fontSize: 9, color: t.textMuted }}>QA only</div>
            )}
          </div>
        </>}
      </div>

      {/* ═══ INEFFECTIVE E-SIGNATURE MODAL ═══ */}
      {showIneffModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }} onClick={resetModal}>
          <div style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 16, padding: 0, width: 520, boxShadow: t.shadow }} onClick={e => e.stopPropagation()}>

            {/* Modal Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px', borderBottom: '1px solid ' + t.cardBorder }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ background: '#b4530912', borderRadius: 8, padding: 8, display: 'flex' }}><ShieldOff size={18} color="#b45309" /></div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700, color: t.text }}>Mark MBR Ineffective</div>
                  <div style={{ fontSize: 10, color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>21 CFR Part 11 §11.10(f) · QA Controlled Action</div>
                </div>
              </div>
              <button onClick={resetModal} style={{ background: 'none', border: 'none', cursor: 'pointer', color: t.textMuted }}><X size={16} /></button>
            </div>

            {/* Modal Body */}
            <div style={{ padding: '18px 22px' }}>

              {/* Warning banner */}
              <div style={{ background: '#b4530910', border: '1px solid #b4530930', borderRadius: 8, padding: '10px 14px', marginBottom: 16, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <AlertTriangle size={14} color="#b45309" style={{ flexShrink: 0, marginTop: 1 }} />
                <div style={{ fontSize: 12, color: '#b45309', lineHeight: 1.5 }}>
                  This will withdraw the MBR from manufacturing use. No new batches can be created from an Ineffective MBR. Existing batch records will not be affected. A new version can be created to reactivate.
                </div>
              </div>

              {/* Signer info */}
              <div style={{ background: t.bgAlt, borderRadius: 8, padding: '10px 14px', marginBottom: 16, border: '1px solid ' + t.cardBorder }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 10, color: t.textMuted, textTransform: 'uppercase', marginBottom: 2 }}>Signing as</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: t.text }}>{user?.full_name || user?.email || 'Current user'}</div>
                  </div>
                  <div style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: '#b45309', background: '#b4530915', padding: '3px 8px', borderRadius: 4 }}>QA Controlled</div>
                </div>
                <div style={{ fontSize: 10, color: t.textMuted, marginTop: 4 }}>
                  Signature meaning: <em>I am withdrawing this MBR from manufacturing use under the referenced Change Control.</em>
                </div>
              </div>

              {/* CC Number — mandatory */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ color: t.textDim, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }}>
                  Change Control (CC) Number <span style={{ color: '#f5365c' }}>*</span>
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <FileText size={14} color={t.textMuted} style={{ flexShrink: 0 }} />
                  <input value={ccNumber} onChange={e => { setCcNumber(e.target.value); setIneffError(''); }} placeholder="CC-2026-0042"
                    style={{ flex: 1, boxSizing: 'border-box', background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none', fontFamily: "'DM Mono',monospace" }} />
                </div>
                <div style={{ fontSize: 10, color: t.textMuted, marginTop: 3 }}>Reference the approved Change Control authorizing this withdrawal</div>
              </div>

              {/* Reason — mandatory */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ color: t.textDim, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }}>
                  Reason for making Ineffective <span style={{ color: '#f5365c' }}>*</span>
                </label>
                <textarea value={ineffReason} onChange={e => { setIneffReason(e.target.value); setIneffError(''); }}
                  placeholder="e.g. Process improvement identified in CC-2026-0042. Replacement MBR in development under MBR-MET-500-002."
                  rows={3} style={{ width: '100%', boxSizing: 'border-box', background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 12, outline: 'none', resize: 'none', fontFamily: 'inherit', lineHeight: 1.5 }} />
              </div>

              {/* Password — e-signature */}
              <div style={{ marginBottom: 4 }}>
                <label style={{ color: t.textDim, fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4, display: 'block' }}>
                  Re-enter Password <span style={{ color: '#f5365c' }}>*</span>
                </label>
                <input type="password" value={ineffPw} onChange={e => { setIneffPw(e.target.value); setIneffError(''); }}
                  autoFocus placeholder="Confirm identity to apply electronic signature..."
                  onKeyDown={e => e.key === 'Enter' && ccNumber && ineffReason && ineffPw && handleIneffectiveSign()}
                  style={{ width: '100%', boxSizing: 'border-box', background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 8, padding: '9px 12px', fontSize: 13, outline: 'none' }} />
              </div>

              {/* Error */}
              {ineffError && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 10px', background: '#f5365c10', border: '1px solid #f5365c30', borderRadius: 6, marginTop: 10 }}>
                  <AlertTriangle size={12} color="#f5365c" />
                  <span style={{ fontSize: 11, color: '#f5365c' }}>{ineffError}</span>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 22px', borderTop: '1px solid ' + t.cardBorder }}>
              <span style={{ fontSize: 10, color: t.textMuted, fontFamily: "'DM Mono',monospace" }}>SHA-256 bound · Tamper-evident audit trail</span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={resetModal} style={{ padding: '9px 18px', borderRadius: 8, border: '1px solid ' + t.cardBorder, background: 'transparent', color: t.textDim, fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Cancel</button>
                <button onClick={handleIneffectiveSign} disabled={ineffBusy || !ccNumber || !ineffReason || !ineffPw}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 18px', borderRadius: 8, border: 'none', background: '#b45309', color: '#fff', fontSize: 13, fontWeight: 600, cursor: ineffBusy ? 'wait' : 'pointer', opacity: (!ccNumber || !ineffReason || !ineffPw) ? 0.4 : 1 }}>
                  {ineffBusy ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <ShieldOff size={13} />}
                  {ineffBusy ? 'Applying Signature...' : 'Apply Signature & Mark Ineffective'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
