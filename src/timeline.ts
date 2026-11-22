import type { Edit, Overlay, Segment } from './types';

export const segmentsOf = (e: Edit): Segment[] => e.segments?.length ? e.segments : [{ id: 'single', start: e.start, end: e.end, label: '', layout: e.layout, cropX: e.cropX, cropY: e.cropY }];
export const durationOf = (e: Edit) => segmentsOf(e).reduce((sum, s) => sum + s.end - s.start, 0);
export function outputTime(e: Edit, sourceTime: number, index: number) {
  const segments = segmentsOf(e), s = segments[index] || segments[0];
  return segments.slice(0, index).reduce((sum, s) => sum + s.end - s.start, 0) + Math.max(0, Math.min(s.end - s.start, sourceTime - s.start));
}
export function overlaysOf(e: Edit): Overlay[] {
  let offset = 0;
  return [...e.overlays, ...segmentsOf(e).flatMap((s, i) => {
    const start = offset; offset += s.end - s.start;
    return e.segments.length && s.label ? [{ id: `label-${s.id}`, start, end: offset, text: e.kind === 'list' ? `${i + 1}/${e.segments.length} · ${s.label}` : s.label, x: 50, y: 25, size: 52, color: e.kind === 'transformation' && i === 0 ? '#b8b8b8' : e.captions.accent, background: true }] : [];
  })];
}
export function wrappedLines(text: string, width: number) {
  return text.split('\n').flatMap(line => {
    const chars = Array.from(line), result = [];
    while (chars.length > width) {
      const space = chars.slice(0, width + 1).join('').lastIndexOf(' '), cut = space >= width / 2 ? space : width;
      result.push(chars.splice(0, cut).join('').trim()); if (chars[0] === ' ') chars.shift();
    }
    if (chars.length) result.push(chars.join('')); return result;
  });
}
export function captionPreview(text: string, start: number, end: number, now: number) {
  const lines = wrappedLines(text, 17), groups = Math.max(1, Math.ceil(lines.length / 2));
  const group = Math.min(groups - 1, Math.floor(Math.max(0, now - start) / Math.max(.01, end - start) * groups));
  return lines.slice(group * 2, group * 2 + 2).join('\n');
}

export function outputPosition(edit: Edit, seconds: number) {
  const segments = segmentsOf(edit);
  let remaining = Math.max(0, seconds);
  for (const [index, segment] of segments.entries()) {
    const length = Math.max(0, segment.end - segment.start);
    if (remaining < length || index === segments.length - 1) {
      return { time: segment.start + Math.min(remaining, Math.max(0, length - .001)), index };
    }
    remaining -= length;
  }
  return { time: edit.start, index: 0 };
}
