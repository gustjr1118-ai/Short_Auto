const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, normalizePreset, normalizeEdit, makeProject, editDuration, timelineCaptions, timelineOverlays, sampleCaption, withSampleCaption } = require('../electron/domain.cjs');
const { makeAss, renderFilters } = require('../electron/media.cjs');
const { recommendRules } = require('../electron/ai.cjs');
const edit = () => makeProject({ duration: 120, name: '시험' }, PRESETS[7]).edit;
const segments = [
  { id: 'after', start: 20, end: 23, label: '먼저 보여줄 장면', layout: 'fit' },
  { id: 'before', start: 2, end: 4, label: '다음 장면', layout: 'crop' },
];
test('legacy preset version one gains safe defaults and keeps custom styling', () => {
  const e = normalizePreset({ schemaVersion: 1, name: '이전 스타일', captions: { color: '#123456' } });
  assert.equal(e.schemaVersion, 2); assert.equal(e.kind, 'style'); assert.equal(e.captions.color, '#123456'); assert.ok(e.sampleCaption);
});
test('each preset has one distinct editable sample caption', () => {
  assert.equal(new Set(PRESETS.map(p => p.sampleCaption)).size, 8);
  for (const p of PRESETS) { const e = makeProject({ duration: 10 }, p).edit; const c = sampleCaption(e, 8); assert.equal(c.start, 8); assert.equal(c.end, 10); assert.equal(c.text, p.sampleCaption); assert.equal(c.sample, true); }
});
test('sample captions seek the first selected range when the player is outside it', () => {
  const e = normalizeEdit({ ...edit(), segments }, { duration: 120 }); const c = sampleCaption(e, 10);
  assert.equal(c.start, 20); assert.equal(c.end, 23);
});
test('repeated sample insertion keeps one test caption and preserves actual dialogue', () => {
  const e = edit(); e.captions.enabled = false; e.items = [{ start: 0, end: 2, text: '실제 대사' }];
  const first = withSampleCaption(e, 1), second = withSampleCaption(first, 4);
  assert.equal(second.items.length, 2); assert.equal(second.items.filter(c => c.sample).length, 1);
  assert.equal(second.items.find(c => c.sample).start, 4); assert.equal(second.items[0].text, '실제 대사'); assert.equal(second.captions.enabled, true);
});
test('multi-range captions follow playback order, clip boundaries and preserve pauses', () => {
  const e = normalizeEdit({ ...edit(), segments, items: [
    { start: 19, end: 21, text: '경계' }, { start: 22, end: 24, text: '무음 뒤' }, { start: 2.5, end: 3.5, text: '두 번째' },
  ] }, { duration: 120 });
  assert.equal(editDuration(e), 5);
  assert.deepEqual(timelineCaptions(e).map(c => [c.start, c.end, c.text]), [[0, 1, '경계'], [2, 3, '무음 뒤'], [3.5, 4.5, '두 번째']]);
});
test('reordering segments changes both label timing and caption timing', () => {
  const e = normalizeEdit({ ...edit(), segments: [...segments].reverse(), items: [{ start: 20, end: 21, text: '원래 첫 항목' }] }, { duration: 120 });
  assert.equal(timelineCaptions(e)[0].start, 2);
  assert.equal(timelineOverlays(e)[0].text, '1/2 · 다음 장면');
  assert.equal(timelineOverlays(e)[1].start, 2);
});
test('invalid segments and excessive combined duration cannot silently truncate', () => {
  assert.throws(() => normalizeEdit({ ...edit(), segments: [{ start: -1, end: 3 }] }, { duration: 120 }), /시작·종료/);
  assert.throws(() => normalizeEdit({ ...edit(), segments: [{ start: 0, end: 40 }, { start: 50, end: 80 }] }, { duration: 120 }), /60초/);
  assert.throws(() => normalizeEdit({ ...edit(), segments: Array(6).fill({ start: 0, end: 1 }) }, { duration: 120 }), /5개/);
});
test('overlay times are checked against the composed output', () => {
  assert.throws(() => normalizeEdit({ ...edit(), segments, overlays: [{ start: 4, end: 6, text: '범위 밖' }] }, { duration: 120 }), /완성본 길이/);
});
test('sample marker survives normalization but cannot bias recommendations', () => {
  const e = normalizeEdit({ ...edit(), items: [{ start: 0, end: 20, text: '그런데 핵심은 비밀입니다', sample: true }] }, { duration: 120 });
  assert.equal(e.items[0].sample, true); assert.deepEqual(recommendRules(e.items, 120, 30), []);
});
test('overlays render at output times and escape override injection', () => {
  const e = normalizeEdit({ ...edit(), segments, overlays: [{ start: 1, end: 2, x: 30, y: 40, text: '{\\pos(0,0)}안내', background: true }] }, { duration: 120 });
  const ass = makeAss(e); assert.match(ass, /0:00:01\.00,0:00:02\.00,Overlay/); assert.match(ass, /\\pos\(324,768\)/); assert.doesNotMatch(ass, /\{\\pos\(0,0\)\}/);
});
test('long captions are split into two-line events without dropping their text', () => {
  const e = edit(); e.items = [{ start: 0, end: 5, text: '가'.repeat(80) }];
  const events = makeAss(e).split('\n').filter(line => line.startsWith('Dialogue: 0'));
  assert.equal(events.length, 3); assert.ok(events.every(line => line.split('\\N').length <= 2));
  assert.equal(events.map(line => line.slice(line.lastIndexOf(',,') + 2).replace(/\\N/g, '')).join(''), '가'.repeat(80));
});
test('multi-segment graph keeps source time, original audio and per-segment framing', () => {
  const e = normalizeEdit({ ...edit(), segments }, { duration: 120 }); const graph = renderFilters(e, true, false);
  assert.match(graph, /trim=start=20:end=23/); assert.match(graph, /atrim=start=2:end=4/);
  assert.match(graph, /concat=n=2:v=1:a=1/); assert.match(graph, /crop=1080:1920/); assert.doesNotMatch(graph, /atempo/);
});
test('before and after use distinguishable label colors', () => {
  const e = normalizeEdit({ ...edit(), kind: 'transformation', segments }, { duration: 120 });
  assert.equal(timelineOverlays(e)[0].color, '#b8b8b8'); assert.equal(timelineOverlays(e)[1].color, e.captions.accent);
});
