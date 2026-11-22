import { useState } from 'react';
import { Icon } from './Icon';
export function TextDialog({ heading, initial, onClose, onSave }: { heading: string; initial: string; onClose: () => void; onSave: (value: string) => Promise<void> }) {
  const [text, setText] = useState(initial), [saving, setSaving] = useState(false);
  return <div className="modal-backdrop"><form className="modal text-modal" role="dialog" aria-modal="true" aria-labelledby="text-dialog-heading" onSubmit={async e => { e.preventDefault(); if (!text.trim()) return; setSaving(true); try { await onSave(text.trim()); onClose(); } finally { setSaving(false); } }}><div className="modal-head"><h2 id="text-dialog-heading">{heading}</h2><button type="button" className="icon-btn" onClick={onClose} aria-label="닫기"><Icon name="close"/></button></div><label className="text-dialog-input">이름<input autoFocus value={text} maxLength={100} onChange={e => setText(e.target.value)}/></label><div className="modal-foot"><button type="button" className="btn" onClick={onClose}>취소</button><button type="submit" className="btn primary" disabled={saving || !text.trim()}>저장</button></div></form></div>;
}
