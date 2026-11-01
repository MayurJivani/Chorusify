import { describe, expect, it, vi } from 'vitest';
import { TtlCache } from '../../src/utils/ttlCache';

describe('TtlCache', () => {
  it('evicts the least recently used entry past its bound', () => {
    const cache = new TtlCache<number>(2);
    cache.set('a', 1, 1000);
    cache.set('b', 2, 1000);
    cache.get('a');
    cache.set('c', 3, 1000);
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.size).toBe(2);
  });

  it('expires entries but keeps them readable as stale', () => {
    vi.useFakeTimers();
    const cache = new TtlCache<number>(2);
    cache.set('a', 1, 1000);
    vi.advanceTimersByTime(1001);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.peek('a')).toBe(1);
    vi.useRealTimers();
  });
});
