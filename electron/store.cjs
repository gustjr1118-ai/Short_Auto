const fs = require('node:fs');
const path = require('node:path');
const { PRESETS, clone, fail, normalizePreset } = require('./domain.cjs');
const DEFAULTS = { outputDir: '', aiEngine: 'codex', cliPath: '', model: '', codexPath: '', codexModel: '', codexReasoning: '', transcriptionEngine: 'whisper', preferYouTubeCC: false, whisperPath: '', whisperModelPath: '', transcriptionLanguage: 'auto', transcribeModel: 'whisper-1', ttsPythonPath: '', ttsModelPath: '', ffmpegPath: '', ffprobePath: '', ytdlpPath: '', apiKeyEnc: '' };
class Store {
  static async open(root) {
    fs.mkdirSync(root, { recursive: true });
    const initSqlJs = require('sql.js');
    const SQL = await initSqlJs({ locateFile: f => path.join(path.dirname(require.resolve('sql.js/dist/sql-wasm.js')), f) });
    const file = path.join(root, 'studio.sqlite');
    const db = new SQL.Database(fs.existsSync(file) ? fs.readFileSync(file) : undefined);
    db.run('CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id)); PRAGMA user_version=1;');
    const store = new Store(root, db, file);
    for (const project of store.list('project')) {
      if (['queued', 'running'].includes(project.job?.state)) {
        project.job.state = 'interrupted'; project.job.message = '앱이 종료되어 작업이 중단되었습니다. 다시 시도할 수 있습니다.';
        for (const clip of project.batch?.clips || []) if (clip.status === 'running') clip.status = 'interrupted';
        store.put('project', project.id, project);
      }
    }
    store.flush(); return store;
  }
  constructor(root, db, file) { this.root = root; this.db = db; this.file = file; }
  get(kind, id) {
    const s = this.db.prepare('SELECT body FROM records WHERE kind=? AND id=?');
    try { s.bind([kind, id]); return s.step() ? JSON.parse(s.getAsObject().body) : null; } finally { s.free(); }
  }
  list(kind) {
    const s = this.db.prepare('SELECT body FROM records WHERE kind=?'); const rows = [];
    try { s.bind([kind]); while (s.step()) rows.push(JSON.parse(s.getAsObject().body)); } finally { s.free(); }
    return rows.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  }
  put(kind, id, body) {
    this.db.run('INSERT OR REPLACE INTO records(kind,id,body) VALUES (?,?,?)', [kind, id, JSON.stringify(body)]); this.flush(); return clone(body);
  }
  delete(kind, id) { this.db.run('DELETE FROM records WHERE kind=? AND id=?', [kind, id]); this.flush(); }
  flush() { const tmp = this.file + '.tmp'; fs.writeFileSync(tmp, Buffer.from(this.db.export())); fs.renameSync(tmp, this.file); }
  project(id) { const p = this.get('project', id); if (!p) throw fail('프로젝트를 찾을 수 없습니다.', 'NOT_FOUND'); return p; }
  update(id, mutate) { const p = this.project(id); mutate(p); p.updatedAt = new Date().toISOString(); return this.put('project', id, p); }
  settings() {
    const saved = this.get('settings', 'default');
    const transcriptionEngine = saved?.transcriptionEngine || (saved?.apiKeyEnc ? 'api' : 'whisper');
    const legacyCodex = saved?.aiEngine === 'codex' ? saved : {};
    return { ...DEFAULTS, codexPath: legacyCodex.cliPath || '', codexModel: legacyCodex.model || '', ...saved, transcriptionEngine };
  }
  presets() { return [...clone(PRESETS), ...this.list('preset').map(p => ({ ...p, ...normalizePreset(p) }))]; }
  close() { this.flush(); this.db.close(); }
}
module.exports = { Store, DEFAULTS };
