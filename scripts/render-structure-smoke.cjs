const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { run } = require('../electron/process.cjs');
const { importSource, render, toolPath, probe } = require('../electron/media.cjs');
const { PRESETS, makeProject, normalizeEdit, sampleCaption } = require('../electron/domain.cjs');
async function main() {
  const root = path.resolve('.smoke-data', '프리셋 확장'); fs.mkdirSync(root, { recursive: true });
  const file = path.join(root, '빨강 초록 파랑 원본.mp4');
  await run(toolPath('ffmpeg'), ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=green:s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:r=30:d=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-filter_complex_threads', '1', '-filter_complex', '[0:v][1:v][2:v]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', file]);
  const results = [];
  for (const kind of ['transformation', 'list', 'silent-bgm', 'single-connected']) {
    const dir = path.join(root, kind); const source = await importSource(file, dir, {});
    const p = makeProject(source, PRESETS.find(p => p.id === (kind === 'transformation' ? kind : 'list')));
    const segments = [
      { id: 'blue', start: 4, end: 5.5, label: '파랑', layout: 'blur', cropX: 50, cropY: 50 },
      { id: 'red', start: 0, end: 1.5, label: '빨강', layout: 'crop', cropX: 30, cropY: 50 },
      { id: 'green', start: 2, end: 3.5, label: '초록', layout: 'fit', cropX: 50, cropY: 50 },
    ].slice(0, kind === 'transformation' ? 2 : kind === 'single-connected' ? 1 : 3);
    const duration = segments.length * 1.5;
    p.edit = normalizeEdit({ ...p.edit, segments, title: { ...p.edit.title, text: '구간 순서·자막 검증' }, captions: { ...p.edit.captions, enabled: true }, items: [
      { start: 4.25, end: 4.75, text: '첫 번째 파랑 장면' }, { start: .25, end: .75, text: '두 번째 빨강 장면' }, { start: 2.25, end: 2.75, text: '세 번째 초록 장면' },
    ], overlays: [{ id: 'test', start: 0, end: duration, text: '설명 위치 테스트', x: 50, y: 38, color: '#72ddb4', size: 52, background: true }] }, source);
    p.edit.items.push(sampleCaption(p.edit, 4));
    if (kind === 'silent-bgm') { p.source.hasAudio = false; p.edit.audio.bgmPath = file; p.edit.audio.bgmVolume = .08; }
    console.log(`Rendering ${kind}`);
    const output = await render(p, dir, {}), info = await probe(output.path, {});
    assert.ok(Math.abs(info.duration - duration) < .1); assert.ok(info.hasAudio);
    const srt = fs.readFileSync(output.captionsPath, 'utf8');
    assert.match(srt, /00:00:00,250 --> 00:00:00,750/);
    if (segments.length > 1) assert.match(srt, /00:00:01,750 --> 00:00:02,250/);
    if (segments.length > 2) assert.match(srt, /00:00:03,250 --> 00:00:03,750/);
    for (let i = 0; i < segments.length; i++) {
      const pixel = path.join(dir, `pixel-${i}.rgb`), frame = path.join(dir, `frame-${i}.png`);
      await run(toolPath('ffmpeg'), ['-y', '-ss', String(i * 1.5 + .6), '-i', output.path, '-frames:v', '1', '-vf', 'crop=2:2:540:960,format=rgb24', '-f', 'rawvideo', pixel]);
      const rgb = fs.readFileSync(pixel); const expected = [2, 0, 1][i];
      assert.ok(rgb[expected] > (expected === 1 ? 70 : 180), `${kind} segment ${i}: ${[...rgb.slice(0, 3)]}`);
      for (let c = 0; c < 3; c++) if (c !== expected) assert.ok(rgb[c] < 50);
      await run(toolPath('ffmpeg'), ['-y', '-ss', String(i * 1.5 + .6), '-i', output.path, '-frames:v', '1', '-vf', 'scale=360:640', frame]);
    }
    results.push({ kind, path: output.path, duration: info.duration, audio: info.hasAudio, order: segments.map(s => s.label), subtitlesMapped: true, frameColorsVerified: true });
  }
  fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
