export interface Caption { start: number; end: number; text: string; sample?: boolean }
export interface SourceMask { mode: 'off' | 'blur' | 'box' | 'crop'; x: number; y: number; width: number; height: number; start: number; end: number | null; strength: number; cropBottom: number }
export interface Segment { id: string; start: number; end: number; label: string; layout: Preset['layout']; cropX: number; cropY: number }
export interface Overlay { id: string; start: number; end: number; text: string; x: number; y: number; size: number; color: string; background: boolean }
export interface Preset {
  id: string; schemaVersion: number; name: string; description: string; builtin: boolean;
  kind: 'style' | 'story' | 'tutorial' | 'product' | 'transformation' | 'list'; sampleCaption: string;
  duration: number; layout: 'crop' | 'fit' | 'blur'; cropX: number; cropY: number;
  title: { enabled: boolean; text: string; size: number; color: string; background: boolean; seconds: number; position: number; x: number; align: 'left' | 'center' | 'right' };
  captions: { enabled: boolean; size: number; color: string; outline: string; accent: string; highlight: string; background: boolean; position: number; x: number; align: 'left' | 'center' | 'right' };
  audio: { volume: number; bgmVolume: number; bgmPath: string; fade: number; narrationMode: 'off' | 'mix' | 'replace'; narrationVoice: string };
}
export interface Edit extends Preset { start: number; end: number; items: Caption[]; segments: Segment[]; overlays: Overlay[]; sourceMask: SourceMask }
export interface Source { kind: 'file' | 'url'; name: string; path?: string; url?: string; duration?: number; width?: number; height?: number; hasAudio?: boolean; mediaUrl: string; thumbnailUrl: string }
export interface Output { id: string; revision: number | null; path: string; createdAt: string; duration: number; size: number; mediaUrl: string; edit: Edit; presetName: string; batchClipId?: string; captionRevisionOf?: string }
export interface Candidate { id: string; start: number; end: number; title: string; reason: string; method: string }
export interface CodexWindow { id: string; name: string; period: 'primary' | 'secondary'; minutes: number | null; remaining: number; resetsAt: number | null }
export interface CodexAccount {
  state: 'connected' | 'missing' | 'login' | 'offline' | 'unsupported' | 'unavailable';
  mode?: string; checkedAt: number; lastSuccess?: number; windows: CodexWindow[];
}
export interface CodexUsage { input: number; output: number; cached: number | null; reasoning: number | null }
export interface CodexRecord { id: string; at: number; projectId: string; jobId: string; model: string; usage: CodexUsage | null }
export interface CodexActivity { active: number; rows: CodexRecord[] }
export interface Job { id: string; state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted' | 'needs_input'; stage: string; message: string; progress: number | null; code?: string; runOptions?: RunOptions; clipId?: string; clipPreview?: { mediaUrl: string }; action?: string; createdAt?: string; endedAt?: string; trace?: { at: string; stage: string; state: string; message: string; clipId?: string }[] }
export interface BatchClip { id: string; start: number; end: number; recommendedStart?: number; recommendedEnd?: number; title: string; reason: string; evidence: string; status?: 'running' | 'completed' | 'failed' | 'interrupted'; outputId?: string; error?: string; edit?: Edit; presetId?: string; presetName?: string; confirmed?: boolean; needsRender?: boolean; thumbnailUrl?: string; score?: number; evidenceKind?: 'scene' | 'speech' | 'manual' }
export interface Batch { id: string; length: number; count: number; clips: BatchClip[]; method?: 'visual' | 'speech' | 'manual'; reviewRequired?: boolean }
export interface Project { id: string; title: string; createdAt: string; updatedAt: string; source: Source; preset: Preset; edit: Edit; revision: number; outputs: Output[]; candidates: Candidate[]; batch?: Batch; previousBatch?: Batch; recentJobs?: Pick<Job, 'id' | 'state' | 'message' | 'createdAt' | 'endedAt'>[]; messages: { role: 'user' | 'assistant'; text: string; at: string }[]; job: Job | null; undo: Edit[] }
export interface Settings { outputDir: string; aiEngine: 'local' | 'codex' | 'claude'; cliPath: string; model: string; codexPath: string; codexModel: string; codexReasoning: string; preferYouTubeCC: boolean; transcriptionEngine: 'whisper' | 'api'; whisperPath: string; whisperModelPath: string; transcriptionLanguage: 'auto' | 'ko' | 'en' | 'ja'; transcribeModel: string; ttsPythonPath: string; ttsModelPath: string; ffmpegPath: string; ffprobePath: string; ytdlpPath: string; apiKeyConfigured: boolean }
export interface Diagnostic { tools: { name: string; ok: boolean; path: string; version: string }[]; whisper: { exe: string; model: string; fallback: boolean }; cliPath: string; dataDir: string; outputDir: string; electron: string }
export interface Bootstrap { projects: Project[]; presets: Preset[]; settings: Settings; version: string }
export type Result<T> = { ok: true; data: T } | { ok: false; error: { code: string; message: string } };
export type RunOptions = { action?: 'render' | 'prepare' | 'transcribe' | 'batch-analyze' | 'batch-render' | 'caption-script' | 'clip-transcribe' | 'clip-ai' | 'clip-preview'; clipId?: string; request?: string; auto?: boolean; review?: boolean; length?: number; count?: number; clipIds?: string[]; clipStarts?: Record<string, number>; autoBatch?: boolean; captionMode?: 'verbatim' | 'polished' } | { action: 'output-captions'; outputId: string; items: Caption[] };
export interface StudioApi {
  bootstrap(): Promise<Result<Bootstrap>>;
  codexAccount(): Promise<Result<CodexAccount>>;
  codexActivity(): Promise<Result<CodexActivity>>;
  onCodexActivity(callback: (activity: CodexActivity) => void): () => void;
  saveClipEdit(id: string, clipId: string, edit: Edit, presetId?: string): Promise<Result<Project>>;
  confirmClips(id: string, clipIds: string[]): Promise<Result<Project>>;
  copyClipCustomization(id: string, clipId: string, targets: string[], title: boolean, mask: boolean): Promise<Result<Project>>;
  addManualClip(id: string, start: number, length: number, count: number): Promise<Result<Project>>;
  removeClip(id: string, clipId: string): Promise<Result<Project>>;
  swapBatch(id: string): Promise<Result<Project>>;
  importClipSrt(id: string, clipId: string): Promise<Result<Project | null>>;
  translateClipSrt(id: string, clipId: string, items: Caption[]): Promise<Result<Caption[]>>;
  importFile(file?: File): Promise<Result<Project | null>>;
  importUrl(url: string): Promise<Result<Project>>;
  saveEdit(id: string, edit: Edit): Promise<Result<Project>>;
  addSampleCaption(id: string, sourceTime: number): Promise<Result<Project>>;
  rename(id: string, title: string): Promise<Result<Project>>;
  duplicate(id: string): Promise<Result<Project>>;
  archive(id: string): Promise<Result<unknown>>;
  undo(id: string): Promise<Result<Project>>;
  applyPreset(id: string, presetId: string): Promise<Result<Project>>;
  savePreset(preset: Preset): Promise<Result<Preset[]>>;
  deletePreset(id: string): Promise<Result<Preset[]>>;
  importPreset(): Promise<Result<Preset[] | null>>;
  exportPreset(id: string): Promise<Result<boolean>>;
  importSrt(id: string): Promise<Result<Project | null>>;
  readOutputSrt(id: string, outputId: string): Promise<Result<Caption[]>>;
  importOutputSrt(id: string, outputId: string): Promise<Result<Caption[] | null>>;
  translateOutputSrt(id: string, outputId: string, items: Caption[]): Promise<Result<Caption[]>>;
  cancelOutputTranslation(id: string): Promise<Result<void>>;
  chooseBgm(id: string): Promise<Result<Project | null>>;
  run(id: string, options: RunOptions): Promise<Result<Project>>;
  openOutputProject(id: string, outputId: string): Promise<Result<Project>>;
  cancel(id: string): Promise<Result<Project>>;
  requestEdit(id: string, request: string): Promise<Result<Project>>;
  saveSettings(settings: Partial<Settings> & { apiKey?: string; clearApiKey?: boolean }): Promise<Result<Settings>>;
  diagnose(): Promise<Result<Diagnostic>>;
  selectPath(kind: string): Promise<Result<string | null>>;
  exportVideo(id: string, outputId: string, captions?: boolean): Promise<Result<boolean>>;
  openFolder(id: string): Promise<Result<void>>;
  window(action: 'minimize' | 'maximize' | 'close'): Promise<Result<void>>;
  onProject(callback: (project: Project) => void): () => void;
}
declare global { interface Window { studio: StudioApi } }
export async function unwrap<T>(promise: Promise<Result<T>>): Promise<T> { const result = await promise; if (!result.ok) throw new Error(result.error.message); return result.data; }
export const time = (seconds = 0) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export const busy = (p: Project) => p.job?.state === 'queued' || p.job?.state === 'running';
export const stateLabel = (state?: string) => ({ queued: '대기 중', running: '제작 중', completed: '완료', failed: '실패', cancelled: '취소', interrupted: '중단됨', needs_input: '구간 확인' }[state || ''] || '편집 준비');
