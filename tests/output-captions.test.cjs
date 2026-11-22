const test = require('node:test');
const assert = require('node:assert/strict');
const { PRESETS, normalizeEdit, parseSrt, toSrt } = require('../electron/domain.cjs');
const { normalizeOutputCaptions, readOutputCaptions, translateOutputCaptions } = require('../electron/output-captions.cjs');
const { makeAss } = require('../electron/media.cjs');

const output = {
  edit: normalizeEdit({
    ...PRESETS[0], segments: [{ id: 'first', start: 5, end: 7 }, { id: 'repeat', start: 5, end: 7 }],
    items: [{ start: 5.31, end: 6.85, text: 'Keep going.' }],
  }, { duration: 20 }),
};

test('subtitle revisions on repeated source footage use the completed short timeline', () => {
  const rows = readOutputCaptions(output);
  const revised = normalizeOutputCaptions(rows.map((row, i) => ({ ...row, text: i ? '두 번째 문구' : '첫 번째 문구' })), output);
  assert.deepEqual(normalizeOutputCaptions(parseSrt(toSrt(revised)), output), [
    { start: .31, end: 1.85, text: '첫 번째 문구' },
    { start: 2.31, end: 3.85, text: '두 번째 문구' },
  ]);
  const ass = makeAss(output.edit, revised);
  assert.match(ass, /0:00:00\.31,0:00:01\.85,Caption.*첫 번째 문구/);
  assert.match(ass, /0:00:02\.31,0:00:03\.85,Caption.*두 번째 문구/);
  assert.doesNotMatch(ass, /Keep going/);
  assert.deepEqual(normalizeOutputCaptions([{ ...revised[0], text: ' ' }], output), []);
  assert.throws(() => normalizeOutputCaptions([{ start: 3, end: 5, text: 'Outside the short' }], output), { code: 'SRT_CUE' });
});

test('Codex translation changes text only and retains each cue and existing Korean', async () => {
  const rows = [{ start: 0, end: .25, text: 'Good morning.' }, { start: .5, end: 1, text: '안녕하세요.' }, { start: 2.3, end: 3, text: 'Keep going.' }];
  const result = await translateOutputCaptions(rows, output, { aiEngine: 'local', codexModel: 'gpt-6.2-sol', codexReasoning: 'high' }, 'unused', undefined,
    async (prompt, _dir, settings) => {
      assert.equal(settings.aiEngine, 'codex');
      assert.equal(settings.codexModel, 'gpt-6.2-sol');
      assert.equal(settings.codexReasoning, 'high');
      assert.doesNotMatch(prompt, /안녕하세요/);
      return { captions: [{ id: 2, text: '계속하세요.' }, { id: 0, text: '좋은 아침입니다.' }] };
    });
  assert.deepEqual(result, [{ ...rows[0], text: '좋은 아침입니다.' }, rows[1], { ...rows[2], text: '계속하세요.' }]);
});

test('a partial Codex reply is rejected without modifying the editor rows', async () => {
  const rows = [{ start: 0, end: 1, text: 'Good morning.' }, { start: 1, end: 2, text: 'Keep going.' }];
  await assert.rejects(translateOutputCaptions(rows, output, {}, 'unused', undefined,
    async () => ({ captions: [{ id: 0, text: '좋은 아침입니다.' }] })), { code: 'SRT_TRANSLATION' });
  assert.equal(rows[0].text, 'Good morning.');
});
