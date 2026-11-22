const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, utilityProcess, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { randomUUID } = require('node:crypto');
const { Store } = require('./store.cjs');
const { Jobs } = require('./jobs.cjs');
const { fail, clone, contained, bounded, makeProject, normalizeEdit, normalizePreset, parseSrt, youtubeUrl, withSampleCaption } = require('./domain.cjs');
const { importSource, toolPath } = require('./media.cjs');
const { detectCli, CODEX_EFFORTS, MODEL_ID } = require('./ai.cjs');
const { batchOptions, batchClip, clipEdit, saveClipDraft } = require('./batch.cjs');
const { CodexStatus } = require('./codex-status.cjs');
const { resolveWhisper } = require('./whisper.cjs');
const { run } = require('./process.cjs');
const { captionOutput, normalizeOutputCaptions, readCaptionFile, readOutputCaptions, translateInWorkspace } = require('./output-captions.cjs');

protocol.registerSchemesAsPrivileged([
  { scheme: 'studio', privileges: { standard: true, secure: true, supportFetchAPI: true } },
  { scheme: 'media', privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
]);
if (process.env.SHORTS_STUDIO_DATA) app.setPath('userData', path.resolve(process.env.SHORTS_STUDIO_DATA));
let store, jobs, win, codexStatus, closing = false;
const translations = new Map();
const root = path.join(__dirname, '..');
const isTest = process.env.SHORTS_STUDIO_SMOKE === '1';
const broadcast = project => { if (win && !win.isDestroyed()) win.webContents.send('studio:project', publicProject(project)); };
const publicBatch = (batch, id, previous = false) => {
  if (!batch) return undefined;
  const { transcript, ...details } = batch;
  return { ...details, clips: batch.clips.map(clip => ({ ...clip, thumbnailUrl: clip.thumbnail ? 'media://project/' + id + '/' + (previous ? 'previous-candidate' : 'candidate') + '/' + clip.id : undefined })) };
};
const publicProject = p => ({ ...p, batch: publicBatch(p.batch, p.id), previousBatch: publicBatch(p.previousBatch, p.id, true), edit: normalizeEdit(p.edit, p.source), source: p.source ? { ...p.source, mediaUrl: p.source.path ? `media://project/${p.id}/source` : '', thumbnailUrl: p.source.thumbnail ? `media://project/${p.id}/thumbnail` : '' } : null, outputs: p.outputs.map(o => ({ ...o, mediaUrl: `media://project/${p.id}/output/${o.id}` })),
  job: p.job?.clipPreview ? { ...p.job, clipPreview: { mediaUrl: `media://project/${p.id}/preview/${p.job.clipPreview.id}` } } : p.job,
});
const publicSettings = () => { const { apiKeyEnc, ...config } = store.settings(); return { ...config, apiKeyConfigured: !!apiKeyEnc }; };
async function workerSettings({ action } = {}) {
  const config = store.settings(); let apiKey = '';
  if (!['prepare', 'output-captions', 'clip-preview'].includes(action) && config.transcriptionEngine === 'api' && config.apiKeyEnc) {
    try { const buffer = Buffer.from(config.apiKeyEnc, 'base64'); apiKey = safeStorage.decryptStringAsync ? await safeStorage.decryptStringAsync(buffer) : safeStorage.decryptString(buffer); }
    catch { throw fail('전사 API 키를 복호화하지 못했습니다. 설정에서 다시 입력해 주세요.', 'KEY_REENTRY'); }
  }
  return { ...config, apiKey, apiKeyEnc: undefined };
}
function assertIdle(id) { if (jobs.busy(id)) throw fail('진행 중인 작업이 끝나거나 취소한 뒤 편집해 주세요.', 'BUSY'); }
function editProject(id, mutate) {
  assertIdle(id);
  const p = store.update(id, project => { project.undo.push(clone(project.edit)); project.undo = project.undo.slice(-20); mutate(project); project.revision++; }); broadcast(p); return publicProject(p);
}
function handle(name, fn) {
  ipcMain.handle(`studio:${name}`, async (event, data = {}) => {
    try {
      if (!win || event.sender !== win.webContents || !event.senderFrame?.url.startsWith('studio://ui/')) throw fail('허용되지 않은 요청입니다.', 'IPC_SENDER');
      const result = await fn(data || {}); return { ok: true, data: result };
    } catch (e) { console.error(`[${name}]`, e.code || 'ERROR', e.message); return { ok: false, error: { code: e.code || 'ERROR', message: e.message } }; }
  });
}
function updateBatch(id, mutate) {
  assertIdle(id);
  const project = store.update(id, p => {
    mutate(p);
    if (p.job?.state === 'needs_input' && p.batch && p.job.action === 'batch-analyze') {
      const confirmed = p.batch.clips.filter(clip => clip.confirmed).length;
      p.job.stage = confirmed ? 'edit' : 'analysis';
      p.job.message = confirmed
        ? confirmed + '/' + p.batch.clips.length + '편 구간 확정 · 편별 편집 후 제작할 수 있습니다.'
        : p.batch.clips.length + '편 후보 · 구간을 확인해 주세요.';
    }
  });
  broadcast(project);
  return publicProject(project);
}
function installHandlers() {
  handle('bootstrap', () => ({ projects: store.list('project').filter(p => !p.archived).map(publicProject), presets: store.presets(), settings: publicSettings(), version: app.getVersion() }));
  handle('import-file', async data => {
    let file = data.path;
    if (!file) { const result = await dialog.showOpenDialog(win, { title: '원본 영상 가져오기', properties: ['openFile'], filters: [{ name: '영상', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v'] }] }); if (result.canceled) return null; file = result.filePaths[0]; }
    if (typeof file !== 'string' || !path.isAbsolute(file)) throw fail('영상 파일을 선택해 주세요.');
    const p = makeProject({ name: path.basename(file) }, store.presets()[0]);
    p.directory = path.join(store.settings().outputDir, 'projects', p.id);
    p.source = await importSource(file, p.directory, store.settings());
    p.edit = normalizeEdit({ ...p.edit, end: Math.min(p.source.duration, p.preset.duration) }, p.source);
    store.put('project', p.id, p); return publicProject(p);
  });
  handle('import-url', ({ url }) => {
    const p = makeProject({ kind: 'url', url: youtubeUrl(url), name: 'YouTube 영상' }, store.presets()[0]);
    p.directory = path.join(store.settings().outputDir, 'projects', p.id); store.put('project', p.id, p); return publicProject(p);
  });
  handle('save-edit', ({ id, edit }) => editProject(id, p => { p.edit = normalizeEdit(edit, p.source); }));
  handle('add-sample-caption', ({ id, sourceTime }) => editProject(id, p => {
    const edit = normalizeEdit(p.edit, p.source);
    p.edit = normalizeEdit(withSampleCaption(edit, Number(sourceTime)), p.source);
  }));
  handle('rename', ({ id, title }) => { const p = store.update(id, p => { p.title = String(title || '새 쇼츠').slice(0, 120); }); broadcast(p); return publicProject(p); });
  handle('duplicate', ({ id }) => {
    const p = clone(store.project(id)); p.id = randomUUID(); p.title += ' · 복사'; p.outputs = []; p.undo = []; p.job = null; p.revision = 1; p.createdAt = p.updatedAt = new Date().toISOString(); p.directory = path.join(store.settings().outputDir, 'projects', p.id); p.archived = false; store.put('project', p.id, p); return publicProject(p);
  });
  handle('archive', ({ id }) => { assertIdle(id); return store.update(id, p => { p.archived = true; }); });
  handle('undo', ({ id }) => { assertIdle(id); const p = store.update(id, p => { if (p.undo.length) { p.edit = p.undo.pop(); p.revision++; } }); broadcast(p); return publicProject(p); });
  handle('apply-preset', ({ id, presetId }) => {
    const preset = store.presets().find(p => p.id === presetId); if (!preset) throw fail('프리셋을 찾지 못했습니다.');
    return editProject(id, p => { p.preset = clone(preset); p.candidates = []; p.edit = normalizeEdit({ ...preset, start: p.edit.start, end: Math.min(p.source?.duration || 1800, p.edit.start + preset.duration), items: p.edit.items, sourceMask: p.edit.sourceMask, title: { ...preset.title, text: p.edit.title.text } }, p.source); });
  });
  handle('save-preset', ({ preset }) => { const existing = store.get('preset', preset.id); const p = normalizePreset(preset); if (store.presets().some(b => b.builtin && b.id === p.id)) p.id = randomUUID(); p.updatedAt = new Date().toISOString(); store.put('preset', p.id, p); return store.presets(); });
  handle('delete-preset', ({ id }) => { store.delete('preset', id); return store.presets(); });
  handle('import-preset', async () => { const result = await dialog.showOpenDialog(win, { filters: [{ name: '프리셋 JSON', extensions: ['json'] }], properties: ['openFile'] }); if (result.canceled) return null; const file = result.filePaths[0]; if (fs.statSync(file).size > 1024 * 1024) throw fail('프리셋 파일이 너무 큽니다.'); const data = JSON.parse(fs.readFileSync(file, 'utf8')); if (![1, 2].includes(data.schemaVersion)) throw fail('지원하지 않는 프리셋 버전입니다.'); const p = normalizePreset({ ...data, id: randomUUID() }); store.put('preset', p.id, p); return store.presets(); });
  handle('export-preset', async ({ id }) => { const p = store.presets().find(p => p.id === id); if (!p) throw fail('프리셋을 찾지 못했습니다.'); const result = await dialog.showSaveDialog(win, { defaultPath: 'shorts-preset.json', filters: [{ name: 'JSON', extensions: ['json'] }] }); if (!result.canceled) fs.writeFileSync(result.filePath, JSON.stringify(p, null, 2)); return !result.canceled; });
  handle('import-srt', async ({ id }) => { assertIdle(id); const result = await dialog.showOpenDialog(win, { filters: [{ name: '자막 SRT', extensions: ['srt'] }], properties: ['openFile'] }); if (result.canceled) return null; if (fs.statSync(result.filePaths[0]).size > 8 * 1024 * 1024) throw fail('자막 파일이 너무 큽니다.'); const items = parseSrt(fs.readFileSync(result.filePaths[0], 'utf8')); if (!items.length) throw fail('유효한 SRT 자막을 찾지 못했습니다. UTF-8 파일을 사용해 주세요.'); return editProject(id, p => { p.edit = normalizeEdit({ ...p.edit, items, captions: { ...p.edit.captions, enabled: true } }, p.source); }); });
  handle('read-output-srt', ({ id, outputId }) => readOutputCaptions(captionOutput(store.project(id), outputId)));
  handle('import-output-srt', async ({ id, outputId }) => {
    const output = captionOutput(store.project(id), outputId);
    const result = await dialog.showOpenDialog(win, { title: '완성본용 SRT 열기', filters: [{ name: '자막 SRT', extensions: ['srt'] }], properties: ['openFile'] });
    if (result.canceled) return null;
    const items = normalizeOutputCaptions(readCaptionFile(result.filePaths[0]), output);
    if (!items.length) throw fail('SRT에서 사용할 수 있는 자막을 찾지 못했습니다.', 'SRT_EMPTY');
    return items;
  });
  handle('translate-output-srt', async ({ id, outputId, items }) => {
    const output = captionOutput(store.project(id), outputId);
    if (translations.has(id)) throw fail('이 프로젝트의 자막을 이미 번역 중입니다.', 'BUSY');
    const controller = new AbortController(); translations.set(id, controller);
    try { return await translateInWorkspace(items, output, { ...store.settings(), onCodexEvent: event => codexStatus.record(id, outputId, event) }, store.root, controller.signal); }
    finally { translations.delete(id); }
  });
  handle('cancel-output-translation', ({ id }) => { translations.get(id)?.abort(); });
  const chooseMusicFile = async () => {
    const result = await dialog.showOpenDialog(win, { filters: [{ name: '배경음악', extensions: ['mp3', 'wav', 'm4a', 'aac'] }], properties: ['openFile'] });
    return result.canceled ? null : result.filePaths[0];
  };
  handle('choose-bgm', async ({ id }) => {
    assertIdle(id);
    const bgmPath = await chooseMusicFile();
    return bgmPath ? editProject(id, p => { p.edit.audio.bgmPath = bgmPath; }) : null;
  });
  handle('choose-clip-bgm', async ({ id, clipId }) => {
    assertIdle(id);
    batchClip(store.project(id), clipId);
    return chooseMusicFile();
  });
  handle('codex-account', () => codexStatus.account());
  handle('codex-activity', () => codexStatus.activity());
  handle('save-clip-edit', ({ id, clipId, edit, presetId }) => updateBatch(id, p => {
    const clip = batchClip(p, clipId);
    const preset = presetId && store.presets().find(item => item.id === presetId);
    if (preset) { clip.presetId = preset.id; clip.presetName = preset.name; }
    saveClipDraft(p, clipId, edit);
  }));
  handle('confirm-clips', ({ id, clipIds }) => updateBatch(id, p => {
    if (!Array.isArray(clipIds) || !clipIds.length || clipIds.length > 10) throw fail('편집할 구간을 선택해 주세요.');
    for (const clipId of new Set(clipIds)) {
      const clip = batchClip(p, clipId);
      if (!clip.confirmed) saveClipDraft(p, clip.id, clipEdit(p, clip));
    }
  }));
  handle('copy-clip-customization', ({ id, clipId, targets, title, mask }) => updateBatch(id, p => {
    if (!Array.isArray(targets) || !targets.length || targets.length > 9 || targets.includes(clipId) || (!title && !mask)) {
      throw fail('복사할 설정과 적용할 쇼츠를 선택해 주세요.');
    }
    const source = clipEdit(p, batchClip(p, clipId));
    const recipients = [...new Set(targets)].map(target => batchClip(p, target));
    if (recipients.some(clip => !clip.confirmed)) throw fail('확정한 쇼츠에만 설정을 복사할 수 있습니다.');
    for (const clip of recipients) {
      const edit = clipEdit(p, clip);
      if (title) edit.title = { ...edit.title, text: source.title.text };
      if (mask) edit.sourceMask = { ...source.sourceMask, start: edit.sourceMask.start, end: edit.sourceMask.end };
      saveClipDraft(p, clip.id, edit);
    }
  }));
  handle('add-manual-clip', ({ id, start, length, count }) => updateBatch(id, p => {
    if (!p.source?.path) throw fail('먼저 원본 영상을 준비해 주세요.');
    batchOptions('batch-analyze', { length, count }, p);
    if (!p.batch) p.batch = { id: randomUUID(), length, count, clips: [], method: 'manual', reviewRequired: true };
    if (p.batch.clips.length >= 10) throw fail('한 번에 최대 10편까지 편집할 수 있습니다.');
    const startAt = bounded(start, 0, Math.max(0, p.source.duration - length));
    p.batch.clips.push({ id: randomUUID(), start: startAt, end: startAt + length, title: '직접 추가한 쇼츠',
      reason: '원본 재생 위치에서 시작합니다.', evidence: '', evidenceKind: 'manual' });
  }));
  handle('remove-clip', ({ id, clipId }) => updateBatch(id, p => {
    const clip = batchClip(p, clipId);
    if (clip.outputId) throw fail('완성본이 있는 쇼츠는 결과에서 확인해 주세요.');
    p.batch.clips = p.batch.clips.filter(item => item.id !== clipId);
  }));
  handle('swap-batch', ({ id }) => updateBatch(id, p => {
    if (!p.previousBatch) throw fail('비교할 이전 후보가 없습니다.');
    [p.batch, p.previousBatch] = [p.previousBatch, p.batch];
  }));
  handle('translate-clip-srt', async ({ id, clipId, items }) => {
    const project = store.project(id), clip = batchClip(project, clipId), edit = clipEdit(project, clip);
    if (translations.has(id)) throw fail('이 프로젝트의 자막을 이미 번역 중입니다.', 'BUSY');
    const controller = new AbortController(); translations.set(id, controller);
    try {
      const translated = await translateInWorkspace(items, { edit }, { ...store.settings(), onCodexEvent: event => codexStatus.record(id, clipId, event) }, store.root, controller.signal);
      return translated;
    } finally { translations.delete(id); }
  });
  handle('import-clip-srt', async ({ id, clipId }) => {
    assertIdle(id);
    const project = store.project(id), clip = batchClip(project, clipId);
    const file = await dialog.showOpenDialog(win, { title: '쇼츠의 자막 가져오기', properties: ['openFile'], filters: [{ name: '자막 SRT', extensions: ['srt'] }] });
    if (file.canceled) return null;
    const items = readCaptionFile(file.filePaths[0]);
    if (!items.length) throw fail('읽을 수 있는 자막이 없습니다.');
    if (items.some(row => row.start < 0 || row.end > clip.end - clip.start + .001)) throw fail('이 쇼츠의 00:00 기준 SRT를 선택해 주세요.');
    return updateBatch(id, p => {
      const current = batchClip(p, clipId), edit = clipEdit(p, current);
      if (current.start !== clip.start || current.end !== clip.end) throw fail('구간이 바뀌었습니다. SRT를 다시 가져와 주세요.');
      saveClipDraft(p, clipId, { ...edit, items: items.map(row => ({ ...row, start: row.start + current.start, end: row.end + current.start })),
        captions: { ...edit.captions, enabled: true } });
    });
  });
  handle('run', ({ id, options = {} }) => {
    const action = options.action || 'render';
    if (!['render', 'prepare', 'transcribe', 'batch-analyze', 'batch-render', 'caption-script', 'output-captions', 'clip-transcribe', 'clip-ai', 'clip-preview'].includes(action)) throw fail('지원하지 않는 작업입니다.');
    const config = { action, auto: action === 'render' && !!options.auto, review: !!options.review };
    if (action.startsWith('batch-')) Object.assign(config, batchOptions(action, options, store.project(id)));
    if (['clip-transcribe', 'clip-ai', 'clip-preview'].includes(action)) {
      const clip = batchClip(store.project(id), options.clipId);
      config.clipId = clip.id;
      if (action === 'clip-ai') {
        if (typeof options.request !== 'string' || !options.request.trim() || options.request.length > 2000) throw fail('2,000자 이하의 편집 요청을 입력해 주세요.');
        config.request = options.request.trim();
      }
    }
    if (action === 'caption-script') config.captionMode = options.captionMode === 'verbatim' ? 'verbatim' : 'polished';
    if (action === 'output-captions') {
      const output = captionOutput(store.project(id), options.outputId);
      config.outputId = output.id;
      config.items = normalizeOutputCaptions(options.items, output);
    }
    return publicProject(jobs.enqueue(id, config));
  });
  handle('open-output-project', ({ id, outputId }) => {
    const parent = store.project(id);
    const output = parent.outputs.find(o => o.id === outputId);
    if (!output?.edit || !parent.source?.path) throw fail('편집할 결과를 찾지 못했습니다.');
    const p = makeProject(parent.source, parent.preset);
    p.title = output.edit.title.text || parent.title;
    p.edit = normalizeEdit(output.edit, p.source);
    p.directory = path.join(store.settings().outputDir, 'projects', p.id);
    p.outputs = [{ ...output, revision: p.revision }];
    store.put('project', p.id, p);
    broadcast(p);
    return publicProject(p);
  });
  handle('cancel', ({ id }) => publicProject(jobs.cancel(id)));
  handle('request-edit', ({ id, request }) => { assertIdle(id); if (typeof request !== 'string' || !request.trim() || request.length > 2000) throw fail('2,000자 이하의 편집 요청을 입력해 주세요.'); store.update(id, p => { p.messages.push({ role: 'user', text: request, at: new Date().toISOString() }); }); return publicProject(jobs.enqueue(id, { action: 'edit', request })); });
  handle('save-settings', async ({ settings }) => {
    const current = store.settings();
    for (const k of ['outputDir', 'cliPath', 'codexPath', 'ffmpegPath', 'ffprobePath', 'ytdlpPath', 'whisperPath', 'whisperModelPath', 'ttsPythonPath', 'ttsModelPath']) if (typeof settings[k] === 'string') current[k] = settings[k].trim().slice(0, 1000);
    for (const field of ['model', 'codexModel']) if (typeof settings[field] === 'string') {
      const model = settings[field].trim();
      if (model && !MODEL_ID.test(model)) throw fail('모델 ID에는 영문, 숫자, 점, 밑줄, 하이픈 또는 모델 구분자만 입력해 주세요.');
      current[field] = model;
    }
    if (settings.codexReasoning !== undefined) {
      if (!CODEX_EFFORTS.includes(settings.codexReasoning)) throw fail('지원하지 않는 Codex 추론 강도입니다.');
      current.codexReasoning = settings.codexReasoning;
    }
    if (typeof settings.preferYouTubeCC === 'boolean') current.preferYouTubeCC = settings.preferYouTubeCC;
    if (['whisper', 'api'].includes(settings.transcriptionEngine)) current.transcriptionEngine = settings.transcriptionEngine;
    if (['auto', 'ko', 'en', 'ja'].includes(settings.transcriptionLanguage)) current.transcriptionLanguage = settings.transcriptionLanguage;
    if (['local', 'codex', 'claude'].includes(settings.aiEngine)) current.aiEngine = settings.aiEngine;
    current.transcribeModel = 'whisper-1';
    if (!path.isAbsolute(current.outputDir)) throw fail('출력 위치는 전체 경로를 지정해 주세요.');
    fs.mkdirSync(current.outputDir, { recursive: true }); fs.accessSync(current.outputDir, fs.constants.W_OK);
    if (settings.clearApiKey) current.apiKeyEnc = '';
    else if (settings.apiKey?.trim()) {
      const available = safeStorage.isAsyncEncryptionAvailable ? await safeStorage.isAsyncEncryptionAvailable() : safeStorage.isEncryptionAvailable();
      if (!available) throw fail('OS 암호화 저장소를 사용할 수 없습니다.', 'KEY_STORAGE');
      const buffer = safeStorage.encryptStringAsync ? await safeStorage.encryptStringAsync(settings.apiKey.trim()) : safeStorage.encryptString(settings.apiKey.trim()); current.apiKeyEnc = buffer.toString('base64');
    }
    store.put('settings', 'default', current); return publicSettings();
  });
  handle('diagnose', async () => {
    const settings = store.settings();
    const tools = await Promise.all(['ffmpeg', 'ffprobe', 'ytdlp'].map(async name => {
      const exe = toolPath(name, settings); try { const res = await run(exe, [name === 'ytdlp' ? '--version' : '-version'], { timeout: 15000 }); return { name, ok: true, path: exe, version: res.stdout.split(/\r?\n/)[0].slice(0, 150) }; } catch (e) { return { name, ok: false, path: exe, version: e.message.slice(0, 160) }; }
    }));
    return { tools, whisper: resolveWhisper(settings), cliPath: detectCli('codex', settings.codexPath), dataDir: store.root, outputDir: settings.outputDir, electron: process.versions.electron };
  });
  handle('select-path', async ({ kind }) => { const folder = ['outputDir', 'ttsModelPath'].includes(kind); const result = await dialog.showOpenDialog(win, { properties: [folder ? 'openDirectory' : 'openFile'] }); return result.canceled ? null : result.filePaths[0]; });
  handle('export-video', async ({ id, outputId, captions }) => { const p = store.project(id), output = p.outputs.find(o => o.id === outputId); if (!output) throw fail('출력 파일을 찾지 못했습니다.'); const file = captions ? output.captionsPath : output.path; const ext = captions ? 'srt' : 'mp4'; const result = await dialog.showSaveDialog(win, { defaultPath: `${p.title.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.${ext}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] }); if (!result.canceled && path.resolve(file) !== path.resolve(result.filePath)) fs.copyFileSync(file, result.filePath); return !result.canceled; });
  handle('open-folder', async ({ id }) => { const p = store.project(id); fs.mkdirSync(p.directory, { recursive: true }); const error = await shell.openPath(p.directory); if (error) throw fail(error); });
  handle('window', ({ action }) => { if (action === 'minimize') win.minimize(); else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize(); else if (action === 'close') win.close(); });
}
function installProtocols() {
  protocol.handle('studio', request => {
    const u = new URL(request.url); if (u.hostname !== 'ui') return new Response('', { status: 403 });
    const file = contained(path.join(root, 'dist'), path.join(root, 'dist', decodeURIComponent(u.pathname === '/' ? '/index.html' : u.pathname)));
    return net.fetch(pathToFileURL(file).href);
  });
  protocol.handle('media', request => {
    try {
      const u = new URL(request.url); if (u.hostname !== 'project') return new Response('', { status: 403 });
      const [id, kind, outputId] = u.pathname.split('/').filter(Boolean); const p = store.project(id);
      const candidate = kind === 'candidate' ? p.batch : kind === 'previous-candidate' ? p.previousBatch : null;
      const preview = p.job?.clipPreview;
      const file = candidate ? candidate.clips.find(clip => clip.id === outputId)?.thumbnail : kind === 'source' ? p.source?.path : kind === 'thumbnail' ? p.source?.thumbnail : kind === 'output' ? p.outputs.find(o => o.id === outputId)?.path : kind === 'preview' && preview?.id === outputId ? preview?.path : null;
      if (!file || !fs.existsSync(file)) return new Response('', { status: 404 });
      return net.fetch(pathToFileURL(file).href, { headers: request.headers });
    } catch { return new Response('', { status: 404 }); }
  });
}
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();
app.whenReady().then(async () => {
  if (!gotLock) return;
  store = await Store.open(app.getPath('userData'));
  const settings = store.settings();
  if (!settings.outputDir) store.put('settings', 'default', { ...settings, aiEngine: 'local', outputDir: path.join(app.getPath('documents'), 'Shorts Studio') });
  codexStatus = new CodexStatus(store, activity => { if (win && !win.isDestroyed()) win.webContents.send('studio:codex-activity', activity); });
  jobs = new Jobs(store, () => utilityProcess.fork(path.join(__dirname, 'worker.cjs'), [], { stdio: 'pipe' }), workerSettings, broadcast, codexStatus);
  installProtocols(); installHandlers();
  win = new BrowserWindow({ width: 1480, height: 960, minWidth: 1100, minHeight: 720, frame: false, backgroundColor: '#0f0f0f', title: 'Shorts Studio bySom', icon: path.join(root, 'assets', 'icon.png'), show: !isTest, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith('studio://ui/')) e.preventDefault(); });
  win.webContents.on('console-message', event => console.log('[renderer]', event.message));
  win.on('close', event => {
    if (jobs.active && !closing) {
      const choice = dialog.showMessageBoxSync(win, { type: 'question', title: '진행 중인 제작', message: '작업을 취소하고 앱을 종료할까요?', buttons: ['창으로 돌아가기', '취소하고 종료'], defaultId: 0, cancelId: 0 });
      event.preventDefault();
      if (choice === 0) return;
      closing = true; jobs.cancel(jobs.active.projectId);
      const deadline = Date.now() + 6000;
      const timer = setInterval(() => { if (!jobs.active || Date.now() >= deadline) { clearInterval(timer); jobs.shutdown(); win.close(); } }, 100);
    }
  });
  await win.loadURL('studio://ui/index.html');
  if (!isTest) win.show();
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.focus(); });
}).catch(error => { console.error(error); dialog.showErrorBox('Shorts Studio 시작 오류', error.message); app.quit(); });
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => { for (const controller of translations.values()) controller.abort(); jobs?.shutdown(); store?.close(); });
