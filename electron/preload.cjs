const { contextBridge, ipcRenderer, webUtils } = require('electron');
const invoke = (name, payload) => ipcRenderer.invoke(`studio:${name}`, payload);
contextBridge.exposeInMainWorld('studio', {
  bootstrap: () => invoke('bootstrap'),
  codexAccount: () => invoke('codex-account'),
  codexActivity: () => invoke('codex-activity'),
  saveClipEdit: (id, clipId, edit, presetId) => invoke('save-clip-edit', { id, clipId, edit, presetId }),
  confirmClips: (id, clipIds) => invoke('confirm-clips', { id, clipIds }),
  copyClipCustomization: (id, clipId, targets, title, mask) => invoke('copy-clip-customization', { id, clipId, targets, title, mask }),
  addManualClip: (id, start, length, count) => invoke('add-manual-clip', { id, start, length, count }),
  removeClip: (id, clipId) => invoke('remove-clip', { id, clipId }),
  swapBatch: id => invoke('swap-batch', { id }),
  translateClipSrt: (id, clipId, items) => invoke('translate-clip-srt', { id, clipId, items }),
  importClipSrt: (id, clipId) => invoke('import-clip-srt', { id, clipId }),
  onCodexActivity: callback => {
    const listener = (_event, activity) => callback(activity);
    ipcRenderer.on('studio:codex-activity', listener);
    return () => ipcRenderer.removeListener('studio:codex-activity', listener);
  },
  importFile: (file) => invoke('import-file', file ? { path: webUtils.getPathForFile(file) } : {}),
  importUrl: (url) => invoke('import-url', { url }),
  saveEdit: (id, edit) => invoke('save-edit', { id, edit }),
  addSampleCaption: (id, sourceTime) => invoke('add-sample-caption', { id, sourceTime }),
  rename: (id, title) => invoke('rename', { id, title }),
  duplicate: id => invoke('duplicate', { id }),
  archive: id => invoke('archive', { id }),
  undo: id => invoke('undo', { id }),
  applyPreset: (id, presetId) => invoke('apply-preset', { id, presetId }),
  savePreset: preset => invoke('save-preset', { preset }),
  deletePreset: id => invoke('delete-preset', { id }),
  importPreset: () => invoke('import-preset'),
  exportPreset: id => invoke('export-preset', { id }),
  importSrt: id => invoke('import-srt', { id }),
  readOutputSrt: (id, outputId) => invoke('read-output-srt', { id, outputId }),
  importOutputSrt: (id, outputId) => invoke('import-output-srt', { id, outputId }),
  translateOutputSrt: (id, outputId, items) => invoke('translate-output-srt', { id, outputId, items }),
  cancelOutputTranslation: id => invoke('cancel-output-translation', { id }),
  chooseBgm: id => invoke('choose-bgm', { id }),
  run: (id, options) => invoke('run', { id, options }),
  openOutputProject: (id, outputId) => invoke('open-output-project', { id, outputId }),
  cancel: id => invoke('cancel', { id }),
  requestEdit: (id, request) => invoke('request-edit', { id, request }),
  saveSettings: settings => invoke('save-settings', { settings }),
  diagnose: () => invoke('diagnose'),
  selectPath: kind => invoke('select-path', { kind }),
  exportVideo: (id, outputId, captions) => invoke('export-video', { id, outputId, captions }),
  openFolder: id => invoke('open-folder', { id }),
  window: action => invoke('window', { action }),
  onProject: callback => {
    const listener = (_event, project) => callback(project);
    ipcRenderer.on('studio:project', listener);
    return () => ipcRenderer.removeListener('studio:project', listener);
  },
});
