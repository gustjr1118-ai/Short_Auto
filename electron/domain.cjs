const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');

const clone = value => structuredClone(value);
const fail = (message, code = 'INVALID_INPUT') => Object.assign(new Error(message), { code });
const bounded = (value, min, max, fallback = min) => Number.isFinite(Number(value)) ? Math.min(max, Math.max(min, Number(value))) : fallback;
const color = (value, fallback) => /^#[\da-f]{6}$/i.test(value || '') ? value : fallback;
function normalizePreset(input = {}) {
  const title = input.title || {}, captions = input.captions || {}, audio = input.audio || {};
  return {
    id: /^[\w-]{1,80}$/.test(input.id || '') ? input.id : randomUUID(), schemaVersion: 2,
    kind: ['story', 'tutorial', 'product', 'transformation', 'list'].includes(input.kind) ? input.kind : 'style',
    sampleCaption: String(input.sampleCaption || '[예시] 자막의 위치와 크기를 확인하세요').slice(0, 150),
    name: String(input.name || '나의 프리셋').trim().slice(0, 60), description: String(input.description || '').slice(0, 200),
    builtin: false, duration: bounded(input.duration, 3, 60, 30),
    layout: ['crop', 'fit', 'blur'].includes(input.layout) ? input.layout : 'fit',
    cropX: bounded(input.cropX, 0, 100, 50), cropY: bounded(input.cropY, 0, 100, 50),
    title: { enabled: title.enabled !== false, text: String(title.text || '').slice(0, 120), size: bounded(title.size, 28, 110, 66), color: color(title.color, '#ffffff'), background: title.background !== false, seconds: bounded(title.seconds, 0, 60, 0), position: bounded(title.position, 5, 85, 6), x: bounded(title.x, 8, 92, 50), align: alignment(title.align) },
    captions: { enabled: captions.enabled !== false, size: bounded(captions.size, 24, 90, 56), color: color(captions.color, '#ffffff'), outline: color(captions.outline, '#111111'), accent: color(captions.accent, '#ffe16b'), highlight: String(captions.highlight || '').slice(0, 120), background: captions.background === true, position: bounded(captions.position, 5, 85, 18), x: bounded(captions.x, 8, 92, 50), align: alignment(captions.align) },
    audio: {
      volume: bounded(audio.volume, 0, 2, 1), bgmVolume: bounded(audio.bgmVolume, 0, 1, .12), bgmPath: String(audio.bgmPath || ''), fade: bounded(audio.fade, 0, 5, .8),
      narrationMode: ['mix', 'replace'].includes(audio.narrationMode) ? audio.narrationMode : 'off',
      narrationVoice: ['Sohee', 'Vivian', 'Ryan'].includes(audio.narrationVoice) ? audio.narrationVoice : 'Sohee',
    },
  };
}
function alignment(value) { return ['left', 'right'].includes(value) ? value : 'center'; }
const PRESETS = [
  normalizePreset({ id: 'conversation', name: '대화 하이라이트', sampleCaption: '[예시] 이 대사가 핵심이에요', description: '핵심 대화 · 원음 · 몰입형 세로 크롭', duration: 45, layout: 'crop', title: { seconds: 2 }, captions: { background: false } }),
  normalizePreset({ id: 'explainer', name: '고정 제목 해설', sampleCaption: '[예시] 핵심 내용을 쉽게 설명합니다', description: '상단 제목 · 원본 화면 · 선명한 자막', duration: 30, layout: 'fit', title: { seconds: 0 }, captions: { background: true } }),
  normalizePreset({ id: 'original', name: '원본 보존', sampleCaption: '[예시] 원본 화면 위 자막 테스트', description: '전체 화면 · 흐린 배경 · 자연스러운 원음', duration: 30, layout: 'blur', title: { enabled: false }, captions: { enabled: false } }),
  normalizePreset({ id: 'story', kind: 'story', name: '상황·반전', sampleCaption: '[예시] 그런데 예상 밖의 일이 벌어집니다', description: '상황 → 사건 → 결과·반응', duration: 25, layout: 'fit', title: { size: 68, seconds: 3, position: 9 }, captions: { size: 58, position: 20, accent: '#ffe16b' } }),
  normalizePreset({ id: 'tutorial', kind: 'tutorial', name: '단계별 사용법', sampleCaption: '[예시] 첫 번째 단계를 따라 해 보세요', description: '목표 → 단계별 행동 → 완성', duration: 35, layout: 'fit', title: { size: 62, seconds: 3, position: 9 }, captions: { size: 50, background: true, position: 20, accent: '#72ddb4' } }),
  normalizePreset({ id: 'product', kind: 'product', name: '제품 실사용·비교', sampleCaption: '[예시] 실제 사용 모습과 차이를 확인하세요', description: '비교 조건 → 실사용 → 관찰 결과', duration: 30, layout: 'fit', title: { size: 60, position: 9 }, captions: { size: 50, background: true, position: 20, accent: '#7db8ff' } }),
  normalizePreset({ id: 'transformation', kind: 'transformation', name: '비포·애프터', sampleCaption: '[예시] 이전과 이후의 변화를 비교해 보세요', description: '이전 상태 → 변화 → 이후 상태', duration: 20, layout: 'crop', title: { size: 66, seconds: 2, position: 9 }, captions: { enabled: false, size: 52, position: 20, accent: '#72ddb4' } }),
  normalizePreset({ id: 'list', kind: 'list', name: 'TOP 3 목록', sampleCaption: '[예시] 세 가지 중 첫 번째 항목입니다', description: '세 구간 연결 · 항목명 · 순서 표시', duration: 45, layout: 'fit', title: { size: 60, position: 9 }, captions: { size: 50, background: true, position: 20, accent: '#c6acff' } }),
].map(p => ({ ...p, builtin: true }));

