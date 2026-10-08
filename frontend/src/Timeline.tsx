import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { clamp, formatTime, moveInterval, rangeFromPoints, resizeInterval } from './intervals';
import type { CutInterval } from './types';

export type TimelineMode = 'cut' | 'seek';

interface Props {
  duration: number;
  currentTime: number;
  cuts: CutInterval[];
  selectedId: string | null;
  mode: TimelineMode;
  onSeek: (time: number) => void;
  onSelect: (id: string) => void;
  onCreate: (start: number, end: number) => void;
  onUpdate: (cut: CutInterval) => void;
}

interface Gesture {
  pointerId: number;
  type: 'create' | 'move' | 'left' | 'right' | 'seek';
  anchorX: number;
  anchorTime: number;
  moved: boolean;
  cut?: CutInterval;
}

export default function Timeline({
  duration, currentTime, cuts, selectedId, mode, onSeek, onSelect, onCreate, onUpdate,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const [pendingBoundary, setPendingBoundary] = useState<number | null>(null);
  const [preview, setPreview] = useState<{ start: number; end: number } | null>(null);

  useEffect(() => {
    setPendingBoundary(null);
    setPreview(null);
  }, [mode]);

  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPendingBoundary(null);
        setPreview(null);
        gestureRef.current = null;
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);

  function timeAt(clientX: number) {
    const rect = trackRef.current!.getBoundingClientRect();
    return clamp((clientX - rect.left) / rect.width, 0, 1) * duration;
  }

  function begin(event: ReactPointerEvent, type: Gesture['type'], cut?: CutInterval) {
    if (event.button !== 0 || !duration) return;
    event.preventDefault();
    event.stopPropagation();
    const anchorTime = timeAt(event.clientX);
    gestureRef.current = {
      pointerId: event.pointerId, type, anchorX: event.clientX, anchorTime, moved: false, cut,
    };
    trackRef.current!.setPointerCapture(event.pointerId);
    trackRef.current!.focus({ preventScroll: true });
    if (cut) {
      onSelect(cut.id);
      setPendingBoundary(null);
    }
    if (type === 'seek') onSeek(anchorTime);
  }

  function move(event: ReactPointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const time = timeAt(event.clientX);
    if (Math.abs(event.clientX - gesture.anchorX) >= 4) gesture.moved = true;
    if (gesture.type === 'seek') {
      onSeek(time);
    } else if (gesture.type === 'create' && gesture.moved) {
      setPreview(rangeFromPoints(gesture.anchorTime, time, duration));
    } else if (gesture.cut && gesture.moved) {
      onUpdate(gesture.type === 'move'
        ? moveInterval(gesture.cut, time - gesture.anchorTime, duration)
        : resizeInterval(
          gesture.cut,
          gesture.type === 'left' ? 'left' : 'right',
          (gesture.type === 'left' ? gesture.cut.start : gesture.cut.end) + time - gesture.anchorTime,
          duration,
        ));
    }
  }

  function end(event: ReactPointerEvent) {
    const gesture = gestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    gestureRef.current = null;
    if (trackRef.current!.hasPointerCapture(event.pointerId)) {
      trackRef.current!.releasePointerCapture(event.pointerId);
    }
    const time = timeAt(event.clientX);
    if (gesture.type === 'create') {
      if (gesture.moved) {
        const range = rangeFromPoints(gesture.anchorTime, time, duration);
        if (range) onCreate(range.start, range.end);
        setPendingBoundary(null);
      } else if (pendingBoundary === null) {
        setPendingBoundary(time);
      } else {
        const range = rangeFromPoints(pendingBoundary, time, duration);
        if (range) {
          onCreate(range.start, range.end);
          setPendingBoundary(null);
        }
      }
    }
    setPreview(null);
  }

  const ticks = Array.from({ length: 9 }, (_, index) => (duration * index) / 8);
  const styleFor = (start: number, end: number) => ({
    left: `${(start / duration) * 100}%`,
    width: `${((end - start) / duration) * 100}%`,
  });

  return (
    <div className="timeline-wrapper">
      <div className="timeline-ruler" aria-hidden="true">
        {ticks.map((time, index) => (
          <span key={index} style={{ left: `${(index / 8) * 100}%` }}>{formatTime(time)}</span>
        ))}
      </div>
      <div
        ref={trackRef}
        className={`timeline-track mode-${mode}`}
        data-testid="timeline"
        role="group"
        aria-label="Шкала видео. В режиме CUT два клика или протягивание создают интервал. Стрелки перематывают видео."
        tabIndex={0}
        onPointerDown={(event) => begin(event, mode === 'cut' ? 'create' : 'seek')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          gestureRef.current = null;
          setPreview(null);
        }}
        onLostPointerCapture={() => {
          gestureRef.current = null;
          setPreview(null);
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            const step = event.shiftKey ? 5 : 1;
            onSeek(clamp(currentTime + (event.key === 'ArrowRight' ? step : -step), 0, duration));
          }
        }}
      >
        <div className="track-background" aria-hidden="true">
          <span>ВИДЕО</span>
          {ticks.map((time, index) => (
            <i key={time} style={{ left: `${(index / 8) * 100}%` }} />
          ))}
        </div>
        {cuts.map((cut) => (
          <div
            key={cut.id}
            className={`cut-block ${cut.id === selectedId ? 'selected' : ''}`}
            style={{ ...styleFor(cut.start, cut.end), zIndex: cut.id === selectedId ? 4 : 2 }}
            data-testid="cut-interval"
            data-cut-id={cut.id}
            role="button"
            tabIndex={0}
            aria-pressed={cut.id === selectedId}
            aria-label={`CUT ${formatTime(cut.start, true)} — ${formatTime(cut.end, true)}`}
            title={`CUT ${cut.start.toFixed(2)} — ${cut.end.toFixed(2)} сек. Перетащите интервал или его границы.`}
            onPointerDown={(event) => {
              if (mode === 'seek') begin(event, 'seek', cut);
              else if (pendingBoundary !== null) begin(event, 'create');
              else begin(event, 'move', cut);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSelect(cut.id);
              }
            }}
          >
            <span className="cut-word" aria-hidden="true">CUT</span>
            <button
              type="button"
              className="cut-handle left"
              data-testid="left-handle"
              aria-label="Переместить начало CUT"
              onPointerDown={(event) => begin(event, 'left', cut)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(cut.id);
                  onUpdate(resizeInterval(cut, 'left', cut.start + (event.key === 'ArrowRight' ? 0.1 : -0.1), duration));
                }
              }}
            />
            <button
              type="button"
              className="cut-handle right"
              data-testid="right-handle"
              aria-label="Переместить конец CUT"
              onPointerDown={(event) => begin(event, 'right', cut)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  event.preventDefault();
                  event.stopPropagation();
                  onSelect(cut.id);
                  onUpdate(resizeInterval(cut, 'right', cut.end + (event.key === 'ArrowRight' ? 0.1 : -0.1), duration));
                }
              }}
            />
          </div>
        ))}
        {preview && <div className="cut-preview" style={styleFor(preview.start, preview.end)} />}
        {pendingBoundary !== null && (
          <div className="pending-boundary" style={{ left: `${(pendingBoundary / duration) * 100}%` }}>
            <span>{formatTime(pendingBoundary, true)}</span>
          </div>
        )}
        <div
          className="playhead"
          data-testid="playhead"
          style={{ left: `${clamp(currentTime / duration, 0, 1) * 100}%` }}
          aria-hidden="true"
        ><span /></div>
      </div>
      <div className="timeline-caption">
        <span><i className="legend cut" /> CUT будет удалён при экспорте</span>
        <span className={pendingBoundary !== null ? 'boundary-hint' : ''}>
          {pendingBoundary !== null
            ? 'Поставьте вторую границу · Esc — отмена'
            : mode === 'cut'
              ? 'Два клика или протягивание · Границы можно двигать'
              : 'Клик или протягивание для перемотки · ← → ±1 сек.'}
        </span>
      </div>
    </div>
  );
}
