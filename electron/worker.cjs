const path = require('node:path');
const fs = require('node:fs');
const { render, download, downloadCaptions } = require('./media.cjs');
const { transcribe, recommend, editWithAi } = require('./ai.cjs');
const { analyzeBatch, clipEdit } = require('./batch.cjs');
const { extractFrames } = require('./highlights.cjs');
const { generateCaptions } = require('./caption-script.cjs');
const { normalizeEdit, contained, fail } = require('./domain.cjs');
const { captionOutput } = require('./output-captions.cjs');
const send = data => process.parentPort ? process.parentPort.postMessage(data) : process.send?.(data);
const controller = new AbortController();
const progress = (stage, message, value = null) => send({ type: 'progress', stage, message, progress: value });
async function execute({ project, dir, settings, action, request, auto, review, ...options }) {
  if (action === 'output-captions') {
    const previous = captionOutput(project, options.outputId);
    const edit = { ...previous.edit, captions: { ...previous.edit.captions, enabled: true } };
    progress('render', '완성본의 구간과 소리를 유지하며 자막을 적용하고 있습니다.', 0);
    const output = await render({ ...project, edit, revision: null }, dir, settings, {
      signal: controller.signal, captionRevision: { previous, items: options.items },
      progress: value => progress('render', '수정한 자막을 영상에 적용하고 있습니다.', value),
    });
    progress('verify', '수정된 MP4와 SRT를 확인했습니다.', 100);
    return { action, output, summary: '수정한 자막을 적용한 MP4와 SRT를 새 버전으로 제작했습니다.' };
  }
  project.edit = normalizeEdit(project.edit, project.source);
  if (auto && project.edit.segments.length) throw fail('여러 구간을 연결한 편집은 자동 추천을 끄고 제작해 주세요. 선택한 순서를 유지합니다.', 'MULTI_AUTO');
  if (!project.source?.path) {
    progress('source', '유튜브 원본을 준비하고 있습니다.');
    project.source = await download(project.source.url, dir, settings, controller.signal);
    project.edit = normalizeEdit({ ...project.edit, end: Math.min(project.source.duration, project.edit.start + project.edit.duration) }, project.source);
    send({ type: 'source', source: project.source, edit: project.edit });
  }
  if (action === 'prepare') return { action };
  if (['clip-transcribe', 'clip-ai', 'clip-preview'].includes(action)) {
    const clip = project.batch?.clips.find(item => item.id === options.clipId);
    if (!clip) throw fail('편집할 쇼츠를 찾지 못했습니다.', 'CLIP_MISSING');
    const edit = clipEdit(project, clip);
    if (action === 'clip-preview') {
      progress('render', '쇼츠 미리보기를 합성하고 있습니다.', 0);
      const previewWork = fs.mkdtempSync(path.join(dir, 'clip-preview-work-'));
      try {
        const output = await render({ ...project, edit }, previewWork, settings, {
          signal: controller.signal, preview: true,
          progress: value => progress('render', '쇼츠 미리보기를 합성하고 있습니다.', value),
        });
        controller.signal.throwIfAborted();
        const file = path.join(dir, 'clip-preview-' + output.id + '.mp4');
        fs.renameSync(output.path, file);
        return { action, clipPreview: { id: output.id, path: file }, summary: '합성 미리보기가 준비되었습니다.' };
      } finally {
        fs.rmSync(contained(dir, previewWork), { recursive: true, force: true });
      }
    }
    if (action === 'clip-ai') {
      progress('analysis', '선택한 쇼츠의 편집 요청을 처리하고 있습니다.');
      const result = await editWithAi(request, { ...project, edit }, path.join(dir, 'ai-workspace'), { ...settings, aiEngine: 'codex' }, controller.signal);
      return { action, clipId: clip.id, clipEdit: result.edit, summary: result.summary };
    }
    progress('transcribe', '선택한 구간의 대사를 추출하고 있습니다.');
    const inside = c => !c.sample && c.start < edit.end && c.end > edit.start;
    let items = project.edit.items.filter(inside);
    if (!items.length) items = (project.batch.transcript || []).filter(inside);
    if (!items.length) items = await transcribe(project.source, dir, settings, controller.signal, { start: edit.start, end: edit.end });
    if (!items.length) throw fail('선택 구간에서 대사를 찾지 못했습니다. 직접 입력하거나 SRT를 가져올 수 있습니다.', 'CAPTION_EMPTY');
    return { action, clipId: clip.id, clipEdit: { ...edit, items, captions: { ...edit.captions, enabled: true } },
      summary: '선택한 쇼츠의 자막을 추출했습니다.' };
  }
  if (action === 'edit') {
    progress('analysis', '편집 요청을 해석하고 있습니다.');
    return { ...await editWithAi(request, project, path.join(dir, 'ai-workspace'), settings, controller.signal), action: 'edit' };
  }
  if (action === 'transcribe' || action === 'caption-script' || auto) {
    if (!project.edit.items.some(c => !c.sample) || action === 'transcribe') {
      let captions = [];
      if (settings.preferYouTubeCC && project.source.kind === 'url') {
        progress('transcribe', '유튜브에 제공된 자막을 확인하고 있습니다.');
        captions = await downloadCaptions(project.source, dir, settings, controller.signal);
      }
      if (!captions.length) {
        progress('transcribe', '원본 음성을 전사하고 있습니다.');
        captions = await transcribe(project.source, dir, settings, controller.signal);
      }
      project.edit.items = [...project.edit.items.filter(c => c.sample), ...captions];
    }
    send({ type: 'edit', edit: project.edit });
    if (action === 'transcribe') return { action, edit: project.edit };
  }
  if (action === 'caption-script') {
    progress('analysis', '선택한 구간의 자막 문구를 준비하고 있습니다.');
    return { action, edit: await generateCaptions(project, options.captionMode, path.join(dir, 'ai-workspace'), settings, controller.signal) };
  }
  if (action === 'batch-analyze') {
    progress('frames', '원본 전체에서 대표 장면을 추출하고 있습니다.');
    const frames = await extractFrames(project, dir, settings, controller.signal).catch(error => {
      if (controller.signal.aborted) throw error;
      return [];
    });
    let transcript = project.edit.items.filter(c => !c.sample);
    if (!transcript.length && project.source.hasAudio) {
      progress('transcribe', '추천에 참고할 원본 대사를 확인하고 있습니다.');
      transcript = await (async () => {
        if (settings.preferYouTubeCC && project.source.kind === 'url') {
          const cc = await downloadCaptions(project.source, dir, settings, controller.signal);
          if (cc.length) return cc;
        }
        return await transcribe(project.source, dir, settings, controller.signal);
      })().catch(error => {
        if (controller.signal.aborted) throw error;
        return [];
      });
    }
    if (!frames.length && !transcript.length) throw fail('분석할 장면과 대사를 확보하지 못했습니다. 원본을 확인하거나 구간을 직접 추가해 주세요.', 'BATCH_NO_EVIDENCE');
    const analysisProject = { ...project, edit: { ...project.edit, items: transcript } };
    project.batch = await analyzeBatch(analysisProject, options, path.join(dir, 'ai-workspace'), settings, controller.signal,
      (index, total) => progress('analysis', `Codex로 ${frames.length ? '장면·대사' : '대사'}를 분석 중입니다. (${index}/${total})`, 100 * (index - 1) / total), frames);
    project.batch.transcript = transcript;
    send({ type: 'batch', batch: project.batch });
    return { action: 'batch-review', summary: `요청 ${options.count}편 중 ${project.batch.clips.length}편을 추천했습니다. 구간을 확인해 주세요.` };
  }
  if (action === 'batch-render') {
    const clips = options.clipIds.map(id => {
      const clip = project.batch.clips.find(clip => clip.id === id);
      const start = options.clipStarts?.[id];
      return start !== undefined && start !== clip.start ? { ...clip, start, end: start + project.batch.length, edit: null } : clip;
    });
    let succeeded = 0;
    for (const [index, clip] of clips.entries()) {
      controller.signal.throwIfAborted();
      try {
        const edit = clipEdit(project, clip);
        send({ type: 'batch-clip', id: clip.id, edit, start: clip.start, end: clip.end, status: 'running', error: '' });
        const preset = { ...project.preset, name: clip.presetName || project.preset.name };
        const output = await render({ ...project, edit, preset, revision: null }, dir, settings, {
          signal: controller.signal, batchClipId: clip.id, onNarration: message => progress('render', message),
          progress: value => progress('render', `${index + 1}/${clips.length}편 제작 중 · ${clip.title}`, (index + value / 100) * 100 / clips.length),
        });
        send({ type: 'batch-clip', id: clip.id, status: 'completed', output });
        succeeded++;
      } catch (error) {
        if (controller.signal.aborted) throw error;
        send({ type: 'batch-clip', id: clip.id, status: 'failed', error: String(error.message).slice(0, 500) });
      }
    }
    if (succeeded === clips.length) progress('verify', '제작한 영상과 자막 파일을 확인했습니다.', 100);
    return { action, summary: `${clips.length}편 중 ${succeeded}편 완료 · 실패 ${clips.length - succeeded}편`, partial: succeeded !== clips.length };
  }
  if (auto) {
    progress('analysis', '핵심 구간 후보를 선정하고 있습니다.');
    project.candidates = await recommend(project.edit.items.filter(c => !c.sample), project.source, project.edit.duration, path.join(dir, 'ai-workspace'), settings, controller.signal, project.edit.kind);
    if (!project.candidates.length) throw new Error('추천 가능한 구간이 없습니다. 시작과 종료를 직접 지정해 주세요.');
    const candidate = project.candidates[0];
    project.edit = normalizeEdit({ ...project.edit, start: candidate.start, end: candidate.end, title: { ...project.edit.title, text: candidate.title } }, project.source);
    send({ type: 'edit', edit: project.edit, candidates: project.candidates });
    if (review) return { action: 'review', edit: project.edit, candidates: project.candidates };
  }
  progress('render', '프리셋에 맞춰 쇼츠를 합성하고 있습니다.', 0);
  const output = await render(project, dir, settings, { signal: controller.signal, onNarration: message => progress('render', message), progress: value => progress('render', '제목·자막·원음을 합성하고 있습니다.', value) });
  progress('verify', '출력 영상 규격을 검증했습니다.', 100);
  return { action: 'render', output, edit: project.edit, candidates: project.candidates };
}
const receive = async message => {
  if (message.type === 'cancel') { controller.abort(); return; }
  if (message.type !== 'start') return;
  message.settings.onCodexEvent = event => send({ type: 'codex', event });
  try { send({ type: 'result', result: await execute(message) }); }
  catch (error) { send({ type: 'error', code: controller.signal.aborted ? 'CANCELLED' : error.code || 'FAILED', message: controller.signal.aborted ? '작업을 취소했습니다.' : error.message }); }
};
if (process.parentPort) process.parentPort.on('message', event => receive(event.data));
else process.on('message', receive);