function normalizeEdit(input, source) {
  const p = normalizePreset({ ...input, id: 'edit' });
  const duration = source?.duration || 1800;
  const start = bounded(input.start, 0, Math.max(0, duration - .1), 0);
  const end = bounded(input.end, start + .1, Math.min(duration, start + 60), Math.min(duration, start + p.duration));
  const segments = normalizeSegments(input.segments || [], duration, p);
  const length = segments.length ? segments.reduce((sum, s) => sum + s.end - s.start, 0) : end - start;
  return { ...p, start, end, segments, overlays: normalizeOverlays(input.overlays || [], length), sourceMask: normalizeSourceMask(input.sourceMask, duration), title: { ...p.title, text: String(input.title?.text || '').slice(0, 120) }, captions: p.captions,
    items: normalizeCaptions(input.items || [], duration) };
}
function normalizeSourceMask(mask = {}, duration) {
  const x = bounded(mask.x, 0, 95, 5), y = bounded(mask.y, 0, 95, 74);
  const start = bounded(mask.start, 0, duration, 0);
  const end = mask.end == null ? null : bounded(mask.end, start, duration, duration);
  return {
    mode: ['blur', 'box', 'crop'].includes(mask.mode) ? mask.mode : 'off',
    x, y, width: bounded(mask.width ?? 90, 5, 100 - x), height: bounded(mask.height ?? 20, 5, 100 - y),
    start, end, strength: Math.round(bounded(mask.strength, 2, 50, 20)),
    cropBottom: bounded(mask.cropBottom, 1, 40, 15),
  };
}
function normalizeSegments(items, duration, preset) {
  if (!Array.isArray(items) || items.length > 5) throw fail('연결 구간은 최대 5개까지 선택할 수 있습니다.');
  const ids = new Set();
  const segments = items.map((s, i) => {
    const start = Number(s.start), end = Number(s.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end > duration + .001 || end - start < .1) throw fail(`${i + 1}번 구간의 시작·종료를 원본 안에서 지정해 주세요.`);
    const id = /^[\w-]{1,80}$/.test(s.id || '') && !ids.has(s.id) ? s.id : randomUUID(); ids.add(id);
    return { id, start, end, label: String(s.label || '').slice(0, 50), layout: ['crop', 'fit', 'blur'].includes(s.layout) ? s.layout : preset.layout, cropX: bounded(s.cropX, 0, 100, preset.cropX), cropY: bounded(s.cropY, 0, 100, preset.cropY) };
  });
  if (segments.reduce((sum, s) => sum + s.end - s.start, 0) > 60.001) throw fail('연결한 구간의 전체 길이는 60초 이하여야 합니다.');
  return segments;
}
function normalizeOverlays(items, duration) {
  if (!Array.isArray(items) || items.length > 24) throw fail('설명 표시는 최대 24개까지 넣을 수 있습니다.');
  for (const o of items) if (!Number.isFinite(Number(o.start)) || !Number.isFinite(Number(o.end)) || Number(o.start) < 0 || Number(o.end) <= Number(o.start) || Number(o.end) > duration + .001) throw fail('설명 표시의 시작·종료를 완성본 길이 안에서 지정해 주세요. 구성 탭에서 시간을 조정할 수 있습니다.');
  return items.map(o => ({ id: /^[\w-]{1,80}$/.test(o.id || '') ? o.id : randomUUID(), start: bounded(o.start, 0, 60), end: bounded(o.end, 0, 60), text: String(o.text || '').slice(0, 120), x: bounded(o.x, 10, 90, 50), y: bounded(o.y, 10, 75, 25), size: bounded(o.size, 28, 90, 52), color: color(o.color, '#ffffff'), background: o.background !== false })).filter(o => o.end > o.start);
}
function playbackSegments(edit) { return edit.segments?.length ? edit.segments : [{ id: 'single', start: edit.start, end: edit.end, label: '', layout: edit.layout, cropX: edit.cropX, cropY: edit.cropY }]; }
function editDuration(edit) { return playbackSegments(edit).reduce((sum, s) => sum + s.end - s.start, 0); }
function timelineCaptions(edit) {
  let offset = 0;
  return playbackSegments(edit).flatMap(s => { const out = outputCaptions(edit.items, s.start, s.end).map(c => ({ ...c, start: c.start + offset, end: c.end + offset })); offset += s.end - s.start; return out; });
}
function timelineOverlays(edit) {
  const overlays = [...(edit.overlays || [])]; let offset = 0;
  for (const [i, s] of playbackSegments(edit).entries()) {
    if (edit.segments?.length && s.label) overlays.push({ id: `label-${s.id}`, start: offset, end: offset + s.end - s.start, text: edit.kind === 'list' ? `${i + 1}/${edit.segments.length} · ${s.label}` : s.label, x: 50, y: 25, size: 52, color: edit.kind === 'transformation' && i === 0 ? '#b8b8b8' : edit.captions.accent, background: true });
    offset += s.end - s.start;
  }
  return overlays;
}
function sampleCaption(edit, sourceTime) {
  const segments = playbackSegments(edit);
  const s = segments.find(s => sourceTime >= s.start && sourceTime < s.end) || segments[0];
  const start = Number.isFinite(sourceTime) && sourceTime >= s.start && sourceTime < s.end - .1 ? sourceTime : s.start;
  return { start, end: Math.min(start + 3, s.end), text: edit.sampleCaption || '[예시] 자막의 위치와 크기를 확인하세요', sample: true };
}
function withSampleCaption(edit, sourceTime) {
  return { ...edit, items: [...edit.items.filter(c => !c.sample), sampleCaption(edit, sourceTime)], captions: { ...edit.captions, enabled: true } };
}
function normalizeCaptions(items, duration = 1800) {
  if (!Array.isArray(items)) throw fail('자막 목록 형식이 올바르지 않습니다.');
  return items.slice(0, 15000).map(c => ({ start: bounded(c.start, 0, duration), end: bounded(c.end, 0, duration), text: String(c.text || '').replace(/\u0000/g, '').trim().slice(0, 500), ...(c.sample === true ? { sample: true } : {}) }))
    .filter(c => c.text && c.end > c.start).sort((a, b) => a.start - b.start);
}
function parseSrt(text) {
  const stamp = s => { const m = /(\d+):(\d{2}):(\d{2})[,.](\d{1,3})/.exec(s); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4].padEnd(3, '0')) / 1000 : NaN; };
  return String(text).replace(/^\uFEFF/, '').split(/\r?\n\s*\r?\n/).flatMap(block => {
    const lines = block.split(/\r?\n/); const idx = lines.findIndex(line => line.includes('-->'));
    if (idx < 0) return [];
    const [a, b] = lines[idx].split('-->'); const start = stamp(a), end = stamp(b);
    return Number.isFinite(start) && end > start ? [{ start, end, text: lines.slice(idx + 1).join('\n').replace(/<[^>]+>/g, '') }] : [];
  });
}
function outputCaptions(items, start, end) {
  return items.filter(c => c.end > start && c.start < end).map(c => ({ ...c, start: Math.max(0, c.start - start), end: Math.min(end - start, c.end - start) }));
}
function toSrt(items) {
  const stamp = s => { const t = Math.round(Math.max(0, s) * 1000); return `${String(Math.floor(t / 3600000)).padStart(2, '0')}:${String(Math.floor(t / 60000) % 60).padStart(2, '0')}:${String(Math.floor(t / 1000) % 60).padStart(2, '0')},${String(t % 1000).padStart(3, '0')}`; };
  return items.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.text}`).join('\n\n') + '\n';
}
function youtubeUrl(value) {
  let u; try { u = new URL(String(value)); } catch { throw fail('유튜브 영상 링크를 입력해 주세요.'); }
  if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be'].includes(u.hostname)) throw fail('현재는 유튜브 단일 영상 링크를 지원합니다.');
  const id = u.hostname === 'youtu.be' ? u.pathname.split('/')[1] : u.pathname.startsWith('/shorts/') ? u.pathname.split('/')[2] : u.searchParams.get('v');
  if (!/^[\w-]{11}$/.test(id || '') || u.searchParams.has('list')) throw fail('재생목록이 아닌 단일 영상 링크를 입력해 주세요.');
  return `https://www.youtube.com/watch?v=${id}`;
}
function contained(root, file) {
  const rel = path.relative(path.resolve(root), path.resolve(file));
  if (rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw fail('허용된 작업 폴더 밖의 경로입니다.', 'UNSAFE_PATH');
  return path.resolve(file);
}
function fingerprint(file) { const s = fs.statSync(file); return createHash('sha256').update(`${path.resolve(file)}:${s.size}:${s.mtimeMs}`).digest('hex'); }
function makeProject(source, preset) {
  const now = new Date().toISOString();
  return { id: randomUUID(), title: source?.name || '새 쇼츠', createdAt: now, updatedAt: now, source, preset: clone(preset), revision: 1,
    edit: normalizeEdit({ ...preset, start: 0, end: Math.min(source?.duration || preset.duration, preset.duration), title: { ...preset.title, text: source?.name?.replace(/\.[^.]+$/, '') || '' }, items: [] }, source),
    outputs: [], candidates: [], messages: [], job: null, undo: [] };
}
module.exports = { PRESETS, clone, fail, bounded, normalizePreset, normalizeEdit, normalizeCaptions, parseSrt, outputCaptions, toSrt, youtubeUrl, contained, fingerprint, makeProject, playbackSegments, editDuration, timelineCaptions, timelineOverlays, sampleCaption, withSampleCaption };
