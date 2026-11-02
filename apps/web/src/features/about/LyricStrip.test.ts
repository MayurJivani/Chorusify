import { describe, expect, it } from 'vitest';
import { lineAtTime } from './LyricStrip';

describe('lineAtTime', () => {
  it('moves line by line and loops back to the start', () => {
    expect(lineAtTime(0, 5)).toEqual({ index: 0, through: 0 });
    expect(lineAtTime(4200, 5)).toEqual({ index: 1, through: 0.5 });
    expect(lineAtTime(2800 * 5, 5).index).toBe(0);
  });
});
