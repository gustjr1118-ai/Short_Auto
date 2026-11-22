import { SourceMask } from '../types';

export function SourceMaskEditor({ mask, duration, thumbnail, onChange }: {
  mask: SourceMask; duration: number; thumbnail?: string; onChange: (value: SourceMask) => void;
}) {
  const set = (patch: Partial<SourceMask>) => onChange({ ...mask, ...patch });
  const fields = [
    ['x', '왼쪽', 95], ['y', '위쪽', 95],
    ['width', '너비', 100 - mask.x], ['height', '높이', 100 - mask.y],
  ] as const;
  return <section className="source-mask">
    <h3>원본 자막 가리기</h3>
    <label>처리 방식<select value={mask.mode} onChange={e => set({ mode: e.target.value as SourceMask['mode'] })}>
      <option value="off">유지</option><option value="blur">부분 블러</option><option value="box">검정 박스</option><option value="crop">하단 잘라내기</option>
    </select></label>
    {mask.mode !== 'off' ? <>
      {thumbnail ? <div className="mask-guide">
        <img src={thumbnail} alt="원본 프레임의 가림 영역 안내"/>
        <span style={mask.mode === 'crop' ? { left: 0, bottom: 0, width: '100%', height: `${mask.cropBottom}%` }
          : { left: `${mask.x}%`, top: `${mask.y}%`, width: `${mask.width}%`, height: `${mask.height}%` }}/>
      </div> : null}
      {mask.mode === 'crop' ? <label>하단에서 제거 {mask.cropBottom}%<input type="range" min="1" max="40" value={mask.cropBottom} onChange={e => set({ cropBottom: Number(e.target.value) })}/></label> : <>
        {fields.map(([key, label, max]) => <label key={key}>{label} {mask[key]}%<input type="range" min={key === 'width' || key === 'height' ? 5 : 0} max={max} value={mask[key]} onChange={e => {
          const next = { ...mask, [key]: Number(e.target.value) };
          next.width = Math.min(next.width, 100 - next.x);
          next.height = Math.min(next.height, 100 - next.y);
          onChange(next);
        }}/></label>)}
        {mask.mode === 'blur' ? <label>블러 강도 {mask.strength}<input type="range" min="2" max="50" value={mask.strength} onChange={e => set({ strength: Number(e.target.value) })}/></label> : null}
        <div className="field-pair">
          <label>원본 시작 (초)<input type="number" min="0" max={duration} step=".1" value={mask.start} onChange={e => set({ start: e.target.valueAsNumber || 0 })}/></label>
          <label>원본 종료 (초)<input type="number" min="0" max={duration} step=".1" placeholder="끝까지" value={mask.end ?? ''} onChange={e => set({ end: Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : null })}/></label>
        </div>
      </>}
      <p className="hint">위 상자는 원본에서 가릴 위치 안내입니다. 실제 효과는 쇼츠를 다시 제작한 뒤 확인하세요.</p>
    </> : null}
  </section>;
}
