const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fail, fingerprint, parseSrt, normalizeCaptions } = require('./domain.cjs');
const { toolPath } = require('./media.cjs');
const { run } = require('./process.cjs');

function existingFile(file) {
  return typeof file === 'string' && path.isAbsolute(file) && !!fs.statSync(file, { throwIfNoEntry: false })?.isFile();
}

function resolveWhisper(settings = {}) {
  const windows = process.platform === 'win32';
  const exeName = windows ? 'whisper-cli.exe' : 'whisper-cli';
  const modelName = 'ggml-base-q5_1.bin';
  const dirs = [
    ...(process.resourcesPath ? [path.join(process.resourcesPath, 'tools', 'whisper')] : []),
    path.join(__dirname, '..', 'assets', 'tools', 'whisper'),
  ];
  const findBundled = name => dirs.map(dir => path.join(dir, name)).find(existingFile);
  const validExe = file => existingFile(file) && (!windows || path.extname(file).toLowerCase() === '.exe');
  const exe = validExe(settings.whisperPath) ? settings.whisperPath : findBundled(exeName) ||
    (process.env.PATH || '').split(path.delimiter).filter(Boolean).map(dir => path.join(dir, exeName)).find(validExe);
  const model = existingFile(settings.whisperModelPath) ? settings.whisperModelPath : findBundled(modelName);
  return { exe: exe || '', model: model || '', fallback: !!((settings.whisperPath && exe !== settings.whisperPath) || (settings.whisperModelPath && model !== settings.whisperModelPath)) };
}

async function transcribeLocal(source, projectDir, settings, signal, range) {
  if (!source.hasAudio) throw fail('원본에 오디오가 없습니다. SRT를 가져오거나 구간을 직접 지정해 주세요.', 'NO_AUDIO');
  const { exe, model } = resolveWhisper(settings);
  if (!exe || !model) {
    throw fail('기본 Whisper 전사 파일을 찾지 못했습니다. 0.3.1 이상의 전체 배포 폴더로 실행하거나, 설정 → AI·음성 전사에서 실행 파일과 모델을 지정해 주세요.', 'WHISPER_SETUP');
  }
  const language = ['auto', 'ko', 'en', 'ja'].includes(settings.transcriptionLanguage) ? settings.transcriptionLanguage : 'auto';
  const key = createHash('sha256').update(JSON.stringify([source.fingerprint || fingerprint(source.path), fingerprint(exe), fingerprint(model), language,
    ...(range ? [range.start, range.end] : [])])).digest('hex');
  const start = range?.start ?? 0;
  const duration = range ? range.end - range.start : source.duration;
  const dir = path.join(projectDir, 'analysis');
  fs.mkdirSync(dir, { recursive: true });
  const cache = path.join(dir, 'whisper-' + key + '.json');
  try {
    const cached = normalizeCaptions(JSON.parse(fs.readFileSync(cache, 'utf8')), source.duration);
    if (cached.length) return cached;
  } catch { /* Missing or unreadable cache. */ }
  const jobDir = fs.mkdtempSync(path.join(dir, 'whisper-'));
  const audio = path.join(jobDir, 'source.wav');
  const prefix = path.join(jobDir, 'output');
  try {
    await run(toolPath('ffmpeg', settings), ['-y', ...(range ? ['-ss', String(start)] : []), '-i', source.path,
      ...(range ? ['-t', String(duration)] : []), '-map', '0:a:0', '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audio], { signal });
    await run(exe, ['-m', model, '-f', audio, '-l', language, '-osrt', '-of', prefix, '-ng'], { cwd: jobDir, signal, timeout: 60 * 60 * 1000 });
    const file = prefix + '.srt';
    const items = fs.existsSync(file) ? normalizeCaptions(parseSrt(fs.readFileSync(file, 'utf8')), duration)
      .map(row => ({ ...row, start: row.start + start, end: row.end + start })) : [];
    if (!items.length) throw fail('로컬 전사에서 사용할 자막을 찾지 못했습니다. 음성 또는 모델을 확인해 주세요.', 'STT_EMPTY');
    fs.writeFileSync(cache, JSON.stringify(items), 'utf8');
    return items;
  } finally {
    // Remove only files produced by this invocation.
    for (const file of [audio, prefix + '.srt']) { try { fs.unlinkSync(file); } catch {} }
    try { fs.rmdirSync(jobDir); } catch {}
  }
}

module.exports = { transcribeLocal, resolveWhisper };
