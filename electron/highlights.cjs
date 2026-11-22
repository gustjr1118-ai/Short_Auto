const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { run } = require('./process.cjs');
const { toolPath } = require('./media.cjs');

async function extractFrames(project, dir, settings, signal) {
  const cache = path.join(dir, 'analysis', 'frame-manifest.json');
  try {
    const saved = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (saved.fingerprint === project.source.fingerprint && saved.frames.length && saved.frames.every(frame => fs.existsSync(frame.file))) return saved.frames;
  } catch { /* Prepare new frames when the cache is missing or incomplete. */ }
  const step = Math.max(4, project.source.duration / 55);
  const target = path.join(dir, 'analysis', 'frames-' + randomUUID());
  fs.mkdirSync(target, { recursive: true });
  const filter = "scale=320:-2,select='isnan(prev_selected_t)+gte(t-prev_selected_t," + step +
    ")+gte(t-prev_selected_t," + Math.max(3, step * .65) + ")*gt(scene,0.4)',showinfo";
  const timestamps = [];
  await run(toolPath('ffmpeg', settings), ['-hide_banner', '-nostats', '-loglevel', 'info', '-i', project.source.path,
    '-map', '0:v:0', '-vf', filter, '-an', '-fps_mode', 'vfr', '-threads', '2', '-q:v', '5', path.join(target, 'frame-%03d.jpg')],
    { signal, timeout: 300000, onErrorLine: line => {
      const match = / n:\s*(\d+).*?pts_time:([^\s]+)/.exec(line);
      if (match) timestamps.push(match);
    } });
  const frames = timestamps.flatMap((match, index) => {
    const at = Number(match[2]);
    const file = path.join(target, 'frame-' + String(Number(match[1]) + 1).padStart(3, '0') + '.jpg');
    return Number.isFinite(at) && at >= 0 && fs.existsSync(file) ? [{ id: 100000 + index, at, file }] : [];
  });
  if (frames.length) fs.writeFileSync(cache, JSON.stringify({ fingerprint: project.source.fingerprint, frames }));
  return frames;
}

function visualWindows(frames, items, duration) {
  const windows = [];
  for (let start = 0; start < duration; start += 150) {
    const end = Math.min(duration, start + 150);
    const images = frames.filter(frame => frame.at >= start && frame.at < end);
    const sample = images.length <= 8 ? images : Array.from({ length: 8 }, (_, i) => images[Math.round(i * (images.length - 1) / 7)]);
    const captions = items.filter(item => item.start < end && item.end > start);
    if (sample.length || captions.length) windows.push({ start, end, images: sample, captions });
  }
  return windows;
}

module.exports = { extractFrames, visualWindows };
