const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const processTool = require('../electron/process.cjs');
const { PRESETS, makeProject } = require('../electron/domain.cjs');

test('an unset or stale Whisper path resolves the built-in packaged engine and model', () => {
  const { resolveWhisper } = require('../electron/whisper.cjs');
  fs.mkdirSync('.test-data', { recursive: true });
  const resources = fs.mkdtempSync(path.resolve('.test-data', 'whisper-bundle-'));
  const bundled = path.join(resources, 'tools', 'whisper');
  fs.mkdirSync(bundled, { recursive: true });
  const exe = path.join(bundled, process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli');
  const model = path.join(bundled, 'ggml-base-q5_1.bin');
  fs.writeFileSync(exe, '');
  fs.writeFileSync(model, '');
  const original = Object.getOwnPropertyDescriptor(process, 'resourcesPath');
  Object.defineProperty(process, 'resourcesPath', { configurable: true, value: resources });
  try {
    assert.deepEqual(resolveWhisper(), { exe, model, fallback: false });
    assert.deepEqual(resolveWhisper({ whisperPath: path.join(resources, 'missing.exe'), whisperModelPath: path.join(resources, 'missing.bin') }), { exe, model, fallback: true });
  } finally {
    if (original) Object.defineProperty(process, 'resourcesPath', original);
    else delete process.resourcesPath;
  }
});

test('batch and caption workflows send the saved model and reasoning to Codex and enforce source boundaries', async t => {
  const calls = [];
  t.mock.method(processTool, 'run', async (exe, args, options) => {
    calls.push({ exe, args, options });
    const prefix = args[args.indexOf('--output-last-message') + 1];
    const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
    const value = schema.required.includes('candidates') ? { candidates: [
      { first: 2, last: 3, title: '두 번째 사건', reason: '근거 확인', score: 90 },
      { first: 0, last: 1, title: '첫 번째 사건', reason: '근거 확인', score: 85 },
      { first: 0, last: 1, title: '중복', reason: '', score: 70 },
      { first: 4, last: 100, title: '범위 밖', reason: '', score: 100 },
    ] } : { captions: [{ id: 0, text: '다듬은 실제 자막' }, { id: 4, text: '예시 변조 시도' }] };
    fs.writeFileSync(prefix, JSON.stringify(value), 'utf8');
    return { stdout: '', stderr: '' };
  });
  const { analyzeBatch } = require('../electron/batch.cjs');
  const { generateCaptions } = require('../electron/caption-script.cjs');
  const project = makeProject({ duration: 75, name: '시험.mp4' }, PRESETS[0]);
  project.edit.items = [
    { start: 2, end: 4, text: '첫 시작' }, { start: 10, end: 14, text: '첫 결말' },
    { start: 42, end: 44, text: '둘째 시작' }, { start: 50, end: 54, text: '둘째 결말' },
    { start: 0, end: 1, text: '테스트용 예시', sample: true },
  ];
  fs.mkdirSync('.test-data', { recursive: true });
  const dir = fs.mkdtempSync(path.resolve('.test-data', 'v03-codex-'));
  const settings = { aiEngine: 'claude', codexPath: process.execPath, codexModel: 'gpt-6.2-sol', codexReasoning: 'high' };
  const batch = await analyzeBatch(project, { length: 15, count: 4 }, dir, settings, null, () => {});
  assert.deepEqual(batch.clips.map(c => c.title), ['두 번째 사건', '첫 번째 사건']);
  assert.ok(batch.clips.every(c => c.end - c.start === 15 && c.end <= project.source.duration));
  const captions = await generateCaptions(project, 'polished', dir, settings);
  assert.ok(captions.items.some(c => c.text === '다듬은 실제 자막' && c.start === 2 && c.end === 4));
  assert.ok(captions.items.some(c => c.sample && c.text === '테스트용 예시'));
  assert.equal(calls.length, 2);
  for (const { args, options } of calls) {
    assert.deepEqual(args.slice(args.indexOf('--model'), args.indexOf('--model') + 2), ['--model', 'gpt-6.2-sol']);
    assert.ok(args.includes('model_reasoning_effort=high'));
    assert.doesNotMatch(options.stdin, /테스트용 예시/);
  }
});
