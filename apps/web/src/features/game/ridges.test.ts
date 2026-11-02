import { describe, expect, it } from 'vitest';
import { ridgeHeight } from './ridges';

describe('ridgeHeight', () => {
  it('is flat at the edges and rises in the middle', () => {
    expect(ridgeHeight(0, 3, 1, 100)).toBeLessThan(0.1);
    expect(ridgeHeight(0.5, 3, 1, 100)).toBeGreaterThan(ridgeHeight(0.05, 3, 1, 100));
  });
  it('grows with energy and never goes below the line', () => {
    expect(ridgeHeight(0.5, 2, 0, 200)).toBeGreaterThan(ridgeHeight(0.5, 2, 0, 100));
    for (let x = 0; x <= 1; x += 0.1) expect(ridgeHeight(x, 5, 2, 50)).toBeGreaterThanOrEqual(0);
  });
});
