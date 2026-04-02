// client/src/components/MBRDesigner/VersionHistoryPanel.jsx
// Shows version history and allows creating new versions with change reasons
import { useState, useEffect } from 'react';
import { History, Plus, ChevronDown, ChevronUp, FileText, Clock, User, Hash, Loader2 } from 'lucide-react';
import { mbrService } from '../../services/apiService';

export default function VersionHistoryPanel({ mbrId, currentVersion, status, t, onVersionCreated }) {
  const [versions, setVersions] = useState([]);
  const [transitions, setTransitions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showNewVersion, setShowNewVersion] = useState(false);
  const [changeReason, setChangeReason] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { if (mbrId && expanded) loadData(); }, [mbrId, expanded]);

  const loadData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('pharma_mbr_token');
      const headers = { Authorization: 'Bearer ' + token };

      const [vRes, tRes] = await Promise.all([
        fetch(`${import.meta.env.VITE_API_URL || ''}/api/mbr/${mbrId}/versions`, { headers }),
        fetch(`${import.meta.env.VITE_API_URL || ''}/api/mbr/${mbrId}/transitions`, { headers }),
      ]);

      if (vRes.ok) { const vData = await vRes.json(); setVersions(vData.data || []); }
      if (tRes.ok) { const tData = await tRes.json(); setTransitions(tData.data || []); }
    } catch (e) { console.error('Version load error:', e); }
    finally { setLoading(false); }
  };

  const handleCreateVersion = async () => {
    if (!changeReason.trim()) { setError('Change reason is required (21 CFR Part 11)'); return; }
    setCreating(true); setError('');
    try {
      const result = await mbrService.createNewVersion(mbrId, changeReason.trim());
      setChangeReason(''); setShowNewVersion(false);
      loadData();
      if (onVersionCreated) onVersionCreated(result);
    } catch (e) { setError(e.message); }
    finally { setCreating(false); }
  };

  const combinedHistory = [
    ...versions.map(v => ({ type: 'version', time: v.created_at, ...v })),
    ...transitions.map(t => ({ type: 'transition', time: t.created_at, ...t })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time));

  return (
    <div style={{ background: t.card, border: '1px solid ' + t.cardBorder, borderRadius: 12, marginBottom: 16, overflow: 'hidden' }}>
      {/* Header */}
      <div onClick={() => setExpanded(!expanded)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <History size={14} color={t.accent} />
          <span style={{ fontSize: 13, fontWeight: 700, color: t.text }}>Version history</span>
          <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>v{currentVersion || 1}</span>
          <span style={{ fontSize: 10, fontFamily: "'DM Mono',monospace", color: t.textMuted }}>· {versions.length} versions</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {status !== 'Draft' && status !== 'Effective' && (
            <button onClick={(e) => { e.stopPropagation(); setShowNewVersion(true); setExpanded(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + t.accent + '30', background: t.accent + '10', color: t.accent }}>
              <Plus size={10} />New version
            </button>
          )}
          {expanded ? <ChevronUp size={14} color={t.textMuted} /> : <ChevronDown size={14} color={t.textMuted} />}
        </div>
      </div>

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: '0 18px 14px', borderTop: '1px solid ' + t.cardBorder }}>
          {/* Create new version form */}
          {showNewVersion && (
            <div style={{ background: t.bgAlt, borderRadius: 8, padding: 14, marginTop: 12, border: '1px dashed ' + t.accent + '40' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: t.text, marginBottom: 8 }}>Create new version (resets to Draft)</div>
              <div style={{ fontSize: 10, color: t.textMuted, marginBottom: 8 }}>Current state will be saved as v{currentVersion} snapshot. A new draft v{(currentVersion || 1) + 1} will be created for editing.</div>
              <textarea
                value={changeReason} onChange={e => setChangeReason(e.target.value)}
                placeholder="Describe why this version is needed (required by 21 CFR Part 11)..."
                rows={2} style={{ width: '100%', boxSizing: 'border-box', background: t.inputBg, border: '1px solid ' + t.inputBorder, color: t.text, borderRadius: 6, padding: '8px 10px', fontSize: 12, outline: 'none', resize: 'none', fontFamily: 'inherit' }}
              />
              {error && <div style={{ color: '#f5365c', fontSize: 11, marginTop: 4 }}>{error}</div>}
              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                <button onClick={() => { setShowNewVersion(false); setError(''); }} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid ' + t.cardBorder, background: 'transparent', color: t.textDim }}>Cancel</button>
                <button onClick={handleCreateVersion} disabled={creating || !changeReason.trim()}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px', borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: 'pointer', border: 'none', background: t.accent, color: '#fff', opacity: creating || !changeReason.trim() ? 0.4 : 1 }}>
                  {creating ? <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> : <Plus size={11} />}
                  Create v{(currentVersion || 1) + 1}
                </button>
              </div>
            </div>
          )}

          {/* Timeline */}
          {loading ? (
            <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={16} color={t.accent} style={{ animation: 'spin 1s linear infinite' }} /></div>
          ) : combinedHistory.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 20, color: t.textMuted, fontSize: 11 }}>No version history yet. This is the first version.</div>
          ) : (
            <div style={{ marginTop: 12 }}>
              {combinedHistory.map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 8 }}>
                  {/* Timeline dot + line */}
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 16 }}>
                    <div style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: item.type === 'version' ? t.accent : '#f5a623',
                      border: '2px solid ' + t.card,
                    }} />
                    {i < combinedHistory.length - 1 && <div style={{ width: 1, flex: 1, background: t.cardBorder, marginTop: 2 }} />}
                  </div>

                  {/* Content */}
                  <div style={{ flex: 1, paddingBottom: 4 }}>
                    {item.type === 'version' ? (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 11, fontWeight: 700, color: t.accent, fontFamily: "'DM Mono',monospace" }}>v{item.version}</span>
                          <span style={{ fontSize: 10, color: t.textMuted }}>snapshot saved</span>
                        </div>
                        <div style={{ fontSize: 11, color: t.text }}>{item.change_reason}</div>
                        <div style={{ fontSize: 9, color: t.textMuted, fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
                          {item.created_by_name} · {new Date(item.created_at).toLocaleString()} {item.content_hash ? '· SHA:' + item.content_hash.substring(0, 8) : ''}
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: '#f5a623' }}>{item.from_status} → {item.to_status}</span>
                        </div>
                        <div style={{ fontSize: 10, color: t.textDim }}>{item.reason}</div>
                        <div style={{ fontSize: 9, color: t.textMuted, fontFamily: "'DM Mono',monospace", marginTop: 2 }}>
                          {item.user_name} · {new Date(item.created_at).toLocaleString()}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
