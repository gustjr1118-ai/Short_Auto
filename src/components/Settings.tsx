import { useEffect, useState } from 'react';
import { Diagnostic, Settings, unwrap } from '../types';
import { Icon } from './Icon';
const codexModels = ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6.1-sol', 'gpt-6.1-terra', 'gpt-6-luna'];
const reasoningLevels = [['', '모델 기본값'], ['low', '낮음'], ['medium', '중간'], ['high', '높음'], ['xhigh', '매우 높음'], ['max', '최대']];
export function SettingsModal({ settings, initialTab = 'general', onClose, onSaved, report }: { settings: Settings; initialTab?: 'general' | 'ai'; onClose: () => void; onSaved: (s: Settings) => void; report: (e: unknown) => void }) {
  const [form, setForm] = useState({ ...settings, apiKey: '', clearApiKey: false });
  const [diagnostic, setDiagnostic] = useState<Diagnostic | null>(null);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<string>(initialTab);
  useEffect(() => { let active = true; unwrap(window.studio.diagnose()).then(d => { if (active) setDiagnostic(d); }).catch(report); return () => { active = false; }; }, []);
  const browse = async (key: 'outputDir' | 'cliPath' | 'codexPath' | 'ffmpegPath' | 'ffprobePath' | 'ytdlpPath' | 'whisperPath' | 'whisperModelPath' | 'ttsPythonPath' | 'ttsModelPath') => { try { const value = await unwrap(window.studio.selectPath(key)); if (value) setForm(f => ({ ...f, [key]: value })); } catch (e) { report(e); } };
  const save = async () => { setSaving(true); try { onSaved(await unwrap(window.studio.saveSettings(form))); onClose(); } catch (e) { report(e); } finally { setSaving(false); } };
  return <div className="modal-backdrop"><section className="modal settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-heading"><div className="modal-head"><div><span className="eyebrow">PREFERENCES</span><h2 id="settings-heading">설정 및 연결</h2></div><button className="icon-btn" onClick={onClose} aria-label="설정 닫기"><Icon name="close"/></button></div><div className="settings-layout"><nav className="settings-nav" aria-label="설정 항목">{[['general', '일반·저장'], ['ai', 'AI·음성 전사'], ['tools', '도구·진단']].map(([id, label]) => <button className={tab === id ? 'active' : ''} key={id} onClick={() => setTab(id)}>{label}</button>)}</nav><div className="settings-content form-stack">
    {tab === 'general' ? <><h3>작업 파일을 내 PC에 보관합니다</h3><p className="muted">프로젝트와 출력 영상은 선택한 폴더에 저장됩니다. 기존 프로젝트의 위치는 유지됩니다.</p><label>기본 작업 폴더<div className="input-action"><input value={form.outputDir} onChange={e => setForm({ ...form, outputDir: e.target.value })}/><button className="btn" onClick={() => browse('outputDir')}>찾기</button></div></label><div className="info-box"><Icon name="folder"/><div><strong>완성본을 덮어쓰지 않습니다</strong><p>수정할 때마다 새 버전이 만들어집니다. 프로젝트 폴더에서 이전 영상과 자막도 찾을 수 있습니다.</p></div></div><label className="read-only">제작 규격<span>1080 × 1920 · 30 FPS · H.264 / AAC</span></label></> : null}
    {tab === 'ai' ? <>
      <h3>분석과 편집 요청</h3>
      <label>텍스트 분석 엔진<select value={form.aiEngine} onChange={e => setForm({ ...form, aiEngine: e.target.value as Settings['aiEngine'] })}>
        <option value="local">기본 규칙</option><option value="codex">Codex CLI</option><option value="claude">Claude CLI</option>
      </select></label>
      {form.aiEngine === 'claude' ? <>
        <label>Claude 실행 파일<div className="input-action"><input placeholder="비우면 자동으로 찾습니다" value={form.cliPath} onChange={e => setForm({ ...form, cliPath: e.target.value })}/><button className="btn" onClick={() => browse('cliPath')}>찾기</button></div></label>
        <label>Claude 모델<input placeholder="비우면 CLI 기본 모델" value={form.model} onChange={e => setForm({ ...form, model: e.target.value })}/></label>
      </> : null}
      <h3>Codex CLI</h3>
      <label>Codex 실행 파일<div className="input-action"><input placeholder="비우면 자동으로 찾습니다" value={form.codexPath} onChange={e => setForm({ ...form, codexPath: e.target.value })}/><button className="btn" onClick={() => browse('codexPath')}>찾기</button></div></label>
      <label>Codex 모델<input list="codex-models" placeholder="비우면 CLI 기본 모델" value={form.codexModel} onChange={e => setForm({ ...form, codexModel: e.target.value })}/></label>
      <datalist id="codex-models">{codexModels.map(model => <option key={model} value={model}/>)}</datalist>
      <label>Codex 추론 강도<select value={form.codexReasoning} onChange={e => setForm({ ...form, codexReasoning: e.target.value })}>
        {reasoningLevels.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
      <p className="hint">일괄 추천과 Codex 자막 다듬기에도 적용됩니다. 지원되는 모델과 강도는 계정과 CLI 버전에 따라 달라집니다. 전사 텍스트가 Codex로 전달됩니다.</p>
      <div className="divider"/><h3>음성 전사</h3><label className="check-label"><input type="checkbox" checked={form.preferYouTubeCC} onChange={e => setForm({ ...form, preferYouTubeCC: e.target.checked })}/>링크 영상의 자막이 있으면 먼저 사용</label><p className="hint">자동 감지 설정에서는 한국어 자막을 찾습니다. 자막이 없으면 아래 전사 엔진을 사용합니다.</p>
      <label>전사 엔진<select value={form.transcriptionEngine} onChange={e => setForm({ ...form, transcriptionEngine: e.target.value as Settings['transcriptionEngine'] })}>
        <option value="whisper">로컬 Whisper CLI</option><option value="api">OpenAI 전사 API</option>
      </select></label>
      {form.transcriptionEngine === 'whisper' ? <>
        <label>whisper-cli 실행 파일<div className="input-action"><input value={form.whisperPath} placeholder="비우면 내장 실행 파일 사용" onChange={e => setForm({ ...form, whisperPath: e.target.value })}/><button className="btn" onClick={() => browse('whisperPath')}>찾기</button></div></label>
        <label>다국어 Whisper 모델<div className="input-action"><input value={form.whisperModelPath} placeholder="비우면 내장 다국어 모델 사용" onChange={e => setForm({ ...form, whisperModelPath: e.target.value })}/><button className="btn" onClick={() => browse('whisperModelPath')}>찾기</button></div></label>
        <label>음성 언어<select value={form.transcriptionLanguage} onChange={e => setForm({ ...form, transcriptionLanguage: e.target.value as Settings['transcriptionLanguage'] })}><option value="auto">자동 감지</option><option value="ko">한국어</option><option value="en">영어</option><option value="ja">일본어</option></select></label>
        <p className="hint">기본 실행 파일과 다국어 모델이 포함되어 있습니다. 두 칸을 비워 두면 바로 전사할 수 있습니다.</p>
        {diagnostic?.whisper ? <p className="hint">{diagnostic.whisper.exe && diagnostic.whisper.model
          ? diagnostic.whisper.fallback ? '저장한 경로에 파일이 없어 내장 전사 도구를 사용합니다.' : '저장된 설정으로 로컬 전사를 사용할 수 있습니다.'
          : '기본 전사 도구가 누락되었습니다. 전체 배포 폴더로 다시 실행해 주세요.'}</p> : null}
      </> : <>
        <label>OpenAI API 키 <span className={`key-status ${settings.apiKeyConfigured ? 'good-text' : ''}`}>{settings.apiKeyConfigured ? '저장됨' : '연결 안 됨'}</span><input type="password" autoComplete="off" placeholder={settings.apiKeyConfigured ? '변경할 때만 새 키 입력' : 'sk-…'} value={form.apiKey} onChange={e => setForm({ ...form, apiKey: e.target.value })}/></label>
        <p className="hint">전사를 실행할 때 분석용 오디오가 OpenAI로 전송됩니다.</p>
        {settings.apiKeyConfigured ? <label className="check-label"><input type="checkbox" checked={form.clearApiKey} onChange={e => setForm({ ...form, clearApiKey: e.target.checked })}/>저장된 API 키 삭제</label> : null}
      </>}
      <div className="divider"/><h3>로컬 AI 음성</h3>
      <label>Qwen3-TTS Python 실행 파일<div className="input-action"><input value={form.ttsPythonPath} onChange={e => setForm({ ...form, ttsPythonPath: e.target.value })}/><button className="btn" onClick={() => browse('ttsPythonPath')}>찾기</button></div></label>
      <label>Qwen3-TTS CustomVoice 모델 폴더<div className="input-action"><input value={form.ttsModelPath} onChange={e => setForm({ ...form, ttsModelPath: e.target.value })}/><button className="btn" onClick={() => browse('ttsModelPath')}>찾기</button></div></label>
      <p className="hint">Qwen3-TTS와 모델을 별도로 설치해 주세요. 설정하면 소리 탭에서 자막을 읽을 수 있습니다.</p>
    </> : null}
    {tab === 'tools' ? <><h3>미디어 도구</h3><p className="hint">FFmpeg·FFprobe는 앱에 포함됩니다. 외부 도구를 쓰려면 실행 파일을 지정하세요.</p>{(['ffmpegPath', 'ffprobePath', 'ytdlpPath'] as const).map(key => <label key={key}>{key.replace('Path', '').replace('ytdlp', 'yt-dlp')}<div className="input-action"><input value={form[key]} placeholder="앱 기본 도구 사용" onChange={e => setForm({ ...form, [key]: e.target.value })}/><button className="btn" onClick={() => browse(key)}>찾기</button></div></label>)}<div className="diagnostics">{diagnostic ? diagnostic.tools.map(t => <div key={t.name}><span className={t.ok ? 'good-text' : 'warn-text'}><Icon name={t.ok ? 'check' : 'close'} size={14}/>{t.name}</span><small>{t.version}</small></div>) : <p>실행 도구를 확인하고 있습니다…</p>}</div><button className="btn" onClick={() => unwrap(window.studio.diagnose()).then(setDiagnostic).catch(report)}>저장된 설정으로 다시 검사</button>{diagnostic ? <p className="hint">Electron {diagnostic.electron}<br/>설정 저장: {diagnostic.dataDir}</p> : null}</> : null}
  </div></div><div className="modal-foot"><span className="hint">키는 Windows 보호 저장소로 암호화합니다.</span><button className="btn" onClick={onClose}>취소</button><button className="btn primary" disabled={saving} onClick={save}>{saving ? '저장 중…' : '설정 저장'}</button></div></section></div>;
}
