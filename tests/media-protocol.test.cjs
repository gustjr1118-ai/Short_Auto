const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { serveMediaFile } = require('../electron/media-protocol.cjs');

test('native preview can read the ends and middle of a local media file', async t => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-preview-'));
  const file = path.join(folder, 'source.mp4');
  fs.writeFileSync(file, '0123456789');
  t.after(() => { fs.unlinkSync(file); fs.rmdirSync(folder); });
  function request(range, method = 'GET') {
    return serveMediaFile(file, new Request('media://project/fixture/source', { method, headers: range ? { Range: range } : {} }));
  }

  const full = request();
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.equal(full.headers.get('content-length'), '10');
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(await full.text(), '0123456789');

  for (const [range, expected, span] of [
    ['bytes=0-', '0123456789', '0-9'], ['bytes=4-6', '456', '4-6'],
    ['bytes=6-99', '6789', '6-9'], ['bytes=-2', '89', '8-9'],
  ]) {
    const partial = request(range);
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get('content-range'), `bytes ${span}/10`);
    assert.equal(partial.headers.get('content-length'), String(expected.length));
    assert.equal(await partial.text(), expected);
  }

  const head = request('bytes=3-5', 'HEAD');
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-range'), 'bytes 3-5/10');
  assert.equal(await head.text(), '');
  const outside = request('bytes=10-');
  assert.equal(outside.status, 416);
  assert.equal(outside.headers.get('content-range'), 'bytes */10');
});
