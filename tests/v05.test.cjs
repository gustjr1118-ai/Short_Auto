const assert = require('node:assert/strict');
const test = require('node:test');
const { rateWindows } = require('../electron/codex-status.cjs');
const { eventUsage } = require('../electron/ai.cjs');
const { visualWindows } = require('../electron/highlights.cjs');
const { batchOptions, saveClipDraft, selectClips } = require('../electron/batch.cjs');
const { PRESETS, makeProject } = require('../electron/domain.cjs');

test('account quotas retain actual periods, separate buckets and missing timestamps', () => {
  const result = rateWindows({
    rateLimits: { limitId: 'codex', primary: { usedPercent: 44, windowDurationMins: 300 } },
    rateLimitsByLimitId: {
      codex: { primary: { usedPercent: 10, windowDurationMins: 300, resetsAt: 1900000000 },
        secondary: { usedPercent: 84, windowDurationMins: 10080 } },
      separate: { limitName: 'Other', primary: { usedPercent: 100, windowDurationMins: 60 } },
    },
  });
  assert.deepEqual(result.map(row => [row.id, row.minutes, row.remaining, row.resetsAt]), [
    ['codex', 300, 90, 1900000000], ['codex', 10080, 16, null], ['separate', 60, 0, null],
  ]);
  assert.deepEqual(rateWindows({ rateLimits: { primary: null } }), []);
  assert.deepEqual(eventUsage({ input_tokens: 8, output_tokens: 2, cached_input_tokens: 0 }),
    { input: 8, output: 2, cached: 0, reasoning: null });
});

test('visual windows reach late source times independently of the initial short range', () => {
  const input = Array.from({ length: 61 }, (_, i) => ({ id: 100000 + i, at: i * 10 }));
  const windows = visualWindows(input, [], 660);
  assert.equal(windows.at(-1).start, 600);
  assert.equal(windows.at(-1).end, 660);
  assert(windows.every(w => w.images.length <= 8));
  assert.equal(windows[3].images.at(-1).at, 590);
});

test('equally strong highlights cover distinct parts of the source', () => {
  const candidates = [0, 25, 50, 260, 530].map(start => ({ start, end: start + 15, score: 85 }));
  assert.deepEqual(selectClips(candidates, 15, 3).map(clip => clip.start), [0, 260, 530]);
  assert.equal(selectClips(candidates.slice(0, 1), 15, 3).length, 1);
});

test('new batches require approval and edited late clip ranges stay independent', () => {
  const project = makeProject({ name: 'source.mp4', duration: 660 }, PRESETS[0]);
  project.batch = { id: 'batch', length: 15, count: 2, reviewRequired: true, clips: [
    { id: 'one', start: 60, end: 75, title: 'one' },
    { id: 'two', start: 510, end: 525, title: 'two' },
  ] };
  assert.throws(() => batchOptions('batch-render', { clipIds: ['two'] }, project));
  const saved = saveClipDraft(project, 'two', { ...project.edit, start: 518, end: 532, title: { ...project.edit.title, text: 'last' } });
  assert.equal(saved.title.text, 'last');
  assert.equal(project.batch.clips[0].start, 60);
  assert.equal(project.edit.end, 45);
  assert.deepEqual(batchOptions('batch-render', { clipIds: ['two'] }, project).clipIds, ['two']);
  assert.throws(() => saveClipDraft(project, 'two', { ...saved, end: 670 }), { code: 'CLIP_RANGE' });
});
