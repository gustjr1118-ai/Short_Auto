import { BatchClip, Project, time } from '../types';
import { Icon } from './Icon';

export interface BatchControls {
  length: number;
  count: number;
}

export function BatchEditor({ project, controls, onControls, selection, activeClipId, onSelect, onPreview, onView, onEdit, onRetry, onSettings, onAdd, onRemove, onCompare, busy }: {
  project: Project; controls: BatchControls; onControls: (v: BatchControls) => void; selection: string[]; activeClipId?: string;
  onSelect: (id: string) => void; onPreview: (clip: BatchClip) => void; onView: (id: string) => void;
  onEdit: (clip: BatchClip) => void; onRetry: (id: string) => void; onSettings: () => void;
  onAdd: () => void; onRemove: (id: string) => void; onCompare: () => void; busy: boolean;
}) {
  const { batch, source } = project;
  return <>
    <fieldset disabled={busy} className="production-fields">
      <div className="field-pair">
        <label>한 편의 길이<select value={controls.length} onChange={e => onControls({ ...controls, length: Number(e.target.value) })}>
          {[15, 30, 45, 60].map(length => <option key={length} value={length}>{length}초</option>)}
        </select></label>
        <label>제작 수량<select value={controls.count} onChange={e => onControls({ ...controls, count: Number(e.target.value) })}>
          {Array.from({ length: 10 }, (_, index) => index + 1).map(count => <option key={count} value={count}>{count}편</option>)}
        </select></label>
      </div>
    </fieldset>
    <div className="production-note"><span>추천에 원본 장면과 대사를 사용합니다.</span><button className="link-button" onClick={onSettings}>연결 설정</button></div>
    <div className="inline-actions batch-review-actions">
      <button className="btn small" disabled={busy || !source.mediaUrl || (batch?.clips.length || 0) >= 10} onClick={onAdd}>+ 재생 위치에서 구간 추가</button>
    </div>
    {project.previousBatch ? <details className="batch-previous"><summary>이전 후보 비교</summary>
      {project.previousBatch.clips.map((clip, index) => <p key={clip.id} className="hint">{index + 1}. {clip.title} · {time(clip.start)}–{time(clip.end)}{clip.confirmed ? ' · 편집 저장됨' : ''}</p>)}
      <button className="btn small" disabled={busy} onClick={onCompare}>이전 후보 열기</button>
    </details> : null}
    {batch ? <section className="batch-clips" aria-label="추천 쇼츠">
      <div className="row-between"><h3>구간 후보</h3><span className="chip">요청 {batch.count}편 · {batch.clips.filter(c=>c.evidenceKind!=='manual').length}편 추천</span></div>
      <p className="hint">{batch.method==='visual' ? '장면·대사 기준' : batch.method==='speech' ? '대사 기준' : '직접 선택'}</p>
      {!batch.clips.length ? <p className="hint">목표 길이에 맞는 근거 있는 후보가 없습니다. 구간을 직접 추가하세요.</p> : null}
      {batch.clips.map((clip, index) => {
        const needsWork = !clip.outputId || clip.needsRender;
        const status = clip.status === 'running' ? '제작 중' : clip.status === 'failed' ? '실패' : clip.status === 'interrupted' ? '중단됨'
          : clip.needsRender ? '수정 적용 전' : clip.outputId ? '완료' : clip.confirmed ? '편집 가능' : '검토 전';
        const active = clip.id === activeClipId;
        return <article className={`batch-clip redesign-batch-clip${active ? ' active-clip' : ''}`} aria-current={active ? 'true' : undefined} key={clip.id}>
          <div className="row-between">
            {needsWork ? <label className="check-label">
              <input type="checkbox" disabled={busy} checked={selection.includes(clip.id)} onChange={() => onSelect(clip.id)}/>{index + 1}. {clip.title}
            </label> : <strong>{index + 1}. {clip.title}</strong>}
            <span className={clip.status === 'failed' ? 'warn-text' : 'chip'}>{active ? `선택됨 · ${status}` : status}</span>
          </div>
          <div className="batch-clip-evidence">
            {clip.thumbnailUrl ? <img src={clip.thumbnailUrl} alt="추천 장면" loading="lazy"/> : null}
            <div><p className="hint">{time(clip.start)}–{time(clip.end)} · {(clip.end - clip.start).toFixed(1)}초</p>
              {clip.recommendedStart !== undefined && clip.recommendedEnd !== undefined && (clip.start !== clip.recommendedStart || clip.end !== clip.recommendedEnd) ?
                <p className="hint">처음 추천 {time(clip.recommendedStart)}–{time(clip.recommendedEnd)}</p> : null}
              <p>{clip.reason}</p>{typeof clip.score === 'number' && clip.score < 55 ? <p className="hint">추천 근거가 약합니다. 장면을 확인해 주세요.</p> : null}{clip.evidence ? <p className="hint">{clip.evidence}</p> : null}</div>
          </div>
          {clip.error ? <p className="warn-text">{clip.error}</p> : null}
          <div className="inline-actions">
            <button type="button" className="btn small" disabled={!source.mediaUrl} onClick={() => onPreview(clip)}><Icon name="play" size={14}/>이 구간 보기</button>
            <button type="button" className="btn small" disabled={busy} onClick={() => onEdit(clip)}>{clip.confirmed || clip.outputId ? '개별 편집' : '구간 조정'}</button>
            {clip.outputId ? <button className="btn small" onClick={() => onView(clip.outputId!)}>결과 보기</button> : null}
            {needsWork && ['failed', 'interrupted'].includes(clip.status || '') ?
              <button className="btn small" disabled={busy} onClick={() => onRetry(clip.id)}>이 편 다시 시도</button> : null}
            {!clip.outputId ? <button className="link-button" disabled={busy} onClick={() => onRemove(clip.id)}>후보 제거</button> : null}
          </div>
        </article>;
      })}
    </section> : null}
  </>;
}
