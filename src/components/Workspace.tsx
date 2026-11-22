import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { Ref } from 'react';
import { BatchClip, Caption, Edit, Preset, Project, RunOptions, Settings, busy, stateLabel, time, unwrap } from '../types';
import { durationOf, segmentsOf } from '../timeline';
import { groupOutputs } from '../output-groups';
import { Icon } from './Icon';
import { TextDialog } from './TextDialog';
import { SourceMaskEditor } from './SourceMaskEditor';
import { BatchEditor } from './BatchEditor';
import type { BatchControls } from './BatchEditor';
import { StructureEditor } from './StructureEditor';
import { OutputCaptionEditor } from './OutputCaptionEditor';
import { EditPreview } from './EditPreview';
import type { EditPreviewHandle } from './EditPreview';
import { Results } from './Results';
import { ClipEditor, draftOf } from './ClipEditor';

const layouts = [['crop', '세로 크롭'], ['fit', '전체 맞춤'], ['blur', '흐린 배경']] as const;
const panels = [['range', '구간', 'clock'], ['style', '화면·제목', 'crop'], ['captions', '자막', 'text'], ['audio', '소리', 'sound']] as const;
const styles = [['layout', '화면'], ['title', '제목'], ['overlays', '설명 표시']] as const;
type Panel = typeof panels[number][0];
type Style = typeof styles[number][0];
export interface WorkTarget { projectId: string; target: 'work' | 'result'; clipId?: string; stamp: number }
export interface WorkspaceHandle { beforeLeave: (next: () => void) => void }

