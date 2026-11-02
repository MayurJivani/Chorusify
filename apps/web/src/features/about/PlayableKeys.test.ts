import { describe, expect, it } from 'vitest';
import { noteFrequency } from './PlayableKeys';

describe('noteFrequency', () => {
  it('tunes to concert pitch', () => {
    expect(noteFrequency(69)).toBe(440);
    expect(noteFrequency(81)).toBe(880);
    expect(noteFrequency(60)).toBeCloseTo(261.63, 1);
  });
});
