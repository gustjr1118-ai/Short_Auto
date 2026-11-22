const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { fork } = require('node:child_process');
const { PRESETS, makeProject } = require('../electron/domain.cjs');
function execute(action, extra = {}, cancel = false) {
  const p = makeProject({ name: '워크플로 테스트', path: __filename, duration: 30, hasAudio: true }, PRESETS[0]);
  p.edit.items = Array.from({ length: 10 }, (_, i) => ({ start: i * 3, end: i * 3 + 2.5, text: i === 0 ? '그런데 핵심은 무엇일까요?' : '설명 문장입니다.' }));
  if (extra.sampleOnly) p.edit.items = p.edit.items.map(c => ({ ...c, sample: true }));
  if (extra.multiple) p.edit.segments = [{ id: 'one', start: 0, end: 3, label: '첫 구간' }, { id: 'two', start: 10, end: 13, label: '다음 구간' }];
  const dir = path.resolve('.test-data', p.id); fs.mkdirSync(dir, { recursive: true });
  return new Promise((resolve, reject) => {
    const child = fork(path.resolve('electron/worker.cjs'), { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    const timer = setTimeout(() => { child.kill(); reject(new Error('worker timeout')); }, 10000);
    child.on('message', msg => {
      if (msg.type === 'result' || msg.type === 'error') { clearTimeout(timer); child.kill(); msg.type === 'result' ? resolve(msg.result) : reject(Object.assign(new Error(msg.message), { code: msg.code })); }
    });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.send({ type: 'start', project: p, dir, settings: { aiEngine: 'local' }, action, ...extra });
    if (cancel) child.send({ type: 'cancel' });
  });
}
test('worker interprets a basic editing request without an API or shell', async () => {
  const result = await execute('edit', { request: '제목을 “검증된 편집”으로, 자막은 크게' }); assert.equal(result.action, 'edit'); assert.equal(result.edit.title.text, '검증된 편집'); assert.ok(result.edit.captions.size > PRESETS[0].captions.size);
});
test('worker reviews continuous candidates from existing captions without transcription', async () => {
  const result = await execute('render', { auto: true, review: true }); assert.equal(result.action, 'review'); assert.ok(result.candidates.length > 0); assert.equal(result.edit.start, result.candidates[0].start); assert.ok(result.edit.end <= 30);
});
test('missing transcription credentials fail without a fake successful result', async () => {
  await assert.rejects(execute('transcribe'), { code: 'STT_SETUP' });
});
test('sample-only captions cannot masquerade as a transcript in the worker', async () => {
  await assert.rejects(execute('render', { auto: true, review: true, sampleOnly: true }), { code: 'STT_SETUP' });
});
test('automatic recommendations cannot replace a manually composed sequence', async () => {
  await assert.rejects(execute('render', { auto: true, review: true, multiple: true }), { code: 'MULTI_AUTO' });
});
