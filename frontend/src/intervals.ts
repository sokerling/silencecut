import type { CutInterval } from './types';

export const MIN_INTERVAL = 0.05;

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function rangeFromPoints(first: number, second: number, duration: number) {
  const start = clamp(Math.min(first, second), 0, duration);
  const end = clamp(Math.max(first, second), 0, duration);
  return end - start >= MIN_INTERVAL ? { start, end } : null;
}

export function moveInterval(cut: CutInterval, delta: number, duration: number) {
  const length = cut.end - cut.start;
  const start = clamp(cut.start + delta, 0, Math.max(0, duration - length));
  return { ...cut, start, end: start + length };
}

export function resizeInterval(
  cut: CutInterval,
  side: 'left' | 'right',
  time: number,
  duration: number,
) {
  return side === 'left'
    ? { ...cut, start: clamp(time, 0, cut.end - MIN_INTERVAL) }
    : { ...cut, end: clamp(time, cut.start + MIN_INTERVAL, duration) };
}

export function totalCutDuration(cuts: CutInterval[]): number {
  const sorted = [...cuts].sort((a, b) => a.start - b.start);
  let total = 0;
  let start = 0;
  let end = 0;
  for (const cut of sorted) {
    if (cut.start > end) {
      total += end - start;
      start = cut.start;
      end = cut.end;
    } else {
      end = Math.max(end, cut.end);
    }
  }
  return total + end - start;
}

export function formatTime(seconds: number, withDecimals = false): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  // Floor keeps the display consistent with the current video frame.
  const whole = Math.floor(safe);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const rest = whole % 60;
  const prefix = hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}` : String(minutes);
  const fraction = withDecimals ? `.${String(Math.floor((safe - whole) * 100)).padStart(2, '0')}` : '';
  return `${prefix}:${String(rest).padStart(2, '0')}${fraction}`;
}