export function Workspace({ ref, project: p, presets, settings, update, openProject, onPresets, openSettings, workTarget, report }: {
  ref?: Ref<WorkspaceHandle>; project: Project; presets: Preset[]; settings: Settings;
  update: (p: Project) => void; openProject: (p: Project) => void; onPresets: (p: Preset[]) => void;
  openSettings: () => void; workTarget?: WorkTarget | null; report: (e: unknown) => void;
}) {
  const [draft, setDraft] = useState<Edit>(() => structuredClone(p.edit));
  const [dirty, setDirty] = useState(false);
  const [panel, setPanel] = useState<Panel>('range');
  const [styleTab, setStyleTab] = useState<Style>('layout');
  const [view, setView] = useState<'edit' | 'results'>('edit');
  const [playback, setPlayback] = useState<'source' | 'selection'>('source');
  const [mode, setMode] = useState<'single' | 'batch'>(p.batch ? 'batch' : 'single');
  const [batch, setBatch] = useState<BatchControls>({ length: p.batch?.length || 30, count: p.batch?.count || 3 });
  const [picks, setPicks] = useState<{ id: string; excluded: string[] } | null>(null);
  const [editingClipId, setEditingClipId] = useState('');
  const [batchPreviewId, setBatchPreviewId] = useState('');
  const [resultId, setResultId] = useState(p.outputs.at(-1)?.id || '');
  const [captionOutputId, setCaptionOutputId] = useState('');
  const [showRequest, setShowRequest] = useState(false);
  const [request, setRequest] = useState('');
  const [auto, setAuto] = useState(false);
  const [autoSingle, setAutoSingle] = useState(false);
  const [pending, setPending] = useState(false);
  const [playTime, setPlayTime] = useState(p.edit.start);
  const [segmentIndex, setSegmentIndex] = useState(0);
  const [textDialog, setTextDialog] = useState<'rename' | 'preset' | null>(null);
  const [leaveAction, setLeaveAction] = useState<(() => void) | null>(null);
  const preview = useRef<EditPreviewHandle>(null);
  const pendingSeek = useRef<{ time: number; index: number } | null>(null);
  const settledJob = useRef(p.job?.state === 'completed' || p.job?.state === 'needs_input' ? p.job.id : '');
  const busyNow = busy(p);
  const isBusy = busyNow || pending;
  const latest = p.outputs.at(-1);
  const groups = useMemo(() => groupOutputs(p), [p.outputs, p.batch, p.title]);
  const captionGroup = groups.find(group => group.versions.some(item => item.id === captionOutputId));
  const captionOutputIndex = captionGroup?.versions.findIndex(item => item.id === captionOutputId) ?? -1;
  const captionOutput = captionGroup?.versions[captionOutputIndex];
  const tab = panel === 'style' ? styleTab : panel;
  const setTab = (tab: 'range' | 'structure') => { setMode('single'); setBatchPreviewId(''); setPanel('range'); if (tab === 'structure') requestAnimationFrame(() => document.getElementById('connected-ranges')?.scrollIntoView({ block: 'nearest' })); };

  useEffect(() => {
    if (dirty) return;
    setDraft(current => current === p.edit ? current : p.edit);
  }, [dirty, p.revision, p.job?.state, p.source.path, p.edit.items.length]);

  useEffect(() => {
    const job = p.job;
    if (!job || settledJob.current === job.id || !['completed', 'needs_input'].includes(job.state)) return;
    settledJob.current = job.id;
    if (job.state === 'needs_input') {
      if (job.runOptions?.action !== 'batch-analyze') { setAuto(false); setPanel('range'); }
      return;
    }
    if (latest && (['render', 'batch-render', 'output-captions'].includes(job.runOptions?.action || '') ||
      (job.runOptions?.action === 'batch-analyze' && job.runOptions.autoBatch))) {
      setResultId(latest.id);
      setView('results');
    }
  }, [latest, p.job]);

  const currentPicks = picks && picks.id === p.batch?.id ? picks : null;
  const clips = p.batch?.clips || [];
  const editingClip = clips.find(clip => clip.id === editingClipId);
  const selection = clips.filter(clip => (!clip.outputId || clip.needsRender) && !currentPicks?.excluded.includes(clip.id)).map(clip => clip.id);
  const needsConfirmation = !!p.batch?.reviewRequired && clips.some(clip => selection.includes(clip.id) && !clip.confirmed);
  const batchReady = !!p.batch && p.batch.length === batch.length && p.batch.count === batch.count;
  const needsSelection = mode === 'batch' && batchReady && !selection.length && clips.some(clip => !clip.outputId || clip.needsRender);
  const batchPreview = mode === 'batch' ? clips.find(clip => clip.id === batchPreviewId) : undefined;
  const batchStart = batchPreview?.start || 0;
  const previewEdit = batchPreview ? draftOf(p, batchPreview) : draft;
  const previewPlayback = batchPreview ? 'selection' : playback;
  const sourceLength = p.source.duration || 1800;
  const segments = segmentsOf(draft);
  const activeIndex = Math.min(segmentIndex, segments.length - 1);
  const activeSegment = segments[activeIndex];
  const inRange = playTime >= activeSegment.start && playTime < activeSegment.end;
  const persistedSingle = [...p.outputs].reverse().find(o => o.revision !== null);
  const outputNeedsUpdate = !!persistedSingle && (dirty || persistedSingle.revision !== p.revision);

  useEffect(() => {
    if (batchPreview || view !== 'edit' || !pendingSeek.current) return;
    preview.current?.seek(pendingSeek.current.time, pendingSeek.current.index);
    pendingSeek.current = null;
  }, [batchPreview?.id, view]);

  const change = (patch: Partial<Edit>) => {
    setDraft(current => ({ ...current, ...patch }));
    setDirty(true);
  };
  const persist = async () => {
    if (!dirty) return p;
    const saved = await unwrap(window.studio.saveEdit(p.id, draft));
    setDraft(saved.edit);
    setDirty(false);
    update(saved);
    return saved;
  };
  const act = async (fn: () => Promise<Project | null>, saveDraft = true) => {
    setPending(true);
    try { if (saveDraft) await persist(); const value = await fn(); if (value) update(value); }
    catch (error) { report(error); }
    finally { setPending(false); }
  };
  const execute = async (options: RunOptions = {}) => {
    await act(() => unwrap(window.studio.run(p.id, options)), options.action !== 'output-captions');
  };
  const retry = () => {
    const previous = p.job?.runOptions;
    const available = clips.filter(clip => !clip.outputId || clip.needsRender).map(clip => clip.id);
    if (previous?.action === 'batch-render' || (previous?.action === 'batch-analyze' && previous.autoBatch && p.job?.stage === 'render')) {
      const clipIds = (previous.clipIds || available).filter(id => available.includes(id));
      if (clipIds.length) void execute({ ...previous, action: 'batch-render', clipIds });
    } else if (previous) void execute(previous);
    else if (p.job?.code === 'WHISPER_SETUP') void execute({ action: 'transcribe' });
  };
  const beforeLeave = (next: () => void) => {
    if (dirty) setLeaveAction(() => next);
    else next();
  };
  useImperativeHandle(ref, () => ({ beforeLeave }));
  const send = async () => {
    if (!request.trim()) return;
    const intent = /(?:^|\D)(15|30|45|60)\s*초(?:짜리)?\s*(?:쇼츠\s*)?(\d{1,2})\s*(?:편|개)/.exec(request);
    if (intent) {
      const next = { length: Number(intent[1]), count: Number(intent[2]) };
      setBatch(next); setMode('batch'); setPanel('range'); setRequest(''); setShowRequest(false);
      await execute({ action: 'batch-analyze', ...next });
      return;
    }
    const clipNumber = /(?:^|\D)(\d{1,2})\s*번\s*(?:쇼츠|영상)/.exec(request);
    const clip = clipNumber && clips[Number(clipNumber[1]) - 1];
    if (clip) {
      setMode('batch'); setPanel('range'); setEditingClipId(clip.id); setShowRequest(false);
      await execute({ action: 'clip-ai', clipId: clip.id, request });
      setRequest('');
      return;
    }
    await act(async () => {
      const project = await unwrap(window.studio.requestEdit(p.id, request.trim()));
      setRequest('');
      return project;
    });
  };
  const viewResult = (id = '') => { preview.current?.pause(); setResultId(id || resultId || latest?.id || ''); setView('results'); };
  useEffect(() => {
    if (workTarget?.projectId !== p.id) return;
    const clip = p.batch?.clips.find(item => item.id === workTarget.clipId);
    if (workTarget.target === 'result') { setView('results'); setResultId(clip?.outputId || p.outputs.at(-1)?.id || ''); }
    else {
      setView('edit');
      if (p.batch) { setMode('batch'); setPanel('range'); }
      if (clip) setEditingClipId(clip.id);
    }
  }, [workTarget?.stamp, p.id]);
  const openSingleResult = (id: string) => beforeLeave(async () => {
    try { openProject(await unwrap(window.studio.openOutputProject(p.id, id))); } catch (error) { report(error); }
  });
  const seek = (seconds: number, index = 0) => {
    if (batchPreview) { pendingSeek.current = { time: seconds, index }; setBatchPreviewId(''); }
    else preview.current?.seek(seconds, index);
  };
  const showSource = () => {
    preview.current?.pause();
    if (batchPreview) seek(batchStart);
    setPlayback('source');
  };
  const showSelection = (start = inRange ? playTime : activeSegment.start, index = activeIndex) => {
    preview.current?.pause();
    setPlayback('selection');
    seek(start, index);
  };
  const addSample = async () => {
    const index = segments.findIndex(s => playTime >= s.start && playTime < s.end - .1);
    const target = index >= 0 ? playTime : segments[0].start;
    await act(async () => {
      const value = await unwrap(window.studio.addSampleCaption(p.id, target));
      showSelection(target, Math.max(0, index));
      return value;
    });
  };
  const setCaption = (index: number, patch: Partial<Caption>) => change({ items: draft.items.map((c, i) => i === index ? { ...c, ...patch } : c) });
  const saveName = async (name: string) => {
    try {
      if (textDialog === 'rename') update(await unwrap(window.studio.rename(p.id, name)));
      else onPresets(await unwrap(window.studio.savePreset({ ...draft, id: '', name, builtin: false, duration: durationOf(draft) })));
    } catch (error) { report(error); }
  };
  const pickClip = (id: string) => {
    if (!p.batch) return;
    const excluded = currentPicks?.excluded || [];
    setPicks({ id: p.batch.id, excluded: excluded.includes(id) ? excluded.filter(item => item !== id) : [...excluded, id] });
  };
  const previewClip = (clip: BatchClip) => {
    if (batchPreviewId === clip.id) preview.current?.seek(clip.start, 0);
    setBatchPreviewId(clip.id);
  };
  const batchAnalysis = () => execute({ action: 'batch-analyze', ...batch });
  const makeBatch = () => {
    if (!batchReady || !selection.length) return batchAnalysis();
    if (needsConfirmation) return act(() => unwrap(window.studio.confirmClips(p.id, selection)));
    return execute({ action: 'batch-render', clipIds: selection });
  };
  const addClip = () => act(async () => {
    const next = await unwrap(window.studio.addManualClip(p.id, batchPreview ? batchStart : playTime, batch.length, batch.count));
    setEditingClipId(next.batch!.clips.at(-1)!.id);
    return next;
  });
  const swapBatch = () => act(async () => {
    const next = await unwrap(window.studio.swapBatch(p.id));
    if (next.batch) setBatch({ length: next.batch.length, count: next.batch.count });
    setBatchPreviewId('');
    return next;
  });
  const makeSingle = () => execute({ action: 'render', auto: auto && !draft.segments.length, review: !autoSingle });
  const primaryLabel = mode === 'batch'
    ? batchReady && selection.length ? needsConfirmation ? '선택한 구간 확정' : `선택한 ${selection.length}편 제작` : needsSelection ? '제작할 편 선택' : '하이라이트 추천'
    : auto && !draft.segments.length ? autoSingle ? '추천 후 바로 제작' : '핵심 구간 추천' : persistedSingle ? '새 버전 만들기' : '쇼츠 만들기';
  const batchCounts = clips.reduce((count, clip) => {
    if (clip.outputId) count.done++;
    else if (clip.status === 'failed') count.failed++;
    return count;
  }, { done: 0, failed: 0 });
  const failedJob = !!p.job && ['failed', 'interrupted', 'cancelled'].includes(p.job.state);
  const offerSettings = !!p.job?.code && /^(?:CLI_|CODEX_|WHISPER_SETUP|STT_SETUP|TTS_SETUP)/.test(p.job.code);
  const prepareSource = () => execute({ action: 'prepare' });

  return <div className="workspace redesigned-workspace">
    {editingClip ? <ClipEditor key={editingClip.id} project={p} clip={editingClip} presets={presets} onUpdate={update} onPresets={onPresets}
      onClose={() => setEditingClipId('')} report={report}/> : null}
    {captionOutput ? <OutputCaptionEditor key={captionOutput.id} projectId={p.id} output={captionOutput}
      source={p.source} version={captionOutputIndex + 1} onClose={() => setCaptionOutputId('')}
      onStarted={project => { update(project); setCaptionOutputId(''); }} report={report}/> : null}

    <header className="redesign-project-bar">
      <button className="title-button" aria-label="프로젝트 이름 변경" title={p.title} disabled={isBusy} onClick={() => setTextDialog('rename')}>{p.title}</button>
      <nav aria-label="프로젝트 화면" className="project-views">
        <button aria-current={view === 'edit'} onClick={() => setView('edit')}>편집</button>
        <button aria-current={view === 'results'} onClick={() => viewResult()}>결과 <span>{groups.length}</span></button>
      </nav>
      <div className="redesign-project-actions">
        <div className="project-state" aria-live="polite">
          <span className={dirty ? 'unsaved' : ''}>{dirty ? '저장할 변경 있음' : '편집 저장됨'}</span>
          {outputNeedsUpdate ? <small>편집 변경 · 최신 MP4에 미반영</small> : null}
        </div>
        <button className="icon-btn" title="프로젝트 복제" aria-label="프로젝트 복제" disabled={isBusy}
          onClick={() => act(() => unwrap(window.studio.duplicate(p.id)))}><Icon name="copy" size={16}/></button>
        <button className="icon-btn" title="작업 폴더 열기" aria-label="작업 폴더 열기"
          onClick={() => unwrap(window.studio.openFolder(p.id)).catch(report)}><Icon name="folder" size={16}/></button>
        {busyNow ? <button className="btn danger" onClick={() => unwrap(window.studio.cancel(p.id)).then(update).catch(report)}><Icon name="stop" size={14}/>작업 취소</button>
          : view === 'edit' ? <button className="btn primary main-production" disabled={pending || needsSelection}
            onClick={mode === 'batch' ? makeBatch : makeSingle}><Icon name="spark" size={15}/>{primaryLabel}</button> : null}
      </div>
    </header>

    {view === 'edit' ? <div className="redesign-control-bar">
      <div className="segmented production-mode" role="group" aria-label="제작 방식">
        <button aria-pressed={mode === 'single'} className={mode === 'single' ? 'active' : ''} disabled={isBusy}
          onClick={() => { setMode('single'); setBatchPreviewId(''); setPanel('range'); }}>한 편</button>
        <button aria-pressed={mode === 'batch'} className={mode === 'batch' ? 'active' : ''} disabled={isBusy}
          onClick={() => { setMode('batch'); setPanel('range'); }}>여러 편</button>
      </div>
      <label className="preset-picker">프리셋<select disabled={isBusy} value={p.preset.id}
        onChange={e => { const value = e.currentTarget.value; act(() => unwrap(window.studio.applyPreset(p.id, value))); }}>
        {!presets.some(item => item.id === p.preset.id) ? <option value={p.preset.id}>{p.preset.name}</option> : null}
        {presets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></label>
      <div className="source-inline" title={p.source.name}><Icon name={p.source.kind === 'url' ? 'link' : 'film'} size={16}/>
        <span>{p.source.name}</span>{p.source.duration ? <small>{time(p.source.duration)}</small> : <small>원본 준비 전</small>}</div>
      <button className="btn small" aria-expanded={showRequest} onClick={() => setShowRequest(open => !open)}><Icon name="spark" size={14}/>AI 편집 요청</button>
    </div> : null}

    {p.job ?
      <section className={`workspace-job ${p.job.state === 'failed' ? 'has-error' : ''}`} aria-label="현재 작업 상태">
        <div className="workspace-job-label">{busyNow ? <span className="spinner"/> : <Icon name={p.job.state === 'completed' ? 'check' : 'clock'} size={16}/>}<strong>{busyNow && p.job.runOptions?.action === 'prepare' && p.job.state === 'running' ? '원본 준비' : stateLabel(p.job.state)}</strong></div>
        <div className="workspace-job-copy" role="status"><span>{p.job.message.split('\n')[0]}</span>
          {p.job.message.includes('\n') ? <details><summary>오류 상세</summary><p>{p.job.message.split('\n').slice(1).join('\n')}</p></details> : null}
          {busyNow && p.job.progress !== null ? <progress aria-label="제작 진행률" value={p.job.progress} max={100}/> : null}
        </div>
        {p.batch && (p.job.runOptions?.action === 'batch-render' ||
          (p.job.runOptions?.action === 'batch-analyze' && p.job.runOptions.autoBatch && p.job.stage === 'render')) ?
          <small>완료 {batchCounts.done}/{clips.length}{batchCounts.failed ? ` · 실패 ${batchCounts.failed}` : ''}</small> : null}
        {offerSettings ? <button className="btn small" onClick={openSettings}>연결 설정 열기</button> : null}
        {failedJob && (p.job.runOptions || p.job.code === 'WHISPER_SETUP') ? <button className="btn small" disabled={isBusy} onClick={retry}>다시 시도</button> : null}
      </section> : null}

    {view === 'results' ? <Results project={p} outputId={resultId} onSelect={setResultId}
      onEditCaptions={setCaptionOutputId} onOpenEdit={openSingleResult} onBack={() => setView('edit')} busy={isBusy} report={report}/> :
      <div className="redesign-edit-grid">
        <main className="redesign-stage">
          <div className="stage-head">
            <div><h2>{batchPreview ? '추천 구간 미리보기' : '미리보기'}</h2>
              <p>{batchPreview ? batchPreview.title : p.source.duration ? `원본 ${time(p.source.duration)} · 선택 구간 ${Math.max(0, durationOf(draft)).toFixed(1)}초` : '원본을 준비하는 중입니다.'}</p></div>
            <div className="segmented preview-playback-mode" role="group" aria-label="미리보기 범위">
              <button type="button" className={previewPlayback === 'source' ? 'active' : ''} aria-pressed={previewPlayback === 'source'}
                onClick={showSource}>원본 전체</button>
              <button type="button" className={previewPlayback === 'selection' ? 'active' : ''} aria-pressed={previewPlayback === 'selection'}
                onClick={() => { if (!batchPreview) showSelection(); }}>선택 구간</button>
            </div>
          </div>
          <div className="stage-canvas">
            <EditPreview key={batchPreview ? `${batchPreview.id}-${batchStart}` : 'draft'} ref={preview} edit={previewEdit} source={p.source} playback={previewPlayback} report={report}
              onPosition={batchPreview ? undefined : (seconds, index) => { setPlayTime(seconds); setSegmentIndex(index); }}/>
            {!p.source.path && !isBusy ? <button className="btn stage-prepare" onClick={prepareSource}>원본 준비</button> : null}
          </div>
          <section className="source-timeline" aria-label="원본 구간과 재생 순서">
            <div className="row-between"><strong>원본 전체 구간</strong><small>{p.source.duration ? `총 ${time(p.source.duration)}` : '준비 전'}</small></div>
            <div className="source-timeline-track" aria-hidden="true">
              {segmentsOf(previewEdit).map((segment, index) => <span key={segment.id} className={index === (batchPreview ? 0 : activeIndex) ? 'current' : ''} style={{
                left: `${Math.max(0, segment.start / sourceLength * 100)}%`,
                width: `${Math.max(0, (segment.end - segment.start) / sourceLength * 100)}%`,
              }}/>)}
              {!batchPreview && p.source.duration ? <i style={{ left: `${Math.min(100, playTime / sourceLength * 100)}%` }}/> : null}
            </div>
            <div className="segment-actions">
              {segmentsOf(previewEdit).map((segment, index) => <button className="segment-jump" key={segment.id}
                aria-pressed={index === (batchPreview ? 0 : activeIndex)} disabled={!p.source.mediaUrl}
                onClick={() => batchPreview ? preview.current?.seek(segment.start, index) : showSelection(segment.start, index)}>
                {segment.label || (draft.segments.length && !batchPreview ? `${index + 1}번 구간` : '선택 구간')} <small>{time(segment.start)}–{time(segment.end)}</small>
              </button>)}
            </div>
          </section>
        </main>

        <aside className="redesign-inspector" aria-label="편집 설정">
          <div className="inspector-tabs" role="group" aria-label="편집 항목">
            {panels.map(([id, label, icon]) => <button aria-pressed={panel === id} key={id}
              className={panel === id ? 'active' : ''} onClick={() => {
                setPanel(id);
                if (id !== 'range' && playback === 'source' && !batchPreview) showSelection();
              }}><Icon name={icon} size={15}/>{label}</button>)}
          </div>
          <div className="inspector-scroll">
            {panel === 'range' && mode === 'batch' ? <BatchEditor project={p} controls={batch} onControls={setBatch} selection={selection}
              onSelect={pickClip} onPreview={previewClip} onView={viewResult} onEdit={setEditingClipId} onRetry={id => execute({ action: 'batch-render', clipIds: [id] })}
              onAdd={addClip} onCompare={swapBatch} onRemove={id => act(() => unwrap(window.studio.removeClip(p.id, id)))} onSettings={openSettings} busy={isBusy}/> : null}
            <fieldset disabled={isBusy} className="form-stack redesign-fields" hidden={panel === 'range' && mode === 'batch'}>
              {panel === 'range' && mode === 'single' ? <>
                <div className="segmented" role="group" aria-label="구간 선정 방식">
                  <button type="button" aria-pressed={!auto || !!draft.segments.length} className={!auto || draft.segments.length ? 'active' : ''} onClick={() => setAuto(false)}>직접 선택</button>
                  <button type="button" aria-pressed={auto && !draft.segments.length} className={auto && !draft.segments.length ? 'active' : ''} disabled={!!draft.segments.length} onClick={() => setAuto(true)}>핵심 구간 추천</button>
                </div>
                {auto && !draft.segments.length ? <label className="check-label"><input type="checkbox" checked={autoSingle} onChange={e => setAutoSingle(e.currentTarget.checked)}/>추천 후 바로 제작</label> : null}
                {p.candidates.length ? <section className="redesign-candidates" aria-label="추천 구간"><h3>추천 구간</h3>
                  {p.candidates.map(candidate => <button type="button" className={`candidate ${Math.abs(draft.start - candidate.start) < .01 && !draft.segments.length ? 'selected' : ''}`}
                    key={candidate.id} onClick={() => {
                      change({ start: candidate.start, end: candidate.end, segments: [], overlays: [], title: { ...draft.title, text: candidate.title } });
                      setAuto(false);
                      showSelection(candidate.start, 0);
                    }}>
                    <div><strong>{candidate.title}</strong><p>{candidate.reason}</p><small>{time(candidate.start)}–{time(candidate.end)}</small></div><Icon name="play" size={15}/>
                  </button>)}</section> : null}
                {!draft.segments.length ? <>
                  <div className="row-between"><h3>원본 구간</h3><span className="chip">{durationOf(draft).toFixed(1)}초</span></div>
                  <div className="field-pair">
                    <label>시작 (초)<input aria-label="시작 초" type="number" min="0" max={sourceLength} step="0.1" value={draft.start}
                      onChange={e => change({ start: Number(e.currentTarget.value) })}/></label>
                    <label>종료 (초)<input aria-label="종료 초" type="number" min="0" max={sourceLength} step="0.1" value={draft.end}
                      onChange={e => change({ end: Number(e.currentTarget.value) })}/></label>
                  </div>
                  <div className="segmented" role="group" aria-label="목표 길이">
                    {[15, 30, 45, 60].map(length => <button type="button" key={length} className={Math.abs(draft.end - draft.start - length) < .1 ? 'active' : ''}
                      aria-pressed={Math.abs(draft.end - draft.start - length) < .1} onClick={() => change({ end: Math.min(sourceLength, draft.start + length), duration: length })}>{length}초</button>)}
                  </div>
                  <button className="btn" disabled={!p.source.mediaUrl} onClick={() => {
                    const start = Math.max(0, Math.min(playTime, sourceLength - .1));
                    change({ start, end: Math.min(sourceLength, start + draft.duration) });
                    showSelection(start, 0);
                  }}>현재 재생 위치를 시작으로</button>
                </> : null}
                <details id="connected-ranges" className="inspector-details" open={draft.segments.length ? true : undefined}>
                  <summary>구간 연결과 순서</summary><StructureEditor section="segments" edit={draft} sourceLength={sourceLength} playTime={playTime} segmentIndex={activeIndex} onChange={change} onSeek={seek}/>
                </details>
              </> : null}
              {panel === 'style' ? <div className="segmented" role="group" aria-label="화면과 제목 설정">
                {styles.map(([id, label]) => <button type="button" key={id} className={styleTab === id ? 'active' : ''} aria-pressed={styleTab === id}
                  onClick={() => setStyleTab(id)}>{label}</button>)}</div> : null}
              {tab === 'overlays' ? <StructureEditor section="overlays" edit={draft} sourceLength={sourceLength} playTime={playTime} segmentIndex={activeIndex} onChange={change} onSeek={seek}/> : null}
              {tab === 'captions' ? <div className="production-note"><span>원본 시간 기준 · {settings.transcriptionEngine === 'whisper' ? '로컬 Whisper 전사' : 'API 전사'}</span><button className="link-button" onClick={openSettings}>연결 설정</button></div> : null}
              {tab === 'title' ? <><label className="check-label"><input type="checkbox" checked={draft.title.enabled} onChange={e => change({ title: { ...draft.title, enabled: e.target.checked } })}/>제목 표시</label><label>제목 문구<textarea rows={3} value={draft.title.text} maxLength={120} onChange={e => change({ title: { ...draft.title, text: e.target.value } })}/></label><p className="hint">Enter로 최대 2줄. 긴 문구는 출력 시 크기를 조절합니다.</p><label>가로 위치 {draft.title.x}%<input type="range" min="8" max="92" value={draft.title.x} onChange={e => change({ title: { ...draft.title, x: Number(e.target.value) } })}/></label><label>정렬<select value={draft.title.align} onChange={e => change({ title: { ...draft.title, align: e.target.value as Edit['title']['align'] } })}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label><label>상단 여백 {draft.title.position}%<input type="range" min="5" max="85" value={draft.title.position} onChange={e => change({ title: { ...draft.title, position: +e.target.value } })}/></label><label>글자 크기 <span>{Math.round(draft.title.size)}px</span><input type="range" min="28" max="110" value={draft.title.size} onChange={e => change({ title: { ...draft.title, size: +e.target.value } })}/></label><div className="field-pair"><label>글자 색<input type="color" value={draft.title.color} onChange={e => change({ title: { ...draft.title, color: e.target.value } })}/></label><label>표시 시간<select value={draft.title.seconds} onChange={e => change({ title: { ...draft.title, seconds: +e.target.value } })}><option value="0">전체 구간</option><option value="2">처음 2초</option><option value="3">처음 3초</option><option value="5">처음 5초</option></select></label></div><label className="check-label"><input type="checkbox" checked={draft.title.background} onChange={e => change({ title: { ...draft.title, background: e.target.checked } })}/>제목 배경</label></> : null}
              {tab === 'captions' ? <><label className="check-label"><input type="checkbox" checked={draft.captions.enabled} onChange={e => change({ captions: { ...draft.captions, enabled: e.target.checked } })}/>자막 표시</label><button className="btn" onClick={addSample}>+ 예시 자막 추가</button><div className="field-pair"><button className="btn" onClick={() => act(() => unwrap(window.studio.importSrt(p.id)))}><Icon name="upload" size={14}/>SRT 가져오기</button><button className="btn" onClick={() => execute({ action: 'transcribe' })}>자동 전사</button></div><label>글자 크기 <span>{Math.round(draft.captions.size)}px</span><input type="range" min="24" max="90" value={draft.captions.size} onChange={e => change({ captions: { ...draft.captions, size: +e.target.value } })}/></label><div className="field-pair"><label>글자색<input type="color" value={draft.captions.color} onChange={e => change({ captions: { ...draft.captions, color: e.target.value } })}/></label><label>강조색<input type="color" value={draft.captions.accent} onChange={e => change({ captions: { ...draft.captions, accent: e.target.value } })}/></label></div><label>강조할 단어<input placeholder="쉼표로 구분" value={draft.captions.highlight} onChange={e => change({ captions: { ...draft.captions, highlight: e.target.value } })}/></label><label>가로 위치 {draft.captions.x}%<input type="range" min="8" max="92" value={draft.captions.x} onChange={e => change({ captions: { ...draft.captions, x: Number(e.target.value) } })}/></label><label>정렬<select value={draft.captions.align} onChange={e => change({ captions: { ...draft.captions, align: e.target.value as Edit['captions']['align'] } })}><option value="left">왼쪽</option><option value="center">가운데</option><option value="right">오른쪽</option></select></label><label>하단 여백 {draft.captions.position}%<input type="range" min="5" max="85" value={draft.captions.position} onChange={e => change({ captions: { ...draft.captions, position: +e.target.value } })}/></label><label className="check-label"><input type="checkbox" checked={draft.captions.background} onChange={e => change({ captions: { ...draft.captions, background: e.target.checked } })}/>자막 배경</label><div className="caption-script-actions"><button className="btn" onClick={() => execute({ action: 'caption-script', captionMode: 'verbatim' })}>선택 구간 원문 자막 반영</button><button className="btn" onClick={() => execute({ action: 'caption-script', captionMode: 'polished' })}>Codex로 자막 다듬어 반영</button><p className="hint">확인 후 다시 제작하면 MP4에도 반영됩니다.</p></div><div className="sample-caption-box"><strong>프리셋 예시 자막</strong><p>{draft.sampleCaption}</p><small>현재 지점에 최대 3초 · 자막 표시 자동 켬 · 실제 MP4에도 출력됩니다.</small></div><div className="row-between"><h3>자막 {draft.items.length}개</h3><button className="link-button" onClick={() => { const start = inRange ? playTime : activeSegment.start; change({ captions: { ...draft.captions, enabled: true }, items: [...draft.items, { start, end: Math.min(start + 3, activeSegment.end), text: '' }] }); seek(start, activeIndex); }}>+ 빈 자막</button></div>{draft.items.some(c => c.sample) ? <p className="hint">예시 자막은 자동 추천에서 제외됩니다. 테스트 후 삭제하거나 ‘실제 자막으로 사용’을 누르세요.</p> : null}<div className="caption-list">{draft.items.map((c, i) => <div className="caption-item" key={i}><div><input aria-label={`${i + 1}번 자막 시작`} type="number" step="0.1" value={c.start} onChange={e => setCaption(i, { start: +e.target.value })}/><span>–</span><input aria-label={`${i + 1}번 자막 종료`} type="number" step="0.1" value={c.end} onChange={e => setCaption(i, { end: +e.target.value })}/><button title="자막 삭제" className="icon-btn" onClick={() => change({ items: draft.items.filter((_, index) => index !== i) })}><Icon name="close" size={12}/></button></div>{c.sample ? <div className="row-between"><span className="sample-tag">예시 · 테스트용</span><button className="link-button" onClick={() => setCaption(i, { sample: false })}>실제 자막으로 사용</button></div> : null}<button className="link-button" onClick={() => seek(c.start, Math.max(0, segments.findIndex(s => c.start >= s.start && c.start < s.end)))}>이 자막 위치 보기</button><textarea aria-label={`${i + 1}번 자막 내용`} rows={2} value={c.text} onChange={e => setCaption(i, { text: e.target.value })}/></div>)}</div>{!draft.items.length ? <p className="hint">자막은 원본 시간 기준으로 입력합니다. 무음 영상은 자막 없이 제작할 수 있습니다.</p> : null}</> : null}
              {tab === 'layout' && draft.segments.length ? <><h3>구간별 화면 구성</h3><p className="hint">연결된 각 구간의 화면과 크롭 위치를 구간 탭의 연결 구간에서 조정하세요.</p><button className="btn" onClick={() => setTab('structure')}>구간별 화면 설정 열기</button></> : null}
              {tab === 'layout' && !draft.segments.length ? <><h3>9:16 화면 구성</h3><div className="layout-options">{layouts.map(([value, name]) => <button key={value} className={draft.layout === value ? 'selected' : ''} onClick={() => change({ layout: value })}><span className={`layout-icon layout-icon-${value}`}/>{name}</button>)}</div>{draft.layout === 'crop' ? <><label>가로 중심 {Math.round(draft.cropX)}%<input type="range" min="0" max="100" value={draft.cropX} onChange={e => change({ cropX: +e.target.value })}/></label><label>세로 중심 {Math.round(draft.cropY)}%<input type="range" min="0" max="100" value={draft.cropY} onChange={e => change({ cropY: +e.target.value })}/></label></> : null}<p className="hint">세로 크롭은 화면 일부를 확대합니다. 원본 전체를 보이게 하려면 전체 맞춤 또는 흐린 배경을 선택하세요.</p></> : null}
              {tab === 'layout' ? <SourceMaskEditor mask={draft.sourceMask} duration={sourceLength} thumbnail={p.source.thumbnailUrl} onChange={sourceMask => change({ sourceMask })}/> : null}
              {tab === 'audio' ? <><h3>원본 음성과 배경음악</h3><label>자막 AI 음성<select value={draft.audio.narrationMode} onChange={e => change({ audio: { ...draft.audio, narrationMode: e.target.value as Edit['audio']['narrationMode'] } })}><option value="off">끄기 · 원음 유지</option><option value="mix">원음과 혼합</option><option value="replace">원음 음소거 · AI 음성</option></select></label>{draft.audio.narrationMode !== 'off' ? <><label>AI 음색<select value={draft.audio.narrationVoice} onChange={e => change({ audio: { ...draft.audio, narrationVoice: e.target.value } })}><option value="Sohee">Sohee · 한국어</option><option value="Vivian">Vivian</option><option value="Ryan">Ryan</option></select></label><p className="hint">예시 자막을 제외한 대사를 읽습니다. 자막 반영 후 다시 제작하면 음성이 적용됩니다.</p></> : null}<label>원음 {Math.round(draft.audio.volume * 100)}%<input type="range" min="0" max="2" step="0.01" value={draft.audio.volume} onChange={e => change({ audio: { ...draft.audio, volume: +e.target.value } })}/></label><label>BGM 파일<button className="btn file-picker" onClick={() => act(() => unwrap(window.studio.chooseBgm(p.id)))}><Icon name="folder" size={14}/><span>{draft.audio.bgmPath.split(/[\\/]/).at(-1) || '음악 파일 선택'}</span></button></label>{draft.audio.bgmPath ? <button className="link-button" onClick={() => change({ audio: { ...draft.audio, bgmPath: '' } })}>배경음악 제거</button> : null}<label>BGM {Math.round(draft.audio.bgmVolume * 100)}%<input type="range" min="0" max="1" step="0.01" value={draft.audio.bgmVolume} onChange={e => change({ audio: { ...draft.audio, bgmVolume: +e.target.value } })}/></label><label>페이드 시간 {draft.audio.fade}초<input type="range" min="0" max="5" step="0.1" value={draft.audio.fade} onChange={e => change({ audio: { ...draft.audio, fade: +e.target.value } })}/></label><p className="hint">원본 재생 속도는 유지됩니다. BGM은 선택한 영상 길이에 맞춰 반복됩니다.</p></> : null}
            </fieldset>
          </div>
          <div className="inspector-foot">
            <button className="icon-btn" disabled={isBusy || (!dirty && !p.undo.length)} title="변경 되돌리기" aria-label="변경 되돌리기" onClick={() => {
              if (dirty) { setDraft(p.edit); setDirty(false); }
              else void act(() => unwrap(window.studio.undo(p.id)));
            }}><Icon name="undo" size={16}/></button>
            <button className="btn small" disabled={isBusy} onClick={() => setTextDialog('preset')}>프리셋으로 저장</button>
            <button className="btn small" disabled={isBusy || !dirty} onClick={() => act(async () => null)}>편집 저장</button>
            {panel === 'range' && mode === 'batch' && p.batch ? <button className="link-button" disabled={isBusy} onClick={batchAnalysis}>다시 추천</button> : null}
          </div>
        </aside>
        {showRequest ? <section className="request-drawer" aria-label="AI 편집 요청">
          <div className="row-between"><h2>AI 편집 요청</h2><button className="icon-btn" aria-label="AI 편집 요청 닫기" onClick={() => setShowRequest(false)}><Icon name="close"/></button></div>
          <div className="request-history">
            {p.messages.length ? p.messages.map((message, index) => <div className={`message message-${message.role}`} key={`${message.at}-${index}`}>
              <div>{message.text}</div></div>) : <p className="hint">제목, 자막 크기, 화면 자르기 등을 문장으로 요청할 수 있습니다.</p>}
          </div>
          <form className="composer" onSubmit={e => { e.preventDefault(); if (!isBusy) void send(); }}>
            <textarea aria-label="편집 요청" placeholder="제목을 바꾸고 자막을 조금 크게 해줘" value={request} disabled={isBusy} maxLength={2000} rows={3}
              onChange={e => setRequest(e.currentTarget.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (!isBusy) void send(); } }}/>
            <div className="composer-foot"><span>{settings.aiEngine === 'local' ? '기본 편집 규칙' : `${settings.aiEngine} CLI`}</span>
              <button className="btn small primary" disabled={isBusy || !request.trim()}>요청 적용</button></div>
          </form>
        </section> : null}
      </div>}
    {textDialog ? <TextDialog heading={textDialog === 'rename' ? '프로젝트 이름 변경' : '프리셋으로 저장'}
      initial={textDialog === 'rename' ? p.title : p.preset.name + ' · 나의 스타일'} onClose={() => setTextDialog(null)} onSave={saveName}/> : null}
    {leaveAction ? <div className="modal-backdrop"><section className="modal text-modal unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-heading">
      <div className="modal-head"><h2 id="unsaved-heading">편집 변경을 저장할까요?</h2></div>
      <div className="modal-foot">
        <button className="btn" autoFocus disabled={pending} onClick={() => setLeaveAction(null)}>계속 편집</button>
        <button className="btn" disabled={pending} onClick={() => { const next = leaveAction; setLeaveAction(null); setDraft(p.edit); setDirty(false); next(); }}>저장 안 함</button>
        <button className="btn primary" disabled={isBusy} onClick={async () => {
          setPending(true);
          try { await persist(); const next = leaveAction; setLeaveAction(null); next(); }
          catch (error) { report(error); }
          finally { setPending(false); }
        }}>저장하고 이동</button>
      </div>
    </section></div> : null}
  </div>;
}
