import { useCallback, useEffect, useState } from 'react';
import { CodexAccount, CodexActivity, CodexUsage, Project, unwrap } from '../types';
import { Icon } from './Icon';

const labels: Record<CodexAccount['state'], string> = {
  connected: 'Codex 연결됨', missing: 'Codex CLI 연결 필요', login: 'Codex 로그인 필요',
  offline: 'Codex 연결 확인 불가', unsupported: 'Codex 버전 확인 필요', unavailable: 'Codex 잔여량 확인 불가',
};
const metrics = [
  ['total', '총 토큰', '#bf89ff'], ['input', '입력', '#5adafa'], ['output', '출력', '#65e9b9'],
  ['cached', '캐시 입력', '#ebce6d'], ['reasoning', '추론', '#f391b8'],
] as const;
const format = (n: number) => n.toLocaleString('ko-KR');
const date = (n: number) => new Intl.DateTimeFormat('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(n);
function period(minutes: number | null) {
  if (minutes === null) return '기간 정보 없음';
  if (minutes % 1440 === 0) return minutes / 1440 + '일';
  if (minutes % 60 === 0) return minutes / 60 + '시간';
  return minutes + '분';
}
function metric(usage: CodexUsage, key: typeof metrics[number][0]) {
  return key === 'total' ? usage.input + usage.output : usage[key];
}

function Trend({ values, color, label }: { values: (number | null)[]; color: string; label: string }) {
  const measured = values.some(value => value !== null);
  const max = Math.max(1, ...values.map(n => n ?? 0));
  const points = values.map((n, i) => [i * 9.6, 40 - (n ?? 0) / max * 36].join(',')).join(' ');
  const peak = Math.max(...values.map(n => n ?? 0));
  return <div className="codex-trend">
    <div className="row-between" style={{ color }}><span>{label}</span>{measured ? <small>최대 {format(peak)}/분</small> : null}</div>
    <div className="trend-plot">
      {measured ? <svg viewBox="0 0 280 44" preserveAspectRatio="none" role="img" aria-label={label + ' 분당 사용량'}>
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
      </svg> : <span>측정 기록 없음</span>}
    </div>
  </div>;
}

export function CodexPanel({ openSettings, exe, projectId, projects }: {
  openSettings: () => void; exe: string; projectId?: string; projects: Project[];
}) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<CodexAccount | null>(null);
  const [loading, setLoading] = useState(true);
  const [activity, setActivity] = useState<CodexActivity>({ active: 0, rows: [] });
  const [model, setModel] = useState('');
  const [onlyProject, setOnlyProject] = useState(false);
  const [now, setNow] = useState(Date.now);
  const refresh = useCallback(async () => {
    setLoading(true);
    try { setAccount(await unwrap(window.studio.codexAccount())); }
    catch { setAccount({ state: 'offline', checkedAt: Date.now(), windows: [] }); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, exe]);
  useEffect(() => {
    const unsubscribe = window.studio.onCodexActivity(next => { setActivity(next); setNow(Date.now()); });
    void unwrap(window.studio.codexActivity()).then(setActivity).catch(() => {});
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!open) return;
    const clock = setInterval(() => setNow(Date.now()), 15000);
    const refreshTimer = setInterval(() => void refresh(), 120000);
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', keydown);
    return () => { clearInterval(clock); clearInterval(refreshTimer); window.removeEventListener('keydown', keydown); };
  }, [open, refresh]);

  const quota = account?.windows || [];
  const limited = account?.state === 'connected' && quota.some(row => row.id === 'codex' && row.remaining === 0);
  const text = activity.active ? 'Codex 작업 중' : loading ? 'Codex 연결 중' : limited ? 'Codex 한도 도달' : account ? labels[account.state] : 'Codex 상태';
  const light = activity.active || account?.state === 'connected' || !!account?.mode;
  const minute = Math.floor(now / 60000);
  const recent = activity.rows.filter(row => Math.floor(row.at / 60000) >= minute - 29 && (!onlyProject || !projectId || row.projectId === projectId));
  const models = [...new Set(recent.map(row => row.model).filter(Boolean))];
  const rows = recent.filter(row => !model || row.model === model);
  const measured = rows.filter(row => row.usage);
  const series = (key: typeof metrics[number][0]) => Array.from({ length: 30 }, (_, i) => {
    const values = measured.filter(row => Math.floor(row.at / 60000) === minute - 29 + i)
      .map(row => metric(row.usage!, key)).filter((n): n is number => n !== null);
    return values.length ? values.reduce((sum, n) => sum + n, 0) : null;
  });
  const total = (key: typeof metrics[number][0]) => {
    const values = measured.map(row => metric(row.usage!, key)).filter((n): n is number => n !== null);
    return values.length ? format(values.reduce((sum, n) => sum + n, 0)) : '—';
  };
  const byProject = new Map<string, typeof rows>();
  for (const row of rows) {
    const group = byProject.get(row.projectId) || [];
    group.push(row);
    byProject.set(row.projectId, group);
  }
  const summary = (group: typeof rows) => {
    const counts = group.flatMap(row => row.usage ? [row.usage.input + row.usage.output] : []);
    const sum = counts.reduce((value, count) => value + count, 0);
    return `${counts.length ? format(sum) + ' 토큰' : '집계 없음'} · ${group.length}회`;
  };

  return <div className="codex-status-control">
    <button className={`codex-status-button ${light ? 'lit' : ''} ${activity.active || loading ? 'checking' : ''}`}
      aria-expanded={open} aria-controls="codex-status-panel" onClick={() => { setOpen(value => !value); setNow(Date.now()); }}>
      <Icon name="codex" size={15}/><span className="codex-lamp"/>{text}
    </button>
    {open ? <aside id="codex-status-panel" className="codex-panel" aria-label="Codex 연결 및 사용량">
      <header className="row-between"><h2>Codex 상태</h2><button className="icon-btn" aria-label="Codex 상태 닫기" onClick={() => setOpen(false)}><Icon name="close" size={15}/></button></header>
      <section className="codex-panel-section">
        <h3>Codex 계정 잔여량</h3>
        {quota.map(row => <article key={row.id + row.period} className="codex-quota">
          <div className="row-between"><span>{row.id === 'codex' ? period(row.minutes) : row.name + ' · ' + period(row.minutes)}</span><strong>{format(Math.round(row.remaining * 10) / 10)}% 남음</strong></div>
          <progress max={100} value={row.remaining} aria-label={row.name + ' ' + period(row.minutes) + ' 잔여량'}/>
          <small>{row.resetsAt === null ? '초기화 정보 없음' : '초기화 ' + date(row.resetsAt * 1000)}</small>
        </article>)}
        {quota.length && ![300, 10080].every(minutes => quota.some(row => row.minutes === minutes)) ? <p className="hint">계정에서 제공하는 기간만 표시합니다.</p> : null}
        {!quota.length ? <p className="hint">{loading ? '계정 잔여량을 확인하고 있습니다.' : '조회된 잔여량이 없습니다.'}</p> : null}
        {account ? <p className="hint">{account.lastSuccess ? '마지막 확인값 · ' + date(account.lastSuccess) : '최근 조회 · ' + date(account.checkedAt)} · 계정 전체 기준</p> : null}
        <div className="inline-actions"><button className="btn small" disabled={loading} onClick={refresh}>잔여량 새로고침</button>
          <button className="link-button" onClick={() => { setOpen(false); openSettings(); }}>연결 설정</button></div>
      </section>
      <section className="codex-panel-section">
        <div className="row-between"><h3>이 앱의 토큰 사용량</h3><small>최근 30분</small></div>
        <select aria-label="토큰 사용량 모델" value={model} onChange={e => setModel(e.target.value)}>
          <option value="">모든 모델</option>{model && !models.includes(model) ? <option value={model}>{model}</option> : null}
          {models.map(name => <option value={name} key={name}>{name}</option>)}
        </select>
        {projectId ? <label className="check-label"><input type="checkbox" checked={onlyProject} onChange={e => setOnlyProject(e.target.checked)}/>현재 프로젝트만</label> : null}
        {metrics.map(([key, label, color]) => <Trend key={key} label={label} color={color} values={series(key)}/>)}
        <div className="row-between hint"><span>30분 전</span><span>현재</span></div>
        <details className="codex-detail"><summary>상세 정보{measured.length < rows.length ? ' · 일부 기록' : ''}</summary>
          <p>총 {total('total')} 토큰 · 요청 {rows.length}회 · 집계 {measured.length}회</p>
          <p>입력 {total('input')} · 출력 {total('output')}</p><p>캐시 입력 {total('cached')} · 추론 {total('reasoning')}</p>
          <p>{rows.length ? '최근 집계 ' + date(rows.at(-1)!.at) : '측정 기록 없음'}</p>
          {account ? <p>잔여량 조회 {date(account.checkedAt)}</p> : null}
          {[...byProject.entries()].reverse().map(([id, group]) => {
            const project = projects.find(item => item.id === id);
            const jobIds = [...new Set(group.map(row => row.jobId))].reverse();
            return <div className="codex-project-detail" key={id}>
              <strong>{project?.title || '보관된 프로젝트'}</strong><small>{summary(group)}</small>
              {jobIds.map(jobId => {
                const job = project?.job?.id === jobId ? project.job : project?.recentJobs?.find(item => item.id === jobId);
                const clip = project?.batch?.clips.find(item => item.id === jobId);
                const task = job?.message.split('\n')[0] || (clip || project?.outputs.some(item => item.id === jobId) ? '자막 번역' : '작업 ' + jobId.slice(0, 6));
                const requests = group.filter(row => row.jobId === jobId);
                const jobModels = [...new Set(requests.map(row => row.model).filter(Boolean))];
                return <div key={jobId}><span title={task}>{task}</span><small>{jobModels.join(', ')} · {summary(requests)}</small></div>;
              })}
            </div>;
          })}
        </details>
      </section>
    </aside> : null}
  </div>;
}
