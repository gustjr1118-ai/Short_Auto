const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const cli = require('../electron/process.cjs');
const actualRun = cli.run;

// Substitute only the external speech engines so media synthesis still runs in FFmpeg.
cli.run = async (exe, args, options) => {
  if (exe !== process.execPath) return actualRun(exe, args, options);
  if (args.includes('-osrt')) {
    assert.equal(args[args.indexOf('-l') + 1], 'ko');
    assert.ok(fs.statSync(args[args.indexOf('-f') + 1]).size > 44);
    fs.writeFileSync(args[args.indexOf('-of') + 1] + '.srt', '1\n00:00:01,000 --> 00:00:03,000\n첫 번째 검증 자막\n\n2\n00:00:24,000 --> 00:00:26,000\n두 번째 검증 자막\n');
  } else if (args[0] === 'exec') {
    const result = { candidates: [
      { first: 0, last: 0, title: '첫 편', reason: '첫 대사', score: 85 },
      { first: 1, last: 1, title: '두 번째 편', reason: '두 번째 대사', score: 90 },
    ] };
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], JSON.stringify(result), 'utf8');
  } else {
    const request = JSON.parse(fs.readFileSync(args[2], 'utf8'));
    assert.equal(options.env.HF_HUB_OFFLINE, '1');
    for (const row of request.lines) {
      await actualRun(path.resolve(__dirname, '../assets/tools/ffmpeg.exe'), ['-y', '-f', 'lavfi', '-i',
        'sine=frequency=660:duration=0.5', path.join(options.cwd, row.id + '.wav')]);
    }
  }
  return { stdout: '', stderr: '' };
};

if (process.env.SHORTS_TEST_WORKER === '1') {
  require('../electron/worker.cjs');
} else {
  const { importSource, toolPath, render, probe } = require('../electron/media.cjs');
  const { makeProject, PRESETS } = require('../electron/domain.cjs');
  const { transcribeLocal } = require('../electron/whisper.cjs');

  function execute(project, dir, settings) {
    const worker = fork(__filename, [], { env: { ...process.env, SHORTS_TEST_WORKER: '1' }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const events = [];
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (error, result) => {
        if (done) return;
        done = true; clearTimeout(timer); worker.kill();
        if (error) reject(error); else resolve({ events, result });
      };
      const timer = setTimeout(() => finish(new Error('Batch timeout')), 90_000);
      worker.on('message', msg => {
        events.push(msg);
        if (msg.type === 'result') finish(null, msg.result);
        if (msg.type === 'error') finish(new Error(msg.message));
      });
      worker.on('error', finish);
      worker.on('exit', code => finish(new Error('Worker exit ' + code)));
      worker.send({ type: 'start', action: 'batch-analyze', autoBatch: true, length: 15, count: 2, project, dir, settings });
    });
  }

  async function main() {
    const base = path.resolve('.smoke-data');
    fs.mkdirSync(base, { recursive: true });
    const dir = fs.mkdtempSync(path.join(base, 'v03-'));
    const file = path.join(dir, '원본 시험.mp4');
    await actualRun(toolPath('ffmpeg'), ['-y', '-f', 'lavfi', '-i', 'testsrc2=s=320x180:r=30:d=34', '-f', 'lavfi', '-i', 'sine=duration=34',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '2', '-c:a', 'aac', '-shortest', file]);
    const source = await importSource(file, dir, {});
    const project = makeProject(source, PRESETS[1]);
    const model = path.join(dir, 'model');
    fs.mkdirSync(model);
    const modelConfig = path.join(model, 'config.json');
    fs.writeFileSync(modelConfig, '{}');
    const settings = { aiEngine: 'local', codexPath: process.execPath, transcriptionEngine: 'whisper', transcriptionLanguage: 'ko',
      whisperPath: process.execPath, whisperModelPath: modelConfig, ttsPythonPath: process.execPath, ttsModelPath: model };
    project.edit.items = await transcribeLocal(source, dir, settings);
    assert.equal(project.edit.items.length, 2);
    const batch = await execute(project, dir, settings);
    assert.equal(batch.result.partial, false, JSON.stringify(batch.events.filter(event => event.status === 'failed')));
    const outputs = batch.events.filter(event => event.output).map(event => event.output);
    assert.equal(outputs.length, 2);
    for (const output of outputs) assert.equal((await probe(output.path, {})).duration, 15);
    project.edit.end = 4;
    project.edit.audio.narrationMode = 'mix';
    project.edit.sourceMask = { mode: 'blur', x: 15, y: 50, width: 70, height: 30, start: 1, end: 3 };
    const masked = await render(project, dir, settings);
    assert.equal((await probe(masked.path, {})).hasAudio, true);
    project.edit.audio.narrationMode = 'replace';
    project.edit.sourceMask.mode = 'box';
    project.edit.segments = [
      { id: 'second', start: 24, end: 27, layout: 'blur' },
      { id: 'first', start: 1, end: 4, layout: 'fit' },
    ];
    const joined = await render(project, dir, settings);
    const metadata = await probe(joined.path, {});
    assert.equal(metadata.duration, 6);
    assert.equal(metadata.hasAudio, true);
    assert.match(fs.readFileSync(joined.captionsPath, 'utf8'), /00:00:03,000 --> 00:00:05,000/);
    project.edit.sourceMask.mode = 'crop';
    project.edit.audio.narrationMode = 'off';
    const cropped = await render(project, dir, settings);
    assert.equal((await probe(cropped.path, {})).height, 1920);
    console.log('2 × 15-second batch, local transcription interface, timed blur and box, crop, mixed and replaced narration, and joined captions passed.');
  }
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
