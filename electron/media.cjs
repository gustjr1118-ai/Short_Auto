const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { run } = require('./process.cjs');
const { makeNarration } = require('./narration.cjs');
const { fail, fingerprint, normalizeEdit, editDuration, playbackSegments, timelineCaptions, timelineOverlays, toSrt, parseSrt, normalizeCaptions } = require('./domain.cjs');
function toolPath(name, settings = {}) {
  const custom = settings[`${name}Path`]; if (custom) return custom;
  const executable = name === 'ytdlp' ? 'yt-dlp.exe' : `${name}.exe`;
  const localTool = path.join(__dirname, '..', 'assets', 'tools', executable);
  const packagedTool = process.resourcesPath ? path.join(process.resourcesPath, 'tools', executable) : '';
  if (packagedTool && fs.existsSync(packagedTool)) return packagedTool;
  if (fs.existsSync(localTool)) return localTool;
  if (name === 'ffmpeg' || name === 'ffprobe') {
    const pkg = name === 'ffmpeg' ? '@ffmpeg-installer/win32-x64' : '@ffprobe-installer/win32-x64';
    try { return path.join(path.dirname(require.resolve(`${pkg}/package.json`)), `${name}.exe`).replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep); } catch { return name; }
  }
  const bundled = path.join(__dirname, '..', 'assets', 'tools', 'yt-dlp.exe');
  return fs.existsSync(bundled) ? bundled : 'yt-dlp';
}
async function probe(file, settings, signal) {
  const result = await run(toolPath('ffprobe', settings), ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file], { signal, timeout: 30000 });
  let data; try { data = JSON.parse(result.stdout); } catch { throw fail('영상 정보를 읽지 못했습니다.', 'BAD_MEDIA'); }
  const video = data.streams?.find(s => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw fail('영상 스트림이 없는 파일입니다.', 'BAD_MEDIA');
  const duration = Number(data.format?.duration || video.duration);
  if (!(duration > 0)) throw fail('길이를 확인할 수 없는 영상입니다.', 'BAD_MEDIA');
  return { duration, width: video.width, height: video.height, codec: video.codec_name, hasAudio: data.streams.some(s => s.codec_type === 'audio'), size: Number(data.format.size || 0), fps: video.avg_frame_rate };
}
async function importSource(file, projectDir, settings, signal) {
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.size > 2 * 1024 ** 3) throw fail('2GB 이하의 영상 파일을 선택해 주세요.', 'MEDIA_LIMIT');
  const info = await probe(file, settings, signal);
  if (info.duration > 1800) throw fail('초기 버전은 30분 이하 원본을 지원합니다.', 'MEDIA_LIMIT');
  fs.mkdirSync(projectDir, { recursive: true });
  const thumb = path.join(projectDir, 'thumbnail.jpg');
  await run(toolPath('ffmpeg', settings), ['-y', '-ss', String(Math.min(1, info.duration / 2)), '-i', file, '-frames:v', '1', '-vf', 'scale=640:-2', thumb], { signal, timeout: 30000 });
  return { kind: 'file', path: path.resolve(file), name: path.basename(file), fingerprint: fingerprint(file), thumbnail: thumb, ...info };
}
const assColor = hex => `&H00${hex.slice(5, 7)}${hex.slice(3, 5)}${hex.slice(1, 3)}`;
function textPosition(style, title) {
  if (style.x === undefined || (style.x === 50 && style.align === 'center')) return '';
  const align = style.align === 'left' ? 1 : style.align === 'right' ? 3 : 2;
  const y = title ? style.position : 100 - style.position;
  return `{\\an${align + (title ? 6 : 0)}\\pos(${Math.round(style.x * 10.8)},${Math.round(y * 19.2)})}`;
}
function assText(text) { return String(text).replace(/\\/g, '＼').replace(/{/g, '｛').replace(/}/g, '｝').replace(/\r?\n/g, '\\N'); }
function assTime(seconds) {
  const t = Math.round(Math.max(0, seconds) * 100);
  return `${Math.floor(t / 360000)}:${String(Math.floor(t / 6000) % 60).padStart(2, '0')}:${String(Math.floor(t / 100) % 60).padStart(2, '0')}.${String(t % 100).padStart(2, '0')}`;
}
function wrap(text, width = 17) {
  return String(text).split('\n').flatMap(line => {
    const chars = Array.from(line); const result = [];
    while (chars.length > width) {
      const part = chars.slice(0, width + 1).join(''); const space = part.lastIndexOf(' ');
      const cut = space >= width / 2 ? space : width;
      result.push(chars.splice(0, cut).join('').trim()); if (chars[0] === ' ') chars.shift();
    }
    if (chars.length) result.push(chars.join('')); return result;
  }).join('\n');
}
function makeAss(edit, captions = timelineCaptions(edit)) {
  const duration = editDuration(edit);
  const titleLines = wrap(edit.title.text, 14).split('\n');
  const titleSize = Math.max(26, Math.min(edit.title.size, 900 / (Math.max(1, ...titleLines.map(s => s.length)) * .85)));
  const header = `[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\nWrapStyle: 0\nScaledBorderAndShadow: yes\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Caption,Malgun Gothic,${edit.captions.size},${assColor(edit.captions.color)},&H000000FF,${assColor(edit.captions.outline)},&H80000000,-1,0,0,0,100,100,0,0,${edit.captions.background ? 3 : 1},4,1,2,65,65,${Math.round(1920 * edit.captions.position / 100)},1\nStyle: Title,Malgun Gothic,${titleSize},${assColor(edit.title.color)},&H000000FF,&H00111111,&H50000000,-1,0,0,0,100,100,0,0,${edit.title.background ? 3 : 1},7,1,8,65,65,115,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n`;
  const events = [];
  if (edit.title.enabled && edit.title.text.trim()) events.push(`Dialogue: 1,${assTime(0)},${assTime(edit.title.seconds > 0 ? Math.min(duration, edit.title.seconds) : duration)},Title,,0,0,${Math.round(1920 * (edit.title.position || 6) / 100)},,${textPosition(edit.title, true)}${assText(titleLines.slice(0, 2).join('\n'))}`);
  if (edit.captions.enabled) {
    for (const c of captions) {
      const lines = wrap(c.text).split('\n');
      // Split long captions over time so the output never stacks more than two lines.
      for (let i = 0; i < lines.length; i += 2) {
      const groups = Math.ceil(lines.length / 2), group = i / 2;
      const start = c.start + (c.end - c.start) * group / groups, end = c.start + (c.end - c.start) * (group + 1) / groups;
      let text = assText(lines.slice(i, i + 2).join('\n'));
      const terms = edit.captions.highlight.split(',').map(t => t.trim()).filter(Boolean);
      for (const term of terms) text = text.split(assText(term)).join(`{\\c${assColor(edit.captions.accent)}&}${assText(term)}{\\c${assColor(edit.captions.color)}&}`);
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${textPosition(edit.captions, false)}${text}`);
      }
    }
  }
  for (const o of timelineOverlays(edit)) {
    if (!o.text.trim() || o.start >= duration) continue;
    const lines = wrap(o.text, 18).split('\n').slice(0, 2), text = assText(lines.join('\n'));
    const size = Math.max(16, Math.min(o.size, (Math.min(o.x, 100 - o.x) * 21.6 - 48) / (Math.max(1, ...lines.map(s => s.length)) * .85)));
    events.push(`Dialogue: 2,${assTime(o.start)},${assTime(Math.min(o.end, duration))},${o.background ? 'Overlay' : 'Caption'},,0,0,0,,{\\an5\\pos(${Math.round(o.x * 10.8)},${Math.round(o.y * 19.2)})\\fs${size}\\c${assColor(o.color)}&\\bord${o.background ? 10 : 4}\\3c&H111111&}${text}`);
  }
  const overlayStyle = 'Style: Overlay,Malgun Gothic,52,&H00FFFFFF,&H000000FF,&H00111111,&H80000000,-1,0,0,0,100,100,0,0,3,10,0,5,65,65,0,1';
  return header.replace('\n\n[Events]', `\n${overlayStyle}\n\n[Events]`) + events.join('\n') + '\n';
}
function layoutFilter(edit) {
  if (edit.layout === 'blur') return 'split=2[b][f];[b]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=20:2[bg];[f]scale=1080:1360:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1';
  if (edit.layout === 'crop') return `scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920:(iw-ow)*${edit.cropX / 100}:(ih-oh)*${edit.cropY / 100},setsar=1`;
  return 'scale=1080:1360:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0f0f0f,setsar=1';
}
function sourceMaskFilter(mask, base, tag) {
  if (!mask || mask.mode === 'off') return '';
  if (mask.mode === 'crop') return `crop=iw:trunc(ih*${1 - mask.cropBottom / 100}/2)*2:0:0,`;
  const start = Math.max(0, mask.start - base);
  if (mask.end !== null && mask.end <= base) return '';
  const enabled = mask.end === null ? `gte(t,${start})` : `between(t,${start},${mask.end - base})`;
  const x = mask.x / 100, y = mask.y / 100, w = mask.width / 100, h = mask.height / 100;
  if (mask.mode === 'box') return `drawbox=x=iw*${x}:y=ih*${y}:w=iw*${w}:h=ih*${h}:color=black:t=fill:enable='${enabled}',`;
  const g = `sg${tag}`, f = `sf${tag}`;
  const lumaRadius = `min(${mask.strength},max(0,floor(min(w,h)/2)-1))`;
  const chromaRadius = `min(${mask.strength},max(0,floor(min(cw,ch)/2)-1))`;
  return `split=2[${g}][${f}];[${f}]crop=iw*${w}:ih*${h}:iw*${x}:ih*${y},boxblur=luma_radius='${lumaRadius}':luma_power=2:chroma_radius='${chromaRadius}'[${f}blur];[${g}][${f}blur]overlay=x=main_w*${x}:y=main_h*${y}:enable='${enabled}',`;
}
function renderFilters(edit, hasAudio, hasBgm, hasNarration = false) {
  const segments = playbackSegments(edit), multiple = !!edit.segments?.length;
  const duration = editDuration(edit), fade = Math.min(edit.audio.fade, duration / 2);
  let graph;
  if (!multiple) {
    graph = `[0:v]setpts=PTS-STARTPTS,${sourceMaskFilter(edit.sourceMask, edit.start, 0)}${layoutFilter(edit)},fps=30,subtitles=subtitles.ass:fontsdir=fonts[v]`;
    if (hasAudio) graph += `;[0:a:0]asetpts=PTS-STARTPTS,aresample=async=1:first_pts=0,volume=${edit.audio.volume}[voice]`;
  } else {
    const n = segments.length, parts = [`[0:v]split=${n}${segments.map((_, i) => `[in${i}]`).join('')}`];
    if (hasAudio) parts.push(`[0:a:0]asplit=${n}${segments.map((_, i) => `[ain${i}]`).join('')}`);
    segments.forEach((s, i) => {
      const len = s.end - s.start;
      const layout = layoutFilter(s).replace(/\[(b|f|bg|fg)\]/g, (_, label) => `[${label}${i}]`);
      parts.push(`[in${i}]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS,${sourceMaskFilter(edit.sourceMask, s.start, i)}${layout},fps=30,format=yuv420p[v${i}]`);
      if (hasAudio) parts.push(`[ain${i}]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS,aresample=48000,apad,atrim=duration=${len},afade=t=in:d=0.015,afade=t=out:st=${Math.max(0, len - .015)}:d=0.015[a${i}]`);
    });
    parts.push(`${segments.map((_, i) => `[v${i}]${hasAudio ? `[a${i}]` : ''}`).join('')}concat=n=${n}:v=1:a=${hasAudio ? 1 : 0}[joined]${hasAudio ? '[joinedAudio]' : ''}`);
    parts.push('[joined]subtitles=subtitles.ass:fontsdir=fonts[v]');
    if (hasAudio) parts.push(`[joinedAudio]volume=${edit.audio.volume}[voice]`);
    graph = parts.join(';');
  }
  if (hasBgm) graph += `;[1:a:0]asetpts=PTS-STARTPTS,volume=${edit.audio.bgmVolume},afade=t=in:d=${fade},afade=t=out:st=${Math.max(0, duration - fade)}:d=${fade}[music]`;
  const bed = hasNarration ? 'bed' : 'a';
  if (hasAudio && hasBgm) graph += `;[voice][music]amix=inputs=2:duration=longest:normalize=0[${bed}]`;
  else if (hasAudio) graph += `;[voice]anull[${bed}]`;
  else if (hasBgm) graph += `;[music]anull[${bed}]`;
  if (hasNarration) {
    const voiceInput = hasBgm ? 2 : 1;
    if (hasAudio || hasBgm) {
      graph += `;[${voiceInput}:a]asplit=2[speech][side];[bed][side]sidechaincompress=threshold=0.025:ratio=8[ducked];[ducked][speech]amix=inputs=2:duration=longest:normalize=0,alimiter=limit=0.95:level=0:latency=1[a]`;
    } else graph += `;[${voiceInput}:a]anull[a]`;
  }
  return graph;
}
async function render(project, projectDir, settings, { signal, progress = () => {}, onNarration, captionRevision, preview = false, batchClipId } = {}) {
  if (!project.source?.path || !fs.existsSync(project.source.path)) throw fail('원본 파일이 없습니다. 다시 연결해 주세요.', 'SOURCE_MISSING');
  if (fingerprint(project.source.path) !== project.source.fingerprint) throw fail('원본 파일이 변경되었습니다. 원본을 다시 등록해 주세요.', 'SOURCE_CHANGED');
  const edit = normalizeEdit(project.edit, project.source), id = randomUUID(), duration = editDuration(edit);
  if (!(duration > 0 && duration <= 60.01)) throw fail('원본 안에서 60초 이하 구간을 선택해 주세요.');
  const previous = captionRevision?.previous;
  if (previous && !fs.existsSync(previous.path)) throw fail('기존 완성본 MP4를 찾을 수 없습니다. 파일을 원래 위치에 놓은 뒤 다시 시도해 주세요.', 'OUTPUT_MISSING');
  const previousAudio = previous ? (await probe(previous.path, settings, signal)).hasAudio : false;
  const captions = captionRevision?.items ?? timelineCaptions(edit);
  const dir = path.join(projectDir, 'renders', id); fs.mkdirSync(path.join(dir, 'fonts'), { recursive: true });
  const fontPath = path.join(process.env.WINDIR || 'C:\\Windows', 'Fonts', 'malgunbd.ttf');
  if (fs.existsSync(fontPath)) fs.copyFileSync(fontPath, path.join(dir, 'fonts', 'malgunbd.ttf'));
  fs.writeFileSync(path.join(dir, 'subtitles.ass'), makeAss(edit, captions), 'utf8');
  fs.writeFileSync(path.join(dir, 'captions.srt'), toSrt(captions), 'utf8');
  const bgm = previous ? '' : edit.audio.bgmPath;
  if (bgm && !fs.existsSync(bgm)) throw fail('배경음악 파일을 찾지 못했습니다. 다시 선택해 주세요.', 'BGM_MISSING');
  const hasBgm = !!bgm && edit.audio.bgmVolume > 0;
  const narration = previous ? null : await makeNarration(edit, preview && project.directory ? project.directory : projectDir, dir, settings, toolPath, signal, onNarration);
  const hasAudio = !previous && project.source.hasAudio && (!narration || edit.audio.narrationMode !== 'replace');
  const args = ['-y', ...(edit.segments.length ? [] : ['-ss', String(edit.start)]), '-i', project.source.path];
  if (hasBgm) args.push('-stream_loop', '-1', '-i', bgm);
  if (narration) args.push('-i', narration);
  if (previousAudio) args.push('-i', previous.path);
  const filters = renderFilters(edit, hasAudio, hasBgm, !!narration) + (preview ? ';[v]scale=540:960[preview]' : '');
  fs.writeFileSync(path.join(dir, 'filters.txt'), filters, 'utf8');
  args.push('-filter_complex_threads', '1', '-filter_complex', filters, '-map', preview ? '[preview]' : '[v]');
  if (hasAudio || hasBgm || narration) args.push('-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000');
  if (previousAudio) args.push('-map', '1:a:0', '-c:a', 'copy');
  args.push('-t', String(duration), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-pix_fmt', 'yuv420p', '-threads', '2', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', 'final.partial.mp4');
  await run(toolPath('ffmpeg', settings), args, { cwd: dir, signal, onLine: line => {
    const m = /^out_time_ms=(\d+)/.exec(line); if (m) progress(Math.min(98, Number(m[1]) / 1000000 / duration * 100));
  } });
  const outputFile = path.join(dir, 'final.partial.mp4');
  const info = await probe(outputFile, settings, signal);
  if (info.width !== (preview ? 540 : 1080) || info.height !== (preview ? 960 : 1920) || Math.abs(info.duration - duration) > .1 || ((previousAudio || hasAudio || hasBgm || narration) && !info.hasAudio)) throw fail('출력 규격 검증에 실패했습니다.', 'RENDER_VALIDATION');
  const finalFile = path.join(dir, 'final.mp4'); fs.renameSync(outputFile, finalFile);
  const result = { id, revision: project.revision, path: finalFile, captionsPath: path.join(dir, 'captions.srt'), createdAt: new Date().toISOString(), duration: info.duration, size: info.size, edit, presetName: project.preset.name };
  if (batchClipId || previous?.batchClipId) result.batchClipId = batchClipId || previous.batchClipId;
  if (previous) Object.assign(result, { captionRevisionOf: previous.id, captionItems: captions, presetName: previous.presetName });
  fs.writeFileSync(path.join(dir, 'render-manifest.json'), JSON.stringify({ ...result, sourceFingerprint: project.source.fingerprint }, null, 2));
  return result;
}
async function download(url, projectDir, settings, signal, onLine) {
  const dir = path.join(projectDir, 'source'); fs.mkdirSync(dir, { recursive: true });
  const result = await run(toolPath('ytdlp', settings), ['--no-playlist', '--no-progress', '--newline', '--write-info-json', '--js-runtimes', `node:${process.execPath}`, '--remote-components', 'ejs:github', '--max-filesize', '2G', '--match-filter', 'duration <= 1800 & !is_live', '-f', 'bv*[height<=1080]+ba/b[height<=1080]', '--merge-output-format', 'mp4', '--ffmpeg-location', toolPath('ffmpeg', settings), '--print', 'after_move:filepath', '-o', path.join(dir, 'source.%(ext)s'), url], { signal, timeout: 1200000, onLine, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
  const finalName = /^source\.(mp4|mkv|webm|mov)$/i;
  const files = fs.readdirSync(dir).filter(name => finalName.test(name));
  const reportedFile = result.stdout.split(/\r?\n/).map(line => line.trim()).reverse().find(line =>
    path.isAbsolute(line) && path.resolve(path.dirname(line)) === path.resolve(dir) && files.includes(path.basename(line)));
  const file = reportedFile || (files.length === 1 ? path.join(dir, files[0]) : null);
  if (!file) throw fail('다운로드가 끝난 원본을 확인하지 못했습니다. 다시 가져오거나 영상 파일을 직접 선택해 주세요.', 'DOWNLOAD_FAILED');
  const source = await importSource(file, projectDir, settings, signal);
  let info = {};
  try { info = JSON.parse(fs.readFileSync(path.join(dir, 'source.info.json'), 'utf8')) || {}; } catch { /* metadata is optional */ }
  if (Number.isFinite(info.duration) && source.duration + 2 < info.duration) {
    throw fail(`다운로드한 영상이 링크의 전체 길이보다 짧습니다. 링크 원본 ${Math.round(info.duration)}초 · 받은 파일 ${Math.round(source.duration)}초입니다.`, 'SOURCE_INCOMPLETE');
  }
  return { ...source, kind: 'url', url, name: info.title || 'YouTube 원본 영상' };
}
async function downloadCaptions(source, projectDir, settings, signal) {
  if (source.kind !== 'url' || !source.url) return [];
  const language = settings.transcriptionLanguage === 'auto' ? 'ko' : settings.transcriptionLanguage;
  const dir = path.join(projectDir, 'analysis');
  fs.mkdirSync(dir, { recursive: true });
  const cache = path.join(dir, `youtube-cc-${language}.json`);
  try {
    const cached = JSON.parse(fs.readFileSync(cache, 'utf8'));
    if (cached.fingerprint === source.fingerprint && cached.items.length) return cached.items;
  } catch { /* No reusable captions. */ }
  const temp = fs.mkdtempSync(path.join(dir, 'cc-'));
  try {
    await run(toolPath('ytdlp', settings), [
      '--no-playlist', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', language,
      '--sub-format', 'vtt/best', '--convert-subs', 'srt', '--ffmpeg-location', toolPath('ffmpeg', settings),
      '--js-runtimes', `node:${process.execPath}`, '--remote-components', 'ejs:github',
      '-o', path.join(temp, 'captions.%(ext)s'), source.url,
    ], { signal, timeout: 90_000, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } });
    const file = path.join(temp, `captions.${language}.srt`);
    if (!fs.existsSync(file)) return [];
    const items = normalizeCaptions(parseSrt(fs.readFileSync(file, 'utf8')), source.duration);
    if (items.length) fs.writeFileSync(cache, JSON.stringify({ fingerprint: source.fingerprint, items }), 'utf8');
    return items;
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  } finally {
    for (const file of fs.readdirSync(temp)) { try { fs.unlinkSync(path.join(temp, file)); } catch {} }
    try { fs.rmdirSync(temp); } catch {}
  }
}
module.exports = { toolPath, probe, importSource, makeAss, assText, renderFilters, render, download, downloadCaptions };
