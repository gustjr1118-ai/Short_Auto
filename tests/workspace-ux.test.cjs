const test = require('node:test');
const assert = require('node:assert/strict');
const { groupOutputs, versionLabel } = require('../src/output-groups.ts');
const { outputPosition } = require('../src/timeline.ts');

const output = (id, patch = {}) => ({ id, revision: null, edit: { title: { text: id } }, ...patch });

test('caption revisions stay under the originating batch clip even after new recommendations', () => {
  const versions = [
    output('first', { batchClipId: 'a' }),
    output('second', { batchClipId: 'b' }),
    output('first-de', { captionRevisionOf: 'first' }),
    output('second-ko', { captionRevisionOf: 'second' }),
    output('second-fix', { captionRevisionOf: 'second-ko' }),
    output('new', { batchClipId: 'c' }),
  ];
  const groups = groupOutputs({ outputs: versions, title: 'Project', batch: { clips: [{ id: 'c', title: 'New candidate' }] } });
  assert.deepEqual(groups.map(group => [group.id, group.title, group.versions.map(output => output.id)]), [
    ['a', 'first', ['first', 'first-de']],
    ['b', 'second', ['second', 'second-ko', 'second-fix']],
    ['c', 'New candidate', ['new']],
  ]);
  assert.equal(versionLabel(groups[1].versions[2], 2), 'v3 · 자막 수정');
});

test('a legacy independently edited batch output and its new renders share one group', () => {
  const groups = groupOutputs({ outputs: [output('copied', { revision: 1, batchClipId: 'old' }), output('render', { revision: 2 }), output('caps', { captionRevisionOf: 'render' })], title: 'My short' });
  assert.deepEqual(groups.map(group => [group.title, group.versions.length]), [['My short', 3]]);
});

test('seeking a cue uses the right occurrence of a repeated source segment', () => {
  const edit = { segments: [{ start: 12, end: 14 }, { start: 4, end: 5 }, { start: 12, end: 14 }] };
  assert.deepEqual(outputPosition(edit, .5), { time: 12.5, index: 0 });
  assert.deepEqual(outputPosition(edit, 2), { time: 4, index: 1 });
  assert.deepEqual(outputPosition(edit, 3.5), { time: 12.5, index: 2 });
  assert.equal(outputPosition(edit, 5).index, 2);
});
