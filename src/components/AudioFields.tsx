import type { Edit } from '../types';
import { Icon } from './Icon';

export function AudioFields({ audio, onChange, onChooseBgm }: {
  audio: Edit['audio']; onChange: (audio: Edit['audio']) => void; onChooseBgm: () => void;
}) {
  return <>
    <h3>원본 음성과 배경음악</h3>
    <label>자막 AI 음성<select value={audio.narrationMode} onChange={e => onChange({ ...audio, narrationMode: e.target.value as Edit['audio']['narrationMode'] })}>
      <option value="off">끄기 · 원음 유지</option><option value="mix">원음과 혼합</option><option value="replace">원음 음소거 · AI 음성</option>
    </select></label>
    {audio.narrationMode !== 'off' ? <>
      <label>AI 음색<select value={audio.narrationVoice} onChange={e => onChange({ ...audio, narrationVoice: e.target.value })}>
        <option value="Sohee">Sohee · 한국어</option><option value="Vivian">Vivian</option><option value="Ryan">Ryan</option>
      </select></label>
      <p className="hint">자막 반영 후 제작하면 AI 음성이 적용됩니다.</p>
    </> : null}
    <label>원음 {Math.round(audio.volume * 100)}%<input type="range" min="0" max="2" step="0.01" value={audio.volume}
      onChange={e => onChange({ ...audio, volume: e.target.valueAsNumber })}/></label>
    <label>BGM 파일<button className="btn file-picker" type="button" onClick={onChooseBgm}><Icon name="folder" size={14}/>
      <span>{audio.bgmPath.split(/[\\/]/).at(-1) || '음악 파일 선택'}</span></button></label>
    {audio.bgmPath ? <button className="link-button" type="button" onClick={() => onChange({ ...audio, bgmPath: '' })}>배경음악 제거</button> : null}
    <label>BGM {Math.round(audio.bgmVolume * 100)}%<input type="range" min="0" max="1" step="0.01" value={audio.bgmVolume}
      onChange={e => onChange({ ...audio, bgmVolume: e.target.valueAsNumber })}/></label>
    <label>페이드 시간 {audio.fade}초<input type="range" min="0" max="5" step="0.1" value={audio.fade}
      onChange={e => onChange({ ...audio, fade: e.target.valueAsNumber })}/></label>
    <p className="hint">배경음악은 선택한 영상 길이에 맞춰 반복됩니다.</p>
  </>;
}
