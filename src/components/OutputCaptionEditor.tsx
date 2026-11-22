import { useEffect, useRef, useState } from 'react';
import { Caption, Output, Project, Source, time, unwrap } from '../types';
import { Icon } from './Icon';
import { EditPreview } from './EditPreview';
import type { EditPreviewHandle } from './EditPreview';

function cueTime(seconds: number) {
  const ms = Math.round(seconds * 1000);
  return `${time(Math.floor(ms / 1000))}.${String(ms % 1000).padStart(3, '0')}`;
}

export function OutputCaptionEditor({ projectId, output, source, version, onClose, onStarted, report }: {
  projectId: string; output: Output; source: Source; version: number; onClose: () => void;
  onStarted: (project: Project) => void; report: (e: unknown) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const preview = useRef<EditPreviewHandle>(null);
  const completed = useRef<HTMLVideoElement>(null);
  const [display, setDisplay] = useState<'edit' | 'completed'>(source.mediaUrl ? 'edit' : 'completed');
  const [selectedCue, setSelectedCue] = useState<number | null>(null);
  const [changed, setChanged] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [rows, setRows] = useState<Caption[]>([]);
  const [beforeTranslation, setBeforeTranslation] = useState<Caption[] | null>(null);
  const [working, setWorking] = useState<'load' | 'import' | 'translate' | 'render' | null>('load');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const cancelled = useRef(false);

  useEffect(() => {
    const modal = dialog.current;
    modal?.showModal();
    let active = true;
    unwrap(window.studio.readOutputSrt(projectId, output.id)).then(items => { if (active) setRows(items); })
      .catch(err => { if (active) setError(err.message); })
      .finally(() => { if (active) setWorking(null); });
    return () => { active = false; modal?.close(); };
  }, [projectId, output.id]);

  const perform = async (task: NonNullable<typeof working>, run: () => Promise<void>) => {
    cancelled.current = false;
    setWorking(task);
    setError('');
    setStatus('');
    try { await run(); }
    catch (err) { if (!cancelled.current) setError(err instanceof Error ? err.message : String(err)); }
    finally { setWorking(null); }
  };
  const importSrt = () => perform('import', async () => {
    const items = await unwrap(window.studio.importOutputSrt(projectId, output.id));
    if (items) {
      setRows(items); setBeforeTranslation(null); setSelectedCue(null); setChanged(true);
      setStatus(`SRT 자막 ${items.length}개를 불러왔습니다.`);
    }
  });
  const translate = () => perform('translate', async () => {
    const items = await unwrap(window.studio.translateOutputSrt(projectId, output.id, rows));
    if (cancelled.current) return;
    setBeforeTranslation(rows);
    setRows(items);
    setSelectedCue(null);
    setChanged(true);
    setStatus('한국어 번역을 불러왔습니다. 확인 후 문구를 수정할 수 있습니다.');
  });
  const cancelTranslation = () => {
    cancelled.current = true;
    setStatus('번역을 취소했습니다.');
    void window.studio.cancelOutputTranslation(projectId);
  };
  const apply = () => perform('render', async () => {
    onStarted(await unwrap(window.studio.run(projectId, { action: 'output-captions', outputId: output.id, items: rows })));
  });

  const close = () => {
    if (working) return;
    if (changed) setConfirmClose(true);
    else onClose();
  };
  const seekCue = (cue: Caption, index: number) => {
    const target = cue.start + Math.min(.01, (cue.end - cue.start) / 2);
    setSelectedCue(index);
    if (display === 'edit') {
      preview.current?.pause();
      preview.current?.seekOutput(target);
    } else if (completed.current) {
      completed.current.pause();
      completed.current.currentTime = target;
    }
  };

  return <dialog ref={dialog} className="modal output-caption-dialog redesigned-caption-dialog" aria-labelledby="output-caption-title"
    onCancel={e => { e.preventDefault(); if (confirmClose) setConfirmClose(false); else close(); }}>
    <header className="modal-head">
      <div><h2 id="output-caption-title">완성본 자막 편집</h2><p className="hint">완성본 v{version} · {output.duration.toFixed(1)}초</p></div>
      <button className="icon-btn" disabled={!!working} onClick={close} aria-label="닫기"><Icon name="close"/></button>
    </header>
    <div className="output-caption-tools">
      <div className="inline-actions">
        <button className="btn" disabled={!!working} onClick={importSrt}><Icon name="upload" size={14}/>다른 SRT 열기</button>
        <button className="btn" disabled={!!working || !rows.some(c => /[a-zA-Z]/.test(c.text))} onClick={translate}><Icon name="spark" size={14}/>영어 → 한국어 번역</button>
        {working === 'translate' ? <button className="btn" onClick={cancelTranslation}>번역 취소</button> : null}
        {beforeTranslation && !working ? <button className="link-button" onClick={() => { setRows(beforeTranslation); setBeforeTranslation(null); setSelectedCue(null); setStatus('번역 전 자막으로 되돌렸습니다.'); }}>번역 되돌리기</button> : null}
      </div>
      <p className="hint">완성본 00:00 기준 · 문구를 비우면 해당 자막을 삭제합니다.</p>
      <p className="hint">번역에는 Codex CLI 로그인과 인터넷이 필요하며, 자막 문구만 전송합니다.</p>
      {error ? <p className="warn-text" role="alert">{error}</p> : null}
      {working === 'translate' || status ? <p className="hint" role="status">{status || 'Codex CLI로 영어 자막을 번역하고 있습니다…'}</p> : null}
    </div>
    <div className="caption-review-grid">
      <div className="caption-review-preview">
        <div className="segmented" role="group" aria-label="자막 영상 보기">
          <button className={display === 'edit' ? 'active' : ''} aria-pressed={display === 'edit'} disabled={!source.mediaUrl}
            onClick={() => setDisplay('edit')}>수정 미리보기</button>
          <button className={display === 'completed' ? 'active' : ''} aria-pressed={display === 'completed'}
            onClick={() => setDisplay('completed')}>기존 MP4</button>
        </div>
        {display === 'edit' ? <EditPreview ref={preview} source={source} edit={output.edit} captionTrack={rows} report={report}/> :
          <video ref={completed} aria-label="기존 완성본 재생" src={output.mediaUrl} className="result-video" controls playsInline preload="metadata"/>}
        <p className="hint">자막 시간을 누르면 해당 시점으로 이동합니다.</p>
      </div>
      <div className="output-caption-rows">
        {rows.map((c, i) => <div className={`output-caption-row ${selectedCue === i ? 'active' : ''}`} key={`${i}-${c.start}-${c.end}`}>
          <button className="link-button cue-jump" aria-label={`${i + 1}번 자막 위치 보기`}
            aria-pressed={selectedCue === i} onClick={() => seekCue(c, i)}>{i + 1}. {cueTime(c.start)} – {cueTime(c.end)}</button>
        <textarea aria-label={`${i + 1}번 완성본 자막`} rows={2} maxLength={500} disabled={!!working} value={c.text}
          onChange={e => { const text = e.target.value; setChanged(true); setRows(items => items.map((item, index) => index === i ? { ...item, text } : item)); }}/>
        </div>)}
      {!rows.length ? <p className="hint">{working === 'load' ? '완성본의 SRT를 불러오고 있습니다…' : '편집할 자막이 없습니다. 다른 SRT를 열어 주세요.'}</p> : null}
      </div>
    </div>
    <footer className="modal-foot">
      {confirmClose ? <>
        <p className="hint" role="status">수정한 자막을 적용하기 전에 닫을까요?</p>
        <button className="btn" onClick={() => setConfirmClose(false)}>계속 수정</button>
        <button className="btn" onClick={onClose}>적용하지 않고 닫기</button>
      </> : <>
        <p className="hint">같은 구간과 소리로 새 MP4와 SRT를 만듭니다.</p>
        <button className="btn" disabled={!!working} onClick={close}>닫기</button>
        <button className="btn primary" disabled={!!working || !rows.length} onClick={apply}>자막 적용해 새 버전 만들기</button>
      </>}
    </footer>
  </dialog>;
}
