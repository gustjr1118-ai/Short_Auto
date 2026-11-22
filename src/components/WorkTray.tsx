import { useState } from 'react';
import { Job, Project, busy, stateLabel } from '../types';
import { Icon } from './Icon';

type JobRow = { project: Project; job: NonNullable<Project['job']>; queue: number };
const stageLabels: Record<string, string> = { prepare: '작업 준비', source: '원본 준비', frames: '대표 장면 추출', analysis: 'Codex 분석', transcribe: '자막 처리', render: '영상 합성', verify: '출력 검증' };
const stamp = (value?: string) => value ? new Date(value).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';
const failed = (job: Job) => ['failed', 'interrupted', 'cancelled'].includes(job.state);

export function WorkTray({ projects, compact, onOpen, onCancel, onRetry }: {
  projects: Project[]; compact?: boolean; onOpen: (p: Project, target: 'work'|'result') => void;
  onCancel: (p: Project) => void; onRetry: (p: Project) => void;
}) {
  const [expanded, setExpanded] = useState<boolean | null>(null);
  const active = projects.filter(busy).length;
  const show = expanded ?? !compact;
  const queued = projects.filter(p => p.job?.state === 'queued').sort((a, b) => (a.job?.createdAt || '').localeCompare(b.job?.createdAt || ''));
  const inProgress = projects.filter(p => p.job?.state === 'running' || p.job?.state === 'needs_input');
  const terminal = projects.filter(p => p.job && !busy(p) && p.job.state !== 'needs_input');
  const rows: JobRow[] = [...inProgress, ...queued, ...terminal.slice(0, 5)].map(project =>
    ({ project, job: project.job!, queue: queued.indexOf(project) + 1 }));
  const recent = projects.flatMap(project => (project.recentJobs || []).map(job => ({ project, job })))
    .sort((a, b) => (b.job.endedAt || b.job.createdAt || '').localeCompare(a.job.endedAt || a.job.createdAt || '')).slice(0, 6);

  return <section className={`work-tray ${compact ? 'compact-tray' : ''}`} aria-label="실시간 작업 현황">
    <button className="work-tray-toggle" aria-expanded={show} title="작업 현황" aria-label={`작업 현황 ${active}개 작업 중`}
      onClick={() => setExpanded(!show)}><Icon name="clock" size={16}/>{!compact ? <span>작업 현황</span> : null}<b>{active}</b></button>
    {show ? <div className="work-tray-body">
      {!rows.length ? <p className="hint">아직 시작한 작업이 없습니다.</p> : null}
      {rows.map(({ project, job, queue }) => {
        const clip = project.batch?.clips.find(item => item.id === job.clipId);
        return <article className={`work-tray-row work-${job.state}`} key={job.id}>
          <button className="link-button work-project" title={project.title} onClick={() => onOpen(project, 'work')}>{project.title}</button>
          <div className="work-row-meta"><strong>{queue ? `대기 ${queue}번째` : job.state === 'needs_input' && job.stage === 'edit' ? '편집 대기' : stateLabel(job.state)}</strong><small>{busy(project) ? stageLabels[job.stage] || job.stage : stamp(job.endedAt)}</small></div>
          {clip ? <p className="hint">{clip.title}</p> : null}
          <p className="work-message">{job.message.split('\n')[0]}</p>
          {job.state === 'running' && job.progress !== null ? <progress aria-label="현재 작업 진행률" max={100} value={job.progress}/> : null}
          <div className="inline-actions">
            {busy(project) ? <button className="link-button" onClick={() => onCancel(project)}>취소</button> : null}
            {failed(job) && (job.runOptions || job.code === 'WHISPER_SETUP') ? <button className="link-button" onClick={() => onRetry(project)}>다시 시도</button> : null}
            {project.outputs.length ? <button className="link-button" onClick={() => onOpen(project, 'result')}>결과 보기</button> : null}
          </div>
          {job.trace?.length ? <details><summary>진행 기록</summary><ol>
            {job.trace.map((line, index) => <li key={line.at + index}><time>{stamp(line.at)}</time>{line.message}</li>)}
          </ol></details> : null}
        </article>;
      })}
      {recent.length ? <details className="work-history"><summary>최근 작업 기록</summary>
        {recent.map(({ project, job }) => <p key={job.id}><strong>{project.title} · {stateLabel(job.state)}</strong><small>{stamp(job.endedAt)} {job.message.split('\n')[0]}</small></p>)}
      </details> : null}
    </div> : null}
  </section>;
}
