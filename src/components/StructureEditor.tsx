import { Edit, Overlay, Segment } from '../types';
import { durationOf, outputTime } from '../timeline';

const guidance: Record<Edit['kind'], [string, string]> = {
  style: ['설명·구간 연결', '선택한 원본에 설명 표시를 넣거나 여러 구간을 연결할 수 있습니다.'],
  story: ['상황 → 사건 → 결과', '사건 앞의 맥락과 마지막 반응까지 포함하세요. 설명은 확인되는 사실만 입력합니다.'],
  tutorial: ['목표 → 단계 → 완성', '단계 시간을 실제 행동에 맞추고 손·도구를 가리지 않게 위치를 조정하세요.'],
  product: ['비교 조건 → 실사용 → 결과', '제품과 비교 조건이 함께 보이도록 하세요. 수치·효능은 원본에서 확인한 값만 입력합니다.'],
  transformation: ['이전 → 변화 → 이후', '같은 원본의 이전·이후 구간을 골라 연결합니다. 전환이 이미 있는 영상은 연속 구간도 가능합니다.'],
  list: ['세 구간 → 항목명 → 순서', '같은 원본의 세 구간을 선택하고 순서를 조정하세요. 원본에 없는 순위를 만들지 않습니다.'],
};
export function StructureEditor({ section, edit: e, sourceLength, playTime, segmentIndex, onChange, onSeek }: { section: 'segments' | 'overlays'; edit: Edit; sourceLength: number; playTime: number; segmentIndex: number; onChange: (patch: Partial<Edit>) => void; onSeek: (time: number, index: number) => void }) {
  const duration = durationOf(e), [heading, hint] = guidance[e.kind || 'style'];
  const setSegment = (index: number, patch: Partial<Segment>) => onChange({ segments: e.segments.map((s, i) => i === index ? { ...s, ...patch } : s) });
  const split = (count: number) => onChange({ segments: Array.from({ length: count }, (_, i) => ({ id: crypto.randomUUID(), start: +(e.start + (e.end - e.start) * i / count).toFixed(3), end: +(e.start + (e.end - e.start) * (i + 1) / count).toFixed(3), label: e.kind === 'transformation' ? i === 0 ? '이전' : '이후' : `항목 ${i + 1}`, layout: e.layout, cropX: e.cropX, cropY: e.cropY })) });
  const move = (index: number, delta: number) => { const list = [...e.segments]; [list[index], list[index + delta]] = [list[index + delta], list[index]]; onChange({ segments: list }); };
  const overlay = (start: number, end: number, text = '', x = 50, y = 27): Overlay => ({ id: crypto.randomUUID(), start, end, text, x, y, size: 52, color: e.captions.accent, background: true });
  const addOverlay = () => { const start = Math.min(Math.max(0, outputTime(e, playTime, segmentIndex)), Math.max(0, duration - .1)); onChange({ overlays: [...e.overlays, overlay(start, Math.min(duration, start + 3))] }); };
  const addPattern = () => {
    const d = Math.max(.1, duration);
    const list = e.kind === 'tutorial' ? Array.from({ length: 3 }, (_, i) => overlay(d * i / 3, d * (i + 1) / 3, `${i + 1}/3 · 단계 이름`))
      : e.kind === 'product' ? [overlay(0, d, '제품 A', 27, 28), overlay(0, d, '제품 B', 73, 28), overlay(0, Math.min(d, 4), '비교 조건 입력', 50, 39)]
      : [overlay(0, Math.min(d, 3), '상황 설명 입력'), overlay(Math.max(0, d - 3), d, '결과 설명 입력')];
    onChange({ overlays: [...e.overlays, ...list].slice(0, 24) });
  };
  const setOverlay = (index: number, patch: Partial<Overlay>) => onChange({ overlays: e.overlays.map((o, i) => i === index ? { ...o, ...patch } : o) });
  const invalid = e.segments.some(s => s.start < 0 || s.end > sourceLength || s.end - s.start < .1) || duration > 60 || duration < .1;
  return <>
    <h3>{heading}</h3><p className="hint">{hint}</p>
    {section === "segments" ? <div className="structure-section"><div className="row-between"><strong>연결 구간</strong><span className={invalid ? 'warn-text' : 'chip'}>총 {duration.toFixed(1)}초 / 60초</span></div>
      {!e.segments.length ? <><button className="btn" disabled={e.end - e.start < .3} onClick={() => split(e.kind === 'transformation' ? 2 : 3)}>{e.kind === 'transformation' ? '이전·이후 2구간 구성' : e.kind === 'list' ? 'TOP 3 구간 구성' : '여러 구간으로 나누기'}</button><p className="hint">현재 범위를 나눈 뒤 각 구간의 원본 시작·종료를 바꿀 수 있습니다.</p></> : <>
        {e.segments.map((s, i) => <div className="structure-item" key={s.id}><div className="row-between"><strong>{i + 1}번 구간</strong><div className="inline-actions"><button title="위로 이동" disabled={i === 0} onClick={() => move(i, -1)}>↑</button><button title="아래로 이동" disabled={i === e.segments.length - 1} onClick={() => move(i, 1)}>↓</button><button title="구간 삭제" onClick={() => onChange({ segments: e.segments.filter(item => item.id !== s.id) })}>×</button></div></div>
          <label>구간 이름<input value={s.label} maxLength={50} onChange={ev => setSegment(i, { label: ev.target.value })}/></label>
          <div className="field-pair"><label>원본 시작 (초)<input type="number" min="0" max={sourceLength} step="0.1" value={s.start} onChange={ev => setSegment(i, { start: +ev.target.value })}/></label><label>원본 종료 (초)<input type="number" min="0" max={sourceLength} step="0.1" value={s.end} onChange={ev => setSegment(i, { end: +ev.target.value })}/></label></div>
          <label>이 구간 화면<select value={s.layout} onChange={ev => setSegment(i, { layout: ev.target.value as Segment['layout'] })}><option value="fit">전체 맞춤</option><option value="crop">세로 크롭</option><option value="blur">흐린 배경</option></select></label>
          {s.layout === 'crop' ? <><label>가로 중심 {s.cropX}%<input type="range" min="0" max="100" value={s.cropX} onChange={ev => setSegment(i, { cropX: +ev.target.value })}/></label><label>세로 중심 {s.cropY}%<input type="range" min="0" max="100" value={s.cropY} onChange={ev => setSegment(i, { cropY: +ev.target.value })}/></label></> : null}
          <button className="btn small" onClick={() => onSeek(s.start, i)}>이 구간 미리보기</button>
        </div>)}
        <button className="btn small" disabled={e.segments.length >= 5 || duration >= 59.9} onClick={() => onChange({ segments: [...e.segments, { id: crypto.randomUUID(), start: 0, end: Math.min(3, sourceLength, 60 - duration), label: `항목 ${e.segments.length + 1}`, layout: e.layout, cropX: e.cropX, cropY: e.cropY }] })}>+ 구간 추가</button>
        <button className="link-button" onClick={() => onChange({ segments: [] })}>연결 해제하고 원래 연속 구간 사용</button>
      </>}
      {invalid ? <p className="warn-text" role="alert">각 구간을 원본 안에서 0.1초 이상, 합계 60초 이하로 지정하세요.</p> : null}
    </div> : <div className="structure-section"><div className="row-between"><strong>시점별 설명 표시</strong><span className="muted">완성본 시간 기준</span></div>
      <button className="btn" disabled={e.overlays.length > 21} onClick={addPattern}>{e.kind === 'tutorial' ? '단계 표시 틀 넣기' : e.kind === 'product' ? '제품·조건 표시 틀 넣기' : '상황·결과 표시 틀 넣기'}</button>
      <p className="hint">틀의 문구와 시점을 실제 내용에 맞게 수정하세요. 연결 구간을 바꾸면 아래 시간도 확인해 주세요.</p>
      {e.overlays.map((o, i) => <div className="structure-item" key={o.id}><div className="row-between"><strong>설명 {i + 1}</strong><button className="link-button" onClick={() => onChange({ overlays: e.overlays.filter(item => item.id !== o.id) })}>삭제</button></div>
        <label>표시 문구<textarea rows={2} maxLength={120} value={o.text} placeholder="원본에서 확인한 설명을 입력하세요" onChange={ev => setOverlay(i, { text: ev.target.value })}/></label>
        <div className="field-pair"><label>표시 시작 (초)<input type="number" min="0" max={duration} step="0.1" value={o.start} onChange={ev => setOverlay(i, { start: +ev.target.value })}/></label><label>표시 종료 (초)<input type="number" min="0" max={duration} step="0.1" value={o.end} onChange={ev => setOverlay(i, { end: +ev.target.value })}/></label></div>
        <label>가로 위치 {o.x}%<input type="range" min="10" max="90" value={o.x} onChange={ev => setOverlay(i, { x: +ev.target.value })}/></label><label>위에서 {o.y}%<input type="range" min="10" max="75" value={o.y} onChange={ev => setOverlay(i, { y: +ev.target.value })}/></label>
        <div className="field-pair"><label>크기 (px)<input type="number" min="28" max="90" value={o.size} onChange={ev => setOverlay(i, { size: +ev.target.value })}/></label><label>색상<input type="color" value={o.color} onChange={ev => setOverlay(i, { color: ev.target.value })}/></label></div>
        <label className="check-label"><input type="checkbox" checked={o.background} onChange={ev => setOverlay(i, { background: ev.target.checked })}/>설명 배경</label>
        {o.end <= o.start || o.end > duration ? <p className="warn-text">표시 시간을 완성본 길이 안에서 확인하세요.</p> : null}
      </div>)}
      <button className="btn small" disabled={e.overlays.length >= 24} onClick={addOverlay}>+ 현재 지점에 설명 추가</button>
    </div>}
  </>;
}
