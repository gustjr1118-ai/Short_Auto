const path = require('node:path');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { clone, contained, fail } = require('./domain.cjs');
const { saveClipDraft } = require('./batch.cjs');
function appendJobEvent(job, message = job.message) {
  const line = { at: new Date().toISOString(), stage: job.stage, state: job.state, message: String(message).split('\n')[0].slice(0, 220), clipId: job.clipId };
  if (job.trace?.at(-1)?.message === line.message && job.trace.at(-1)?.state === line.state) return;
  job.trace = [...(job.trace || []), line].slice(-30);
}
class Jobs {
  constructor(store, createWorker, settings, broadcast, telemetry) { Object.assign(this, { store, createWorker, settings, broadcast, telemetry }); this.queue = []; this.active = null; }
  enqueue(id, options = {}) {
    const project = this.store.project(id);
    if (['queued', 'running'].includes(project.job?.state)) throw fail('이 프로젝트는 이미 작업 중입니다.', 'BUSY');
    const job = { id: randomUUID(), state: 'queued', stage: 'prepare', message: '작업 순서를 기다리고 있습니다.', progress: null, revision: project.revision, createdAt: new Date().toISOString() };
    if (options.action !== 'edit') job.runOptions = clone(options);
    job.clipId = options.clipId;
    job.action = options.action || 'render';
    appendJobEvent(job);
    this.store.update(id, p => {
      if (p.job) p.recentJobs = [...(p.recentJobs || []), {
        id: p.job.id, state: p.job.state, message: p.job.message, createdAt: p.job.createdAt, endedAt: p.job.endedAt,
      }].slice(-8);
      p.job = job;
    });
    if (project.job?.clipPreview?.path) {
      try { fs.unlinkSync(contained(project.directory, project.job.clipPreview.path)); } catch { /* The old preview may already be gone. */ }
    }
    const settings = Promise.resolve().then(() => this.settings(options)).then(config => ({ config }), error => ({ error }));
    this.queue.push({ projectId: id, jobId: job.id, options, settings }); this.emit(id); this.next(); return this.store.project(id);
  }
  emit(id) { this.broadcast(this.store.project(id)); }
  async next() {
    if (this.active || !this.queue.length) return;
    const item = this.queue.shift();
    const project = this.store.project(item.projectId);
    if (project.job?.id !== item.jobId || project.job.state !== 'queued') { this.next(); return; }
    const child = this.createWorker();
    const active = { ...item, child, finishing: false, cancelled: false, timer: null }; this.active = active;
    this.store.update(project.id, p => { p.job.state = 'running'; p.job.message = '작업을 준비하고 있습니다.'; appendJobEvent(p.job); }); this.emit(project.id);
    const finish = (state, message, result, code) => {
      if (active.finishing) return; active.finishing = true; clearTimeout(active.timer);
      this.store.update(project.id, p => {
        if (p.job?.id !== item.jobId) return;
        if (result && !active.cancelled) {
          if (result.edit && p.revision === project.revision) p.edit = result.edit;
          if (result.clipEdit) saveClipDraft(p, result.clipId, result.clipEdit);
          if (result.candidates) p.candidates = result.candidates;
          if (result.output) p.outputs.push(result.output);
          if (['edit', 'caption-script'].includes(result.action)) {
            p.undo.push(clone(project.edit)); p.undo = p.undo.slice(-20); p.revision++;
            if (result.action === 'edit') p.messages.push({ role: 'assistant', text: result.summary, at: new Date().toISOString() });
          }
        }
        p.job = { ...p.job, state: active.cancelled ? 'cancelled' : state, message: active.cancelled ? '작업을 취소했습니다.' : message, code, progress: state === 'completed' ? 100 : p.job.progress, endedAt: new Date().toISOString() };
        if (result?.clipPreview && !active.cancelled) p.job.clipPreview = result.clipPreview;
        if (['review', 'batch-review'].includes(result?.action)) p.job.state = 'needs_input';
        appendJobEvent(p.job);
        for (const clip of p.batch?.clips || []) if (clip.status === 'running') clip.status = 'interrupted';
      });
      this.telemetry?.clear(item.jobId);
      this.emit(project.id); child.kill(); this.active = null; this.next();
    };
    child.on('message', event => {
      if (active.finishing) return;
      const msg = event?.data && !event.type ? event.data : event;
      if (msg.type === 'codex') {
        this.telemetry?.record(project.id, item.jobId, msg.event);
      } else if (msg.type === 'progress') {
        const current = this.store.project(project.id).job;
        if (current?.id !== item.jobId || active.cancelled) return;
        if (current.stage === msg.stage && current.message === msg.message && current.progress !== null && msg.progress !== null &&
          Math.abs(current.progress - msg.progress) < 1 && msg.progress !== 100) return;
        this.store.update(project.id, p => {
          Object.assign(p.job, { stage: msg.stage, message: msg.message, progress: msg.progress });
          appendJobEvent(p.job);
        });
        this.emit(project.id);
      } else if (msg.type === 'source' || msg.type === 'edit') {
        this.store.update(project.id, p => { if (msg.source) p.source = msg.source; if (msg.edit && p.revision === project.revision) p.edit = msg.edit; if (msg.candidates) p.candidates = msg.candidates; }); this.emit(project.id);
      } else if (msg.type === 'batch' || msg.type === 'batch-clip') {
        if (active.cancelled) return;
        this.store.update(project.id, p => {
          if (p.job?.id !== item.jobId) return;
          if (msg.type === 'batch') { if (p.batch) p.previousBatch = p.batch; p.batch = msg.batch; return; }
          const clip = p.batch?.clips.find(c => c.id === msg.id);
          if (!clip) return;
          clip.status = msg.status;
          if (msg.edit) { clip.edit = msg.edit; clip.start = msg.start; clip.end = msg.end; }
          if (msg.error !== undefined) clip.error = msg.error;
          if (msg.status === 'running') p.job.clipId = clip.id;
          if (msg.status === 'running' || msg.status === 'failed' || msg.output) {
            appendJobEvent(p.job, clip.title + ' · ' + (msg.output ? '완료' : msg.status === 'failed' ? '실패' : '제작 시작'));
          }
          if (msg.output) { clip.outputId = msg.output.id; clip.needsRender = false; p.outputs.push(msg.output); }
        });
        this.emit(project.id);
      } else if (msg.type === 'result') {
        const result = msg.result;
        const messages = { prepare: '원본 영상이 준비되었습니다.', review: '추천 구간을 확인한 뒤 제작해 주세요.', edit: '편집을 반영했습니다. 다시 제작하면 MP4에 적용됩니다.', transcribe: '자막 전사가 완료되었습니다.', 'caption-script': '자막 문구를 반영했습니다. 다시 제작하면 MP4에 적용됩니다.' };
        finish(result.partial ? 'failed' : 'completed', messages[result.action] || result.summary || '쇼츠 제작이 완료되었습니다.', result);
      }
      else if (msg.type === 'error') finish(msg.code === 'CANCELLED' ? 'cancelled' : 'failed', msg.message, null, msg.code);
    });
    child.on('exit', () => finish('failed', '작업 프로세스가 중단되었습니다. 다시 시도해 주세요.', null, 'WORKER_EXIT'));
    child.on('error', e => finish('failed', e.message, null, 'WORKER_START'));
    try {
      const { config, error } = await item.settings;
      if (active.finishing) return;
      if (active.cancelled) { finish('cancelled', '작업을 취소했습니다.'); return; }
      if (error) throw error;
      fs.mkdirSync(project.directory, { recursive: true });
      child.postMessage({ type: 'start', project, dir: project.directory, settings: config, ...item.options });
    } catch (e) { finish('failed', e.message, null, e.code); }
  }
  cancel(id) {
    if (this.active?.projectId === id) {
      const active = this.active; active.cancelled = true; active.child.postMessage({ type: 'cancel' });
      this.store.update(id, p => { p.job.message = '하위 작업을 취소하고 있습니다.'; }); this.emit(id);
      active.timer = setTimeout(() => active.child.kill(), 4000);
    } else {
      this.queue = this.queue.filter(q => q.projectId !== id);
      this.store.update(id, p => { if (p.job?.state === 'queued') { p.job.state = 'cancelled'; p.job.message = '대기 작업을 취소했습니다.'; p.job.endedAt = new Date().toISOString(); appendJobEvent(p.job); } }); this.emit(id);
    }
    return this.store.project(id);
  }
  busy(id) { return ['running', 'queued'].includes(this.store.project(id).job?.state); }
  shutdown() {
    this.queue = [];
    if (this.active) { this.active.child.postMessage({ type: 'cancel' }); this.active.child.kill(); }
  }
}
module.exports = { Jobs };
