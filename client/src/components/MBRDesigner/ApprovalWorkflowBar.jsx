// client/src/components/MBRDesigner/ApprovalWorkflowBar.jsx
// Shows: Author → Reviewer → Approver → QA_Approver chain with status
import { useState, useEffect } from 'react';
import { Shield, CheckCircle, Clock, AlertTriangle, ChevronRight, Lock } from 'lucide-react';

const ROLES = [
  { key: 'Author', label: 'Author', meaning: 'I authored this MBR' },
  { key: 'Reviewer', label: 'Reviewer', meaning: 'I reviewed and verified the content' },
  { key: 'Approver', label: 'Approver', meaning: 'I approve this MBR for manufacturing' },
  { key: 'QA_Approver', label: 'QA Approver', meaning: 'QA final approval for production' },
];

export default function ApprovalWorkflowBar({ mbrId, status, signatures, nextSignature, onSignRequest, t }) {
  const sigMap = {};
  (signatures || []).forEach(s => { sigMap[s.signature_role] = s; });

  const allSigned = ROLES.every(r => sigMap[r.key]);
  const isLocked = status !== 'Draft';

  return (
    <div style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Shield size={14} color={t.accent} />
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Approval workflow</span>
          <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>21 CFR Part 11 §11.10(f)</span>
        </div>
        {isLocked && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#f5a623', fontWeight: 600 }}>
            <Lock size={10} /> Record locked — {status}
          </div>
        )}
      </div>

      {/* Signature chain */}
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
      </div>
    </div>
  );
}
