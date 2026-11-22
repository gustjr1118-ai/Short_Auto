import { useMemo } from 'react';
import { groupOutputs, versionLabel } from '../output-groups';
import { Project, unwrap } from '../types';
import { Icon } from './Icon';

export function Results({ project, outputId, onSelect, onEditCaptions, onOpenEdit, onBack, busy, report }: {
  project: Project; outputId: string; onSelect: (id: string) => void; onEditCaptions: (id: string) => void;
  onOpenEdit: (id: string) => void; onBack: () => void; busy: boolean; report: (e: unknown) => void;
}) {
  const groups = useMemo(() => groupOutputs(project), [project.outputs, project.batch, project.title]);
  const activeGroup = groups.find(group => group.versions.some(output => output.id === outputId)) || groups.at(-1);
  const output = activeGroup?.versions.find(item => item.id === outputId) || activeGroup?.versions.at(-1);
  if (!activeGroup || !output) {
    return <section className="results-empty">
      <Icon name="film" size={38}/>
      <h2>아직 완성된 쇼츠가 없습니다</h2>
      <button className="btn" onClick={onBack}>편집으로 돌아가기</button>
    </section>;
  }

  const version = activeGroup.versions.indexOf(output);
  const save = (captions: boolean) => unwrap(window.studio.exportVideo(project.id, output.id, captions)).catch(report);

  return <section className="results-screen" aria-label="제작 결과">
    <nav className="results-list" aria-label="제작한 쇼츠">
      <header><h2>제작한 쇼츠</h2><span>{groups.length}편</span></header>
      {groups.map((group, index) => <button key={group.id} className="result-entry"
        aria-current={group.id === activeGroup.id} onClick={() => onSelect(group.versions.at(-1)!.id)}>
        <span className="result-index">{String(index + 1).padStart(2, '0')}</span>
        <span><strong>{group.title}</strong><small>{group.versions.at(-1)!.duration.toFixed(1)}초 · {group.versions.length}개 버전</small></span>
        <Icon name="play" size={14}/>
      </button>)}
    </nav>
    <div className="result-stage">
      <div className="result-stage-meta"><span>완성본</span><span>9:16 · {versionLabel(output, version)}</span></div>
      <div className="result-video-wrap">
        <video key={output.id} aria-label="완성본 재생" className="result-video" src={output.mediaUrl} controls playsInline preload="metadata"/>
      </div>
    </div>
    <div className="result-options">
      <div><p className="result-option-label">선택한 쇼츠</p><h2>{activeGroup.title}</h2></div>
      <label>버전<select aria-label="결과 버전" value={output.id} onChange={e => onSelect(e.target.value)}>
        {activeGroup.versions.map((item, index) => ({ item, index })).reverse().map(({ item, index }) =>
          <option value={item.id} key={item.id}>{versionLabel(item, index)}{index === activeGroup.versions.length - 1 ? ' · 최신' : ''}</option>)}
      </select></label>
      <dl><div><dt>재생 시간</dt><dd>{output.duration.toFixed(1)}초</dd></div>
        <div><dt>파일 크기</dt><dd>{(output.size / 1024 ** 2).toFixed(1)} MB</dd></div>
        <div><dt>프리셋</dt><dd>{output.presetName}</dd></div></dl>
      <button className="btn primary" onClick={() => save(false)}><Icon name="download" size={16}/>MP4 저장</button>
      <div className="result-secondary-actions">
        <button className="btn" onClick={() => save(true)}>SRT 저장</button>
        <button className="btn" disabled={busy} onClick={() => onEditCaptions(output.id)}>자막 편집</button>
      </div>
      {!output.captionRevisionOf ? <button className="link-button result-open-edit" disabled={busy} onClick={() => onOpenEdit(output.id)}>이 버전 개별 편집</button> : null}
    </div>
  </section>;
}
