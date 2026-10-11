import { describe, it, expect } from 'vitest';
import { timeDecayScore } from '../../src/utils/scoring';
import { scoreForSlot, DAILY_SCORE_MAX, DAILY_SCORE_MIN } from '../../src/services/puzzleService';

const daily = { window: 60, max: 100, min: 10 };

describe('timeDecayScore', () => {
  it('scores the ceiling for an instant answer', () => {
    expect(timeDecayScore({ ...daily, elapsed: 0 })).toBe(100);
  });

  it('scores the floor at the edge of the window', () => {
    expect(timeDecayScore({ ...daily, elapsed: 60 })).toBe(10);
  });

  it('decays linearly in between', () => {
    expect(timeDecayScore({ ...daily, elapsed: 30 })).toBe(55);
  });

  it('holds at the floor past the window instead of running to zero', () => {
    expect(timeDecayScore({ ...daily, elapsed: 600 })).toBe(10);
  });

  it('treats a negative elapsed as instant rather than scoring above the ceiling', () => {
    expect(timeDecayScore({ ...daily, elapsed: -5 })).toBe(100);
  });

  it('returns the floor when there was no window to answer in', () => {
    expect(timeDecayScore({ ...daily, elapsed: 0, window: 0 })).toBe(10);
    expect(timeDecayScore({ ...daily, elapsed: 5, window: -1 })).toBe(10);
  });

  // The speed-mode admin settings allow max in 10..500 and min in 0..200 with no cross-check,
  // so an inverted pair is reachable. It must not turn into a curve that rewards being slow.
  it('degrades to a flat ceiling when min is above max', () => {
    const inverted = { window: 1000, max: 10, min: 200 };
    expect(timeDecayScore({ ...inverted, elapsed: 0 })).toBe(10);
    expect(timeDecayScore({ ...inverted, elapsed: 500 })).toBe(10);
    expect(timeDecayScore({ ...inverted, elapsed: 1000 })).toBe(10);
  });

  it('is unit-agnostic as long as elapsed and window agree', () => {
    const seconds = timeDecayScore({ elapsed: 15, window: 30, max: 100, min: 0 });
    const millis = timeDecayScore({ elapsed: 15_000, window: 30_000, max: 100, min: 0 });
    expect(seconds).toBe(millis);
  });
});

describe('scoreForSlot', () => {
  it('scores nothing for a wrong guess, however fast', () => {
    expect(scoreForSlot(false, 0)).toBe(0);
    expect(scoreForSlot(false, null)).toBe(0);
  });

  it('scores the ceiling for an instant correct guess', () => {
    expect(scoreForSlot(true, 0)).toBe(DAILY_SCORE_MAX);
  });

  // Rows predating the timing feature have no elapsed value. Speed that cannot be verified is
  // treated as the slowest case, so a missing time can never beat a recorded fast one.
  it('treats an unknown time as the slowest case', () => {
    expect(scoreForSlot(true, null)).toBe(DAILY_SCORE_MIN);
  });
});
