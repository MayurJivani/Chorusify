import { describe, expect, it } from 'vitest';
import { LYRICS, lineAt } from './lyrics';

describe('lineAt', () => {
  it('walks through every line in order', () => {
    expect(lineAt(0, 4)).toEqual({ index: 0, through: 0 });
    expect(lineAt(0.375, 4)).toEqual({ index: 1, through: 0.5 });
  });
  it('ends on the last line, fully sung, and survives overscroll', () => {
    expect(lineAt(1, 4)).toEqual({ index: 3, through: 1 });
    expect(lineAt(1.4, 4)).toEqual({ index: 3, through: 1 });
    expect(lineAt(-1, 4)).toEqual({ index: 0, through: 0 });
  });
});

describe('the sheet', () => {
  it('has no em dashes', () => {
    expect(LYRICS.flatMap((s) => s.lines).join(' ')).not.toContain('—');
  });
});
