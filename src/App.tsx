import { useEffect, useRef, useState } from 'react';
import { Bootstrap, Preset, Project, Settings, busy, stateLabel, time, unwrap } from './types';
import { Icon } from './components/Icon';
import { PresetsPage } from './components/Presets';
import { SettingsModal } from './components/Settings';
import { Workspace } from './components/Workspace';
import type { WorkTarget, WorkspaceHandle } from './components/Workspace';
import { CodexPanel } from './components/CodexPanel';
import { WorkTray } from './components/WorkTray';

type Page = 'studio' | 'presets' | 'jobs';

export default function App() {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [page, setPage] = useState<Page>('studio');
  const [settingsTab, setSettingsTab] = useState<'general' | 'ai' | null>(null);
  const [compact, setCompact] = useState(false);
  const [workTarget, setWorkTarget] = useState<WorkTarget | null>(null);
  const [search, setSearch] = useState('');
  const [url, setUrl] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');
  const [pending, setPending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const workspace = useRef<WorkspaceHandle>(null);
  const report = (error: unknown) => setError(error instanceof Error ? error.message : String(error));
  const update = (p: Project) => setData(current => current ? ({
    ...current, projects: [p, ...current.projects.filter(item => item.id !== p.id)].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  }) : current);

  useEffect(() => {
    let alive = true;
    if (!window.studio) { setError('Start.cmd 또는 배포 실행 파일로 열어 주세요.'); return; }
    unwrap(window.studio.bootstrap()).then(value => { if (alive) setData(value); }).catch(report);
    const cleanup = window.studio.onProject(project => { if (alive) update(project); });
    return () => { alive = false; cleanup(); };
  }, []);

  const active = data?.projects.find(p => p.id === activeId);
  const running = data?.projects.filter(busy).length || 0;
  const projects = data?.projects.filter(project => project.title.toLowerCase().includes(search.trim().toLowerCase())) || [];
  const onPresets = (presets: Preset[]) => setData(current => current ? { ...current, presets } : current);
  const savedSettings = (settings: Settings) => setData(current => current ? { ...current, settings } : current);
  const navigate = (next: () => void) => {
    if (workspace.current) workspace.current.beforeLeave(next);
    else next();
  };
  const setProject = (id: string | null) => { setActiveId(id); setPage('studio'); setError(''); };
  const openProjectId = (id: string) => {
    if (page === 'studio' && activeId === id) return;
    navigate(() => setProject(id));
  };
  const select = (p: Project) => { update(p); setProject(p.id); };
  const openWork = (project: Project, target: 'work' | 'result') => navigate(() => {
    setProject(project.id);
    setWorkTarget({ projectId: project.id, target, clipId: project.job?.clipId, stamp: Date.now() });
  });
  const retryWork = (project: Project) => {
    const options = project.job?.runOptions;
    if (options?.action === 'batch-render') {
      const available = project.batch?.clips.filter(c => (!c.outputId || c.needsRender) &&
        (!options.clipIds || options.clipIds.includes(c.id))) || [];
      if (!available.length) return;
      unwrap(window.studio.run(project.id, { ...options, clipIds: available.map(c=>c.id) })).then(update).catch(report);
    } else if (options) unwrap(window.studio.run(project.id, options)).then(update).catch(report);
    else if (project.job?.code === 'WHISPER_SETUP') unwrap(window.studio.run(project.id, { action: 'transcribe' })).then(update).catch(report);
  };
  const workTray = <WorkTray projects={data?.projects || []} compact={compact} onOpen={openWork}
    onCancel={p=>unwrap(window.studio.cancel(p.id)).then(update).catch(report)} onRetry={retryWork}/>;

  const create = async (kind: 'file' | 'url', file?: File) => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      let project = await unwrap(kind === 'file' ? window.studio.importFile(file) : window.studio.importUrl(url));
      if (!project) return;
      if (selectedPreset && selectedPreset !== project.preset.id && data?.presets.some(p => p.id === selectedPreset)) {
        project = await unwrap(window.studio.applyPreset(project.id, selectedPreset));
      }
      select(project);
      setUrl('');
      if (kind === 'url' && !project.source.path) update(await unwrap(window.studio.run(project.id, { action: 'prepare' })));
    } catch (error) { report(error); }
    finally { setPending(false); }
  };
  const applyFromLibrary = async (preset: Preset) => {
    setSelectedPreset(preset.id);
    if (!active) { setProject(null); return; }
    try { select(await unwrap(window.studio.applyPreset(active.id, preset.id))); }
    catch (error) { report(error); }
  };

  return <div className="app-shell redesigned-app">
    <header className="titlebar">
      <button className="project-sidebar-toggle" aria-label={compact ? '프로젝트 목록 펼치기' : '프로젝트 목록 접기'}
        aria-controls="project-sidebar" aria-expanded={!compact} onClick={() => setCompact(value => !value)}><Icon name="sidebar" size={16}/></button>
      <div className="titlebar-brand"><span className="logo-mark"><Icon name="film" size={13}/></span><strong>Shorts Studio <span>bySom</span></strong></div>
      <div className="titlebar-spacer"/>
      {data ? <CodexPanel exe={data.settings.codexPath} projectId={active?.id} projects={data.projects} openSettings={()=>setSettingsTab('ai')}/> : null}
      <div className="window-controls">
        <button aria-label="최소화" onClick={() => window.studio?.window('minimize')}>─</button>
        <button aria-label="최대화" onClick={() => window.studio?.window('maximize')}>□</button>
        <button aria-label="앱 닫기" onClick={() => navigate(() => { void window.studio?.window('close'); })}>×</button>
      </div>
    </header>

    <div className="app-body">
      {!compact ? <aside className="sidebar redesigned-sidebar" id="project-sidebar">
        <button className="new-project" onClick={() => navigate(() => setProject(null))}><Icon name="plus" size={17}/>새 쇼츠 만들기</button>
        <nav className="main-nav" aria-label="주 메뉴">
          <button aria-current={page === 'studio'} className={page === 'studio' ? 'active' : ''} onClick={() => { if (page !== 'studio') setPage('studio'); }}><Icon name="film" size={17}/>제작 스튜디오</button>
          <button aria-current={page === 'presets'} className={page === 'presets' ? 'active' : ''} onClick={() => { if (page !== 'presets') navigate(() => setPage('presets')); }}><Icon name="sliders" size={17}/>프리셋 보관함</button>
          <button aria-current={page === 'jobs'} className={page === 'jobs' ? 'active' : ''} onClick={() => { if (page !== 'jobs') navigate(() => setPage('jobs')); }}><Icon name="clock" size={17}/>작업 목록{running ? <span className="queue-count">{running}</span> : null}</button>
        </nav>
        <div className="sidebar-divider"/>
        <div className="section-label">프로젝트<span>{data?.projects.length || 0}</span></div>
        <div className="sidebar-search"><Icon name="search" size={14}/><input aria-label="프로젝트 검색" placeholder="프로젝트 검색" value={search} onChange={e => setSearch(e.currentTarget.value)}/></div>
        <div className="project-list">
          {projects.map(project => <button className={`project-list-item ${activeId === project.id && page === 'studio' ? 'active' : ''}`} key={project.id}
            aria-current={activeId === project.id && page === 'studio'} onClick={() => openProjectId(project.id)}>
            <span className="project-mini">{project.source.thumbnailUrl ? <img src={project.source.thumbnailUrl} alt=""/> : <Icon name="film" size={15}/>}</span>
            <span className="project-list-text"><strong>{project.title}</strong><small>{project.preset.name} · {stateLabel(project.job?.state)}</small></span>
            {busy(project) ? <span className="tiny-dot working"/> : null}
          </button>)}
          {!projects.length ? <div className="sidebar-empty">{search ? '검색 결과가 없습니다.' : '첫 영상을 가져오면 프로젝트가 여기에 표시됩니다.'}</div> : null}
        </div>
        {workTray}
        <div className="sidebar-bottom"><button onClick={() => setSettingsTab('general')}><Icon name="settings" size={16}/>설정 및 연결<span>v{data?.version || '0.4'}</span></button></div>
      </aside> : <nav className="collapsed-sidebar" aria-label="빠른 메뉴" id="project-sidebar">
        <button className="icon-btn" aria-label="새 쇼츠 만들기" title="새 쇼츠 만들기" onClick={() => navigate(() => setProject(null))}><Icon name="plus"/></button>
        {workTray}
        <button className="icon-btn" aria-label="설정 및 연결" title="설정 및 연결" onClick={() => setSettingsTab('general')}><Icon name="settings"/></button>
      </nav>}

      <div className="app-content">
        {!data ? <div className="loading-screen"><span className="spinner"/>작업실을 준비하고 있습니다…</div> :
          page === 'presets' ? <PresetsPage presets={data.presets} onChange={onPresets} onApply={applyFromLibrary} report={report}/> :
          page === 'jobs' ? <main className="page-scroll redesigned-jobs">
            <div className="page-heading"><div><h1>작업 목록</h1><p>프로젝트별 제작 상태를 확인하세요.</p></div>{running ? <span className="chip">{running}개 작업 중</span> : null}</div>
            <div className="jobs-table"><div className="jobs-table-head"><span>프로젝트</span><span>상태</span><span>진행 상황</span><span>작업</span></div>
              {data.projects.filter(p => p.job).map(project => <div className="jobs-table-row" key={project.id}>
                <button className="link-button" onClick={() => openProjectId(project.id)}>{project.title}</button>
                <span className={`status-chip state-${project.job?.state}`}>{stateLabel(project.job?.state)}</span><span>{project.job?.message.split('\n')[0]}</span>
                {busy(project) ? <button className="btn small" onClick={() => unwrap(window.studio.cancel(project.id)).then(update).catch(report)}>취소</button>
                  : <button className="btn small" onClick={() => openProjectId(project.id)}>열기</button>}
              </div>)}
              {!data.projects.some(p => p.job) ? <div className="large-empty"><Icon name="clock" size={30}/><p>아직 시작한 제작 작업이 없습니다.</p></div> : null}
            </div>
          </main> : active ?
            <Workspace key={active.id} ref={workspace} project={active} presets={data.presets} settings={data.settings} update={update}
              openProject={select} onPresets={onPresets} workTarget={workTarget} openSettings={() => setSettingsTab('ai')} report={report}/> :
            <main className="home-scroll redesigned-home">
              <header><h1>새 쇼츠 만들기</h1><p>원본을 가져온 뒤 프리셋과 제작 방식을 선택하세요.</p></header>
              <section className="create-panel">
                <h2>원본 영상 가져오기</h2>
                <form className="url-input" onSubmit={e => { e.preventDefault(); if (url.trim()) void create('url'); }}>
                  <Icon name="link" size={19}/><input aria-label="유튜브 영상 링크" placeholder="유튜브 영상 링크" value={url} disabled={pending} onChange={e => setUrl(e.currentTarget.value)}/>
                  <button type="submit" className="btn primary" disabled={pending || !url.trim()}>{pending ? '준비 중…' : '링크 열기'}</button>
                </form>
                <button className={`drop-zone ${dragging ? 'dragging' : ''}`} disabled={pending} onClick={() => create('file')}
                  onDragOver={e => { e.preventDefault(); if (!pending) setDragging(true); }} onDragLeave={() => setDragging(false)}
                  onDrop={e => { e.preventDefault(); setDragging(false); if (e.dataTransfer.files[0]) void create('file', e.dataTransfer.files[0]); }}>
                  <span className="drop-icon"><Icon name="upload" size={21}/></span><span><strong>파일 선택 또는 끌어 놓기</strong><small>MP4 · MOV · MKV · WebM · 최대 30분, 2GB</small></span>
                </button>
                {selectedPreset ? <p className="hint">선택한 프리셋 · {data.presets.find(p => p.id === selectedPreset)?.name || '기본 프리셋'}</p> : null}
              </section>
              {data.projects.length ? <section className="recent-projects" aria-label="최근 프로젝트"><h2>최근 프로젝트</h2>
                <div>{data.projects.slice(0, 6).map(p => <button className="recent-project" key={p.id} onClick={() => openProjectId(p.id)}>
                  <span className="recent-thumb">{p.source.thumbnailUrl ? <img src={p.source.thumbnailUrl} alt=""/> : <Icon name="film" size={22}/>}</span>
                  <span><strong>{p.title}</strong><small>{p.source.duration ? time(p.source.duration) + ' · ' : ''}{stateLabel(p.job?.state)}</small></span>
                </button>)}</div>
              </section> : null}
            </main>}
      </div>
    </div>
    {settingsTab && data ? <SettingsModal settings={data.settings} initialTab={settingsTab} onClose={() => setSettingsTab(null)} onSaved={savedSettings} report={report}/> : null}
    {error ? <div className="toast error" role="alert"><span>{error}</span><button className="icon-btn" aria-label="오류 알림 닫기" onClick={() => setError('')}><Icon name="close" size={16}/></button></div> : null}
  </div>;
}
