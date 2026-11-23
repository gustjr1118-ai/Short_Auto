const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');

const contentTypes = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime',
  '.webm': 'video/webm', '.mkv': 'video/x-matroska', '.avi': 'video/x-msvideo',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
};

function byteRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header.trim());
  if (!match || !size) return null;
  const [, first, last] = match;
  if (!first) {
    const suffix = Number(last);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { start: Math.max(0, size - suffix), end: size - 1 } : null;
  }
  const start = Number(first);
  const end = last ? Math.min(Number(last), size - 1) : size - 1;
  return start < size && end >= start ? { start, end } : null;
}

function serveMediaFile(file, request) {
  const stat = fs.statSync(file, { throwIfNoEntry: false });
  if (!stat?.isFile()) return new Response(null, { status: 404 });
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: { Allow: 'GET, HEAD' } });
  }
  const { size } = stat;
  const requested = request.headers.get('range');
  const range = requested ? byteRange(requested, size) : null;
  if (requested && !range) {
    return new Response(null, { status: 416, headers: { 'Accept-Ranges': 'bytes', 'Content-Range': `bytes */${size}` } });
  }
  const length = range ? range.end - range.start + 1 : size;
  const headers = {
    'Accept-Ranges': 'bytes',
    'Content-Length': String(length),
    'Content-Type': contentTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
  };
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  const stream = request.method === 'GET' && length ? fs.createReadStream(file, range || undefined) : null;
  const body = stream ? Readable.toWeb(stream, {
    strategy: new ByteLengthQueuingStrategy({ highWaterMark: stream.readableHighWaterMark }),
  }) : null;
  return new Response(body, { status: range ? 206 : 200, headers });
}

module.exports = { serveMediaFile };
