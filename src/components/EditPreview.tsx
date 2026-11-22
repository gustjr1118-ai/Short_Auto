import { useImperativeHandle, useRef, useState } from 'react';
import type { Ref } from 'react';
import { Caption, Edit, Source, time } from '../types';
import { captionPreview, durationOf, outputTime, outputPosition, overlaysOf, segmentsOf, wrappedLines } from '../timeline';
import { Icon } from './Icon';

export interface EditPreviewHandle {
  seek: (time: number, index: number) => void;
  seekOutput: (time: number) => void;
  playFrom: (time: number, index: number) => void;
  pause: () => void;
}

function textAnchor(style: Pick<Edit['title'], 'x' | 'align'>) {
  const anchor = style.align === 'left' ? 0 : style.align === 'right' ? 100 : 50;
  const available = anchor === 0 ? 98 - style.x : anchor === 100 ? style.x - 2 : 2 * Math.min(style.x - 2, 98 - style.x);
  return { left: `${style.x}%`, right: 'auto', transform: `translateX(-${anchor}%)`, width: `${available}%`, textAlign: style.align };
}

export function EditPreview({ ref, edit, source, playback = 'selection', captionTrack, onPosition, report }: {
  ref?: Ref<EditPreviewHandle>; edit: Edit; source: Source; captionTrack?: Caption[];
  playback?: 'source' | 'selection';
  onPosition?: (time: number, index: number) => void; report: (e: unknown) => void;
}) {
  const segments = segmentsOf(edit);
  const [position, setPosition] = useState({ time: segments[0].start, index: 0 });
  const [playing, setPlaying] = useState(false);
  const player = useRef<HTMLVideoElement>(null);
  const pendingSeek = useRef<typeof position | null>(null);
  const pendingPlay = useRef(false);
  const index = Math.min(position.index, segments.length - 1);
  const segment = segments[index];
  const inRange = position.time >= segment.start && position.time < segment.end;
  const fullSource = playback === 'source';
  const showEdits = !fullSource && inRange;
  const clock = fullSource ? position.time : outputTime(edit, position.time, index);
  const duration = fullSource ? source.duration || 0 : Math.max(0, durationOf(edit));
  const captionTime = captionTrack ? clock : position.time;
  const cues = showEdits ? (captionTrack ?? edit.items).filter(c => c.text.trim() && captionTime >= c.start && captionTime < c.end) : [];
  const caption = cues.find(c => c.sample) || cues[0];
  const overlays = showEdits ? overlaysOf(edit).filter(o => clock >= o.start && clock < o.end) : [];

  const updatePosition = (time: number, nextIndex: number) => {
    setPosition(current => current.time === time && current.index === nextIndex ? current : { time, index: nextIndex });
    onPosition?.(time, nextIndex);
  };
  const resumeAfterSeek = (video: HTMLVideoElement) => {
    if (!pendingPlay.current || video.seeking || video.readyState === 0) return;
    pendingPlay.current = false;
    video.play().catch(error => { if (error.name !== 'AbortError') report(error); });
  };
  const seek = (time: number, nextIndex: number, play = false) => {
    const video = player.current;
    pendingPlay.current = play;
    if (play) video?.pause();
    if (video && video.readyState > 0) {
      pendingSeek.current = null;
      video.currentTime = time;
      resumeAfterSeek(video);
    } else pendingSeek.current = { time, index: nextIndex };
    updatePosition(time, nextIndex);
  };
  const seekOutput = (seconds: number) => {
    const next = outputPosition(edit, seconds);
    seek(next.time, next.index);
  };
  const pause = () => { pendingPlay.current = false; player.current?.pause(); };
  useImperativeHandle(ref, () => ({ seek, seekOutput, playFrom: (time, index) => seek(time, index, true), pause }));

  const onVideoTime = (video: HTMLVideoElement) => {
    const now = video.currentTime;
    if (video.paused || video.seeking) return;
    if (!fullSource && now >= segment.end - .015) {
      if (index + 1 < segments.length) { seek(segments[index + 1].start, index + 1); return; }
      video.pause();
      seek(Math.max(segment.start, segment.end - .04), index);
      return;
    }
    updatePosition(now, index);
  };
  const titleLines = wrappedLines(edit.title.text, 14);
  const titleSize = Math.min(edit.title.size, 900 / (Math.max(1, ...titleLines.map(line => line.length)) * .85));

  return <div className="edit-preview">
    <div className={`phone-preview ${fullSource ? 'layout-fit full-source-preview' : `layout-${segment.layout}`}`}>
      {source.mediaUrl ? <>
        {source.thumbnailUrl ? <div className="preview-background" style={{ backgroundImage: `url("${source.thumbnailUrl}")` }}/> : null}
        <video ref={player} aria-label="편집 영상 미리보기" src={source.mediaUrl} poster={source.thumbnailUrl || undefined} playsInline preload="metadata"
          style={!fullSource && segment.layout === 'crop' ? { objectPosition: `${segment.cropX}% ${segment.cropY}%` } : {}}
          onLoadedMetadata={() => {
            const target = pendingSeek.current || { time: fullSource ? 0 : segment.start, index };
            seek(target.time, target.index, pendingPlay.current);
          }}
          onSeeked={e => resumeAfterSeek(e.currentTarget)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onPlay={e => {
            const actualTime = e.currentTarget.currentTime;
            if (!fullSource && (actualTime < segment.start - .04 || actualTime >= segment.end)) {
              seek(segment.start, index, true);
              return;
            }
            e.currentTarget.volume = fullSource ? 1 : Math.min(1, edit.audio.volume);
            setPlaying(true);
          }}
          onTimeUpdate={e => onVideoTime(e.currentTarget)}/>
        {edit.title.enabled && showEdits && (edit.title.seconds === 0 || clock < edit.title.seconds) &&
          <div className={`live-title ${edit.title.background ? 'with-bg' : ''}`}
            style={{ ...textAnchor(edit.title), color: edit.title.color, top: `${edit.title.position}%`, fontSize: `${titleSize / 10.8}cqw` }}>
            {titleLines.slice(0, 2).join('\n')}
          </div>}
        {(captionTrack || edit.captions.enabled) && showEdits && caption ?
          <div className={`live-caption ${edit.captions.background ? 'with-bg' : ''}`}
            style={{ ...textAnchor(edit.captions), color: edit.captions.color, bottom: `${edit.captions.position}%`,
              fontSize: `${edit.captions.size / 10.8}cqw`, textShadow: `0 1px 3px ${edit.captions.outline}` }}>
            {captionPreview(caption.text, caption.start, caption.end, captionTime)}
          </div> : null}
        {overlays.map(o => {
          const lines = wrappedLines(o.text, 18).slice(0, 2);
          const size = Math.max(16, Math.min(o.size, (Math.min(o.x, 100 - o.x) * 21.6 - 48) / (Math.max(1, ...lines.map(line => line.length)) * .85)));
          return <div key={o.id} className={`live-overlay ${o.background ? 'with-bg' : ''}`}
            style={{ left: `${o.x}%`, top: `${o.y}%`, color: o.color, fontSize: `${size / 10.8}cqw` }}>{lines.join('\n')}</div>;
        })}
      </> : <div className="empty-player"><Icon name="film" size={36}/><p>원본을 준비하면<br/>영상이 표시됩니다</p></div>}
    </div>
    <div className="preview-controls">
      <button aria-label={playing ? '미리보기 일시정지' : '미리보기 재생'} disabled={!source.mediaUrl || duration <= 0}
        onClick={() => {
          if (playing || pendingPlay.current) { pause(); return; }
          const video = player.current;
          if (!video) return;
          const current = video.currentTime;
          if (video.readyState === 0 || (!fullSource && (current < segment.start || current >= segment.end - .05))) {
            seek(pendingSeek.current?.time ?? (fullSource ? current : segment.start), index, true);
          } else {
            pendingPlay.current = true;
            resumeAfterSeek(video);
          }
        }}>
        <Icon name={playing ? 'stop' : 'play'} size={15}/>
      </button>
      <input aria-label={fullSource ? '원본 전체 재생 위치' : '편집 미리보기 재생 위치'} type="range"
        min="0" max={duration || 1} step="any" aria-valuetext={`${time(clock)} / ${time(duration)}`}
        value={Math.min(duration, clock)} disabled={!source.mediaUrl || !duration}
        onChange={e => {
          const target = e.currentTarget.valueAsNumber;
          if (fullSource) seek(target, index);
          else seekOutput(target);
        }}/>
      <span>{time(Math.min(duration, clock))} / {time(duration)}</span>
    </div>
  </div>;
}
