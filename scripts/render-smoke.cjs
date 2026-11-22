const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { run } = require('../electron/process.cjs');
const { toolPath, importSource, render, probe } = require('../electron/media.cjs');
const { PRESETS, makeProject, sampleCaption } = require('../electron/domain.cjs');
async function main() {
  const root = path.resolve('.smoke-data', '한글 경로'); fs.mkdirSync(root, { recursive: true });
  const sourceFile = path.join(root, '테스트 원본.mp4');
  await run(toolPath('ffmpeg'), ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=960x540:rate=30:duration=6', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-af', "volume=0:enable='between(t,2,3)'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sourceFile]);
  const results = [];
  for (const preset of PRESETS) {
    const dir = path.join(root, preset.id); const source = await importSource(sourceFile, dir, {});
    const p = makeProject(source, preset); p.edit.start = 1; p.edit.end = 5;
    p.edit.title.text = '원본의 순간을\n나의 쇼츠로';
    p.edit.items = [{ start: 1.1, end: 2, text: '첫 번째 자막입니다' }, { start: 3, end: 4.8, text: '무음 이후에도 싱크 유지' }, sampleCaption(p.edit, 1)];
    p.edit.captions.enabled = true;
    console.log(`Rendering ${preset.id}`);
    const output = await render(p, dir, {}); const info = await probe(output.path, {});
    assert.equal(info.width, 1080); assert.equal(info.height, 1920); assert.ok(info.hasAudio); assert.ok(Math.abs(info.duration - 4) < .1);
    assert.match(fs.readFileSync(output.captionsPath, 'utf8'), /00:00:02,000 --> 00:00:03,800/);
    results.push({ preset: preset.name, file: output.path, duration: info.duration, width: info.width, height: info.height, codec: info.codec });
  }
  fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(results, null, 2)); console.log(JSON.stringify(results, null, 2));
}
main().catch(e => { console.error(e); process.exitCode = 1; });
