import { describe, expect, it } from 'vitest';
import { createClockSync } from './clockSync';

describe('createClockSync', () => {
  it('takes the offset from the fastest round trip', () => {
    const clock = createClockSync();
    // Server 5000ms ahead. A slow, lopsided sample first, then a clean one.
    clock.addSample(1000, 1400, 6300);
    clock.addSample(2000, 2020, 7010);
    clock.addSample(3000, 3300, 8200);
    expect(clock.offset()).toBe(5000);
    expect(clock.toLocal(10_000)).toBe(5000);
  });

  it('ignores a sample from a clock that stepped backwards', () => {
    const clock = createClockSync();
    clock.addSample(2000, 1000, 9000);
    expect(clock.offset()).toBe(0);
  });
});
