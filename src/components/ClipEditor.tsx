import { useEffect, useRef, useState } from 'react';
import { BatchClip, Caption, Edit, Preset, Project, busy, time, unwrap } from '../types';
import { EditPreview } from './EditPreview';
import type { EditPreviewHandle } from './EditPreview';
import { SourceMaskEditor } from './SourceMaskEditor';
import { TextDialog } from './TextDialog';
import { Icon } from './Icon';

export function draftOf(project: Project, clip: BatchClip): Edit {
  if (clip.edit) return clip.edit;
  const base = project.edit;
  return { ...base, start: clip.start, end: clip.end, segments: [],
    items: project.batch?.reviewRequired ? [] : base.items.filter(row => !row.sample && row.end > clip.start && row.start < clip.end),
    title: { ...base.title, text: clip.title },
    overlays: base.overlays.filter(o => o.start < clip.end - clip.start).map(o => ({ ...o, end: Math.min(o.end, clip.end - clip.start) })) };
}

export function ClipEditor({ project, clip, presets, onUpdate, onPresets, onClose, report }: {
  project: Project; clip: BatchClip; presets: Preset[]; onUpdate: (p: Project) => void; onPresets: (p: Preset[]) => void;
  onClose: () => void; report: (e: unknown) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const player = useRef<EditPreviewHandle>(null);
  const [draft, setDraft] = useState(() => draftOf(project, clip));
  const [tab, setTab] = useState<'range' | 'captions' | 'frame' | 'title'>('range');
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [lock, setLock] = useState(true);
  const [presetId, setPresetId] = useState(clip.presetId || project.preset.id);
  const [appliedPreset, setAppliedPreset] = useState(clip.presetId || project.preset.id);
  const [namePreset, setNamePreset] = useState(false);
  const [request, setRequest] = useState('');
  const [watchPreview, setWatchPreview] = useState(false);
  const [copyTitle, setCopyTitle] = useState(false);
  const [copyMask, setCopyMask] = useState(false);
  const [copyTargets, setCopyTargets] = useState<string[]>([]);
  const [copyPreview, setCopyPreview] = useState('');
  const [position, setPosition] = useState(clip.start);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const total = project.source.duration || 0;
  const length = Math.max(0, draft.end - draft.start);
  const isBusy = pending || busy(project);
  const exactPreview = watchPreview && !dirty && project.job?.clipId === clip.id ? project.job.clipPreview?.mediaUrl : undefined;
  const recipients = project.batch?.clips.filter(item => item.confirmed && item.id !== clip.id) || [];
  const copyTarget = recipients.find(item => item.id === copyPreview);
  const comparison = copyTarget ? draftOf(project, copyTarget) : null;
  const previewDraft = comparison ? { ...comparison,
    title: copyTitle ? { ...comparison.title, text: draft.title.text } : comparison.title,
    sourceMask: copyMask ? { ...draft.sourceMask, start: comparison.sourceMask.start, end: comparison.sourceMask.end } : comparison.sourceMask,
  } : draft;
  useEffect(() => { const modal = dialog.current; modal?.showModal(); return () => modal?.close(); }, []);
  useEffect(() => { if (!dirty) setDraft(draftOf(project, clip)); }, [clip, project.edit, dirty]);

  const change = (patch: Partial<Edit>) => { setWatchPreview(false); setCopyPreview(''); setDirty(true); setDraft(current => ({ ...current, ...patch })); };
  const save = async () => {
    const result = await unwrap(window.studio.saveClipEdit(project.id, clip.id, draft, appliedPreset));
    onUpdate(result);
    setDirty(false);
    return result.batch!.clips.find(item => item.id === clip.id)!;
  };
  const perform = async (action: () => Promise<void>) => {
    setError(''); setPending(true);
    try { await action(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setPending(false); }
  };
  const close = () => { if (pending) return; if (dirty) setConfirmClose(true); else onClose(); };
  const range = (edge: 'start' | 'end', value: number) => {
    if (!Number.isFinite(value)) return;
    if (!lock) { change({ [edge]: value }); return; }
    const duration = Math.max(.1, Math.min(60, length || project.batch?.length || 15));
    const start = Math.max(0, Math.min(total - duration, edge === 'start' ? value : value - duration));
    change({ start: Math.round(start * 1000) / 1000, end: Math.min(total, Math.round((start + duration) * 1000) / 1000) });
    player.current?.seek(start, 0);
  };
  const changeCue = (index: number, patch: Partial<Caption>) =>
    change({ items: draft.items.map((row, i) => i === index ? { ...row, ...patch } : row) });
  const translate = () => perform(async () => {
    await save();
    const inside = draft.items.filter(row => row.start < draft.end && row.end > draft.start && row.text.trim());
    const normalized = inside.map(row => ({ start: Math.max(0, row.start - draft.start), end: Math.min(length, row.end - draft.start), text: row.text }));
    const rows = await unwrap(window.studio.translateClipSrt(project.id, clip.id, normalized));
    change({ items: rows.map(row => ({ ...row, start: row.start + draft.start, end: row.end + draft.start })), captions: { ...draft.captions, enabled: true } });
    setStatus('한국어 번역을 불러왔습니다. 확인한 뒤 저장하세요.');
  });
  const applyPreset = () => {
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;
    change({ ...preset, duration: draft.duration, title: { ...preset.title, text: draft.title.text },
      audio: { ...preset.audio, bgmPath: draft.audio.bgmPath } });
    setAppliedPreset(preset.id);
    setStatus('프리셋을 적용했습니다.');
  };
  const commands = [['range','구간'],['captions','자막'],['frame','화면'],['title','제목']] as const;

  return <dialog ref={dialog} className="modal output-caption-dialog clip-editor-dialog" aria-labelledby="clip-editor-title" onCancel={e => { e.preventDefault(); close(); }}>
    <header className="modal-head">
      <div><h2 id="clip-editor-title">쇼츠 개별 편집</h2><p className="hint">{clip.title} · 원본 {time(draft.start)}–{time(draft.end)} · {length.toFixed(1)}초</p></div>
      <button className="icon-btn" aria-label="쇼츠 편집 닫기" disabled={pending} onClick={close}><Icon name="close"/></button>
    </header>
    <div className="clip-editor-grid">
      <div className="clip-editor-preview">
        {exactPreview ? <video className="clip-exact-preview" src={exactPreview} controls playsInline preload="metadata" aria-label="합성 미리보기 영상"/> :
          <EditPreview key={copyTarget?.id || clip.id} ref={copyTarget ? undefined : player} source={project.source} edit={previewDraft} onPosition={copyTarget ? undefined : setPosition} report={report}/>}
      </div>
      <div className="clip-editor-fields">
        <div className="segmented" role="group" aria-label="쇼츠 편집 항목">
          {commands.map(([id,label])=><button key={id} aria-pressed={tab===id} className={tab===id?'active':''} onClick={()=>{setCopyPreview('');setWatchPreview(false);setTab(id);}}>{label}</button>)}
        </div>
        <fieldset disabled={isBusy} className="form-stack">
          {tab === 'range' ? <>
            <label className="check-label"><input type="checkbox" checked={lock} onChange={e=>setLock(e.target.checked)}/>현재 길이 유지 ({length.toFixed(1)}초)</label>
            <div className="field-pair">
              <label>원본 시작 (초)<input aria-label="쇼츠 구간 시작" type="number" step=".01" min="0" max={total} value={draft.start} onChange={e=>range('start',e.target.valueAsNumber)}/></label>
              <label>원본 종료 (초)<input aria-label="쇼츠 구간 종료" type="number" step=".01" min="0" max={total} value={draft.end} onChange={e=>range('end',e.target.valueAsNumber)}/></label>
            </div>
            <button className="btn" onClick={()=>player.current?.seek(draft.start,0)}>구간 처음 보기</button>
            {clip.reason ? <p className="hint">{clip.reason}</p> : null}
          </> : null}
          {tab === 'captions' ? <>
            <label className="check-label"><input type="checkbox" checked={draft.captions.enabled} onChange={e=>change({captions:{...draft.captions,enabled:e.target.checked}})}/>자막 표시</label>
            <div className="inline-actions">
              <button className="btn small" onClick={()=>perform(async()=> {
                await save();
                onUpdate(await unwrap(window.studio.run(project.id,{action:'clip-transcribe',clipId:clip.id})));
              })}>선택 구간 자막 추출</button>
              <button className="btn small" onClick={()=>perform(async()=> {
                await save();
                const next=await unwrap(window.studio.importClipSrt(project.id,clip.id));
                if(next) onUpdate(next);
              })}>SRT 가져오기</button>
              <button className="btn small" disabled={!draft.items.some(c=>/[a-zA-Z]/.test(c.text))} onClick={translate}>영어 → 한국어</button>
            </div>
            <p className="hint">SRT는 이 쇼츠의 00:00 기준입니다. 번역에는 Codex CLI를 사용합니다.</p>
            <details><summary>자막 스타일</summary><div className="clip-style-fields">
              <label>크기 {draft.captions.size}px<input type="range" min="24" max="90" value={draft.captions.size} onChange={e=>change({captions:{...draft.captions,size:+e.target.value}})}/></label>
              <label>하단 여백 {draft.captions.position}%<input type="range" min="5" max="85" value={draft.captions.position} onChange={e=>change({captions:{...draft.captions,position:+e.target.value}})}/></label>
            </div></details>
            <button className="btn small" onClick={()=>{
              const start = Math.max(draft.start, Math.min(position, draft.end - .1));
              change({items:[...draft.items,{start,end:Math.min(start+2,draft.end),text:''}],captions:{...draft.captions,enabled:true}});
            }}>+ 자막 직접 입력</button>
            <div className="clip-cue-list">
              {draft.items.map((c,i)=><div key={i} className="clip-cue">
                <div className="row-between"><button className="link-button" onClick={()=>player.current?.seek(c.start,0)}>{time(Math.max(0,c.start-draft.start))}–{time(Math.max(0,c.end-draft.start))}</button>
                  <button className="link-button" onClick={()=>change({items:draft.items.filter((_,index)=>index!==i)})}>삭제</button></div>
                <div className="field-pair">
                  <label>시작 (초)<input type="number" min="0" max={length} step=".01" value={Math.max(0,+(c.start-draft.start).toFixed(2))} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))changeCue(i,{start:draft.start+e.target.valueAsNumber});}}/></label>
                  <label>종료 (초)<input type="number" min="0" max={length} step=".01" value={Math.max(0,+(c.end-draft.start).toFixed(2))} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))changeCue(i,{end:draft.start+e.target.valueAsNumber});}}/></label>
                </div>
                <textarea aria-label={`${i+1}번 쇼츠 자막`} rows={2} maxLength={500} value={c.text} onChange={e=>changeCue(i,{text:e.target.value})}/>
              </div>)}
            </div>
          </> : null}
          {tab === 'frame' ? <>
            <label>화면 구성<select value={draft.layout} onChange={e=>change({layout:e.target.value as Edit['layout']})}><option value="crop">세로 크롭</option><option value="fit">전체 맞춤</option><option value="blur">흐린 배경</option></select></label>
            {draft.layout==='crop'?<div className="field-pair">
              <label>가로 중심<input type="range" min="0" max="100" value={draft.cropX} onChange={e=>change({cropX:+e.target.value})}/></label>
              <label>세로 중심<input type="range" min="0" max="100" value={draft.cropY} onChange={e=>change({cropY:+e.target.value})}/></label>
            </div>:null}
            <SourceMaskEditor mask={draft.sourceMask} duration={total} thumbnail={clip.thumbnailUrl || project.source.thumbnailUrl} onChange={sourceMask=>change({sourceMask})}/>
          </> : null}
          {tab === 'title' ? <>
            <label className="check-label"><input type="checkbox" checked={draft.title.enabled} onChange={e=>change({title:{...draft.title,enabled:e.target.checked}})}/>제목 표시</label>
            <label>제목<textarea rows={2} maxLength={120} value={draft.title.text} onChange={e=>change({title:{...draft.title,text:e.target.value}})}/></label>
            <label>글자 크기 {draft.title.size}px<input type="range" min="28" max="120" value={draft.title.size} onChange={e=>change({title:{...draft.title,size:+e.target.value}})}/></label>
            <label>상단 여백 {draft.title.position}%<input type="range" min="5" max="85" value={draft.title.position} onChange={e=>change({title:{...draft.title,position:+e.target.value}})}/></label>
          </> : null}
        </fieldset>
        <details className="clip-advanced"><summary>프리셋·Codex 요청</summary>
          <fieldset className="form-stack" disabled={isBusy}>
            <label>프리셋<select value={presetId} onChange={e=>setPresetId(e.target.value)}>{presets.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <div className="inline-actions"><button className="btn small" onClick={applyPreset}>프리셋 적용</button>
              <button className="btn small" onClick={()=>setNamePreset(true)}>스타일 프리셋으로 저장</button></div>
            <label>선택한 쇼츠에 요청<textarea rows={2} maxLength={2000} value={request} placeholder="제목을 짧게 하고 자막을 올려줘" onChange={e=>setRequest(e.target.value)}/></label>
            <button className="btn small" disabled={!request.trim()} onClick={()=>perform(async()=>{
              await save();
              onUpdate(await unwrap(window.studio.run(project.id,{action:'clip-ai',clipId:clip.id,request})));
              setRequest('');
            })}>Codex 편집 요청</button>
          </fieldset>
        </details>
        {recipients.length ? <details className="clip-advanced"><summary>다른 편에 설정 복사</summary>
          <fieldset className="form-stack" disabled={isBusy}>
            <div className="inline-actions">
              <label className="check-label"><input type="checkbox" checked={copyTitle} onChange={e=>setCopyTitle(e.target.checked)}/>제목 문구</label>
              <label className="check-label"><input type="checkbox" checked={copyMask} onChange={e=>setCopyMask(e.target.checked)}/>자막 가림 위치</label>
            </div>
            {recipients.map((item) => <div className="row-between" key={item.id}>
              <label className="check-label"><input type="checkbox" checked={copyTargets.includes(item.id)} onChange={e=>setCopyTargets(ids=>e.target.checked ? [...ids,item.id] : ids.filter(id=>id!==item.id))}/>{item.title}</label>
              <button className="btn small" disabled={!copyTargets.includes(item.id) || (!copyTitle && !copyMask)} onClick={()=>{setWatchPreview(false);setCopyPreview(item.id);}}>적용 전 보기</button>
            </div>)}
            {copyTarget ? <p className="hint">{copyTarget.title}에 복사할 설정을 미리 보고 있습니다.</p> : null}
            <button className="btn small" disabled={!copyTarget || !copyTargets.includes(copyTarget.id) || (!copyTitle && !copyMask)} onClick={()=>perform(async()=>{
              await save();
              onUpdate(await unwrap(window.studio.copyClipCustomization(project.id,clip.id,copyTargets,copyTitle,copyMask)));
              setCopyPreview('');setCopyTargets([]);setStatus('선택한 편에 설정을 복사했습니다.');
            })}>선택한 편에 적용</button>
          </fieldset>
        </details> : null}
      </div>
    </div>
    <footer className="modal-foot">
      <p role={error?'alert':'status'} className={error?'warn-text':'hint'}>{error || (project.job?.clipId===clip.id ? project.job.message.split('\n')[0] : status) || (dirty ? '저장할 변경이 있습니다.' : '')}</p>
      {confirmClose ? <><button className="btn" onClick={()=>setConfirmClose(false)}>계속 수정</button><button className="btn" onClick={onClose}>저장 안 함</button></> :
        <button className="btn" disabled={pending} onClick={close}>닫기</button>}
      {exactPreview ? <button className="btn" onClick={()=>setWatchPreview(false)}>편집 화면 보기</button> :
        <button className="btn" disabled={isBusy} onClick={()=>perform(async()=>{
          await save();
          setCopyPreview('');setWatchPreview(true);
          onUpdate(await unwrap(window.studio.run(project.id,{action:'clip-preview',clipId:clip.id})));
        })}>합성 미리보기 만들기</button>}
      <button className="btn primary" disabled={isBusy} onClick={()=>perform(async()=>{await save();onClose();})}>편집 저장 및 구간 확정</button>
    </footer>
    {namePreset ? <div className="clip-preset-dialog"><TextDialog heading="스타일 프리셋으로 저장" initial={clip.title + ' 스타일'}
      onClose={()=>setNamePreset(false)} onSave={async name=>{
        const list=await unwrap(window.studio.savePreset({...draft,id:'',name,builtin:false,duration:length}));
        onPresets(list);setStatus('스타일 프리셋을 저장했습니다.');
      }}/></div> : null}
  </dialog>;
}
