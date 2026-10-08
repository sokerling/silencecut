import { describe, expect, it } from 'vitest';
import { moveInterval, rangeFromPoints, resizeInterval, totalCutDuration } from './intervals';

describe('CUT ranges', () => {
  const cut = { id: 'cut', start: 20, end: 30 };

  it('creates the same bounded range when dragged in either direction', () => {
    expect(rangeFromPoints(40, 12, 60)).toEqual({ start: 12, end: 40 });
    expect(rangeFromPoints(-5, 70, 60)).toEqual({ start: 0, end: 60 });
    expect(rangeFromPoints(5, 5.01, 60)).toBeNull();
  });

  it('preserves duration when moved beyond either end of the video', () => {
    expect(moveInterval(cut, -50, 60)).toEqual({ id: 'cut', start: 0, end: 10 });
    expect(moveInterval(cut, 100, 60)).toEqual({ id: 'cut', start: 50, end: 60 });
  });

  it('prevents a resized boundary crossing the other boundary or video ends', () => {
    expect(resizeInterval(cut, 'left', 35, 60).start).toBeCloseTo(29.95);
    expect(resizeInterval(cut, 'right', 15, 60).end).toBeCloseTo(20.05);
    expect(resizeInterval(cut, 'left', -10, 60).start).toBe(0);
    expect(resizeInterval(cut, 'right', 80, 60).end).toBe(60);
  });

  it('counts overlapping and adjacent CUT ranges only once for export duration', () => {
    expect(totalCutDuration([
      { id: 'a', start: 10, end: 20 },
      { id: 'b', start: 15, end: 25 },
      { id: 'c', start: 25, end: 30 },
      { id: 'd', start: 40, end: 45 },
    ])).toBe(25);
    expect(totalCutDuration([])).toBe(0);
  });
});
