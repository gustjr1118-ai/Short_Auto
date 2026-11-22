const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fail, fingerprint, editDuration, timelineCaptions } = require('./domain.cjs');
const { run } = require('./process.cjs');

function narrationSlots(edit) {
  const captions = timelineCaptions(edit).filter(c => !c.sample).sort((a, b) => a.start - b.start);
  return captions.map((c, index) => ({ ...c, end: Math.min(c.end, captions[index + 1]?.start ?? Infinity) }));
}

async function makeNarration(edit, projectDir, renderDir, settings, toolPath, signal, progress) {
  if (edit.audio.narrationMode === 'off') return null;
  const python = settings.ttsPythonPath, model = settings.ttsModelPath;
  if (!python || !model || !path.isAbsolute(python) || !path.isAbsolute(model) ||
      !fs.existsSync(python) || !fs.existsSync(path.join(model, 'config.json')) ||
      (process.platform === 'win32' && path.extname(python).toLowerCase() !== '.exe')) {
    throw fail('설정 → AI·음성 전사에서 Qwen3-TTS가 설치된 Python 실행 파일과 로컬 CustomVoice 모델 폴더를 선택해 주세요.', 'TTS_SETUP');
  }
  const slots = narrationSlots(edit);
  if (!slots.length) throw fail('AI가 읽을 대사 자막을 추가해 주세요. 예시 자막은 건너뜁니다.', 'TTS_EMPTY');
  if (slots.length > 120) throw fail('AI 음성에 사용할 자막은 한 편에 최대 120개입니다.', 'TTS_LIMIT');
  const invalid = slots.find(slot => slot.end - slot.start < 0.15);
  if (invalid) throw fail(`${invalid.start.toFixed(1)}초 근처의 자막 시간이 겹치거나 짧습니다. 자막 시간 또는 문구를 조정해 주세요.`, 'TTS_OVERLAP');

  const cache = path.join(projectDir, 'analysis', 'tts');
  fs.mkdirSync(cache, { recursive: true });
  const identity = [fingerprint(python), fingerprint(path.join(model, 'config.json')), fs.statSync(model).mtimeMs, edit.audio.narrationVoice, 'Korean', 'v1'];
  const entries = slots.map(slot => {
    const id = createHash('sha256').update(JSON.stringify([...identity, slot.text])).digest('hex');
    return { ...slot, id, file: path.join(cache, id + '.wav') };
  });
  const missing = [...new Map(entries.filter(row => !fs.existsSync(row.file)).map(row => [row.id, row])).values()];
  if (missing.length) {
    progress?.('AI 음성을 합성하고 있습니다.');
    const script = path.join(renderDir, 'qwen_cli.py'), request = path.join(renderDir, 'tts-request.json');
    fs.writeFileSync(script, fs.readFileSync(path.join(__dirname, 'qwen_cli.py')));
    fs.writeFileSync(request, JSON.stringify({
      speaker: edit.audio.narrationVoice, language: 'Korean', lines: missing.map(row => ({ id: row.id, text: row.text })),
    }), 'utf8');
    try {
      await run(python, [script, model, request], { cwd: renderDir, signal, timeout: 30 * 60_000,
        env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', PYTHONUTF8: '1' } });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw fail('로컬 Qwen3-TTS 음성 생성에 실패했습니다. Python 환경과 모델을 확인해 주세요.\n' + error.message, 'TTS_FAILED');
    }
    for (const row of missing) {
      const wav = path.join(renderDir, row.id + '.wav');
      if (!fs.existsSync(wav) || fs.statSync(wav).size < 45) throw fail('음성 엔진에서 WAV 결과를 받지 못했습니다.', 'TTS_FAILED');
      fs.renameSync(wav, row.file);
    }
  }
  progress?.('낭독 길이와 자막 시간을 맞추고 있습니다.');
  const args = ['-y'], filters = [];
  for (const [i, row] of entries.entries()) {
    const result = await run(toolPath('ffprobe', settings), ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', row.file], { signal, timeout: 15_000 });
    const duration = Number(result.stdout.trim()), slot = row.end - row.start;
    if (!Number.isFinite(duration) || duration <= 0 || duration > slot * 1.2) {
      throw fail(`${row.start.toFixed(1)}초의 낭독이 자막 시간보다 깁니다. 문구를 줄이거나 자막 시간을 늘려 주세요. “${row.text.slice(0, 35)}”`, 'TTS_TIMING');
    }
    args.push('-i', row.file);
    const tempo = Math.max(1, duration / slot);
    filters.push(`[${i}:a]aresample=48000,atempo=${tempo},adelay=${Math.round(row.start * 1000)}:all=1[n${i}]`);
  }
  const fullDuration = editDuration(edit);
  const inputs = entries.map((_, i) => `[n${i}]`).join('');
  const mix = entries.length === 1 ? '' : `amix=inputs=${entries.length}:normalize=0,`;
  filters.push(`${inputs}${mix}apad=whole_dur=${fullDuration},atrim=duration=${fullDuration}[narration]`);
  const out = path.join(renderDir, 'narration.wav');
  await run(toolPath('ffmpeg', settings), [...args, '-filter_complex_threads', '1', '-filter_complex', filters.join(';'), '-map', '[narration]', '-t', String(fullDuration), '-c:a', 'pcm_s16le', out], { signal, timeout: 120_000 });
  return out;
}

module.exports = { makeNarration, narrationSlots };
