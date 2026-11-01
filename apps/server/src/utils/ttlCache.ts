/**
 * A bounded TTL cache. The Map's insertion order doubles as the LRU order, so a read moves the
 * entry to the back and eviction takes from the front.
 */
export class TtlCache<T> {
  private entries = new Map<string, { value: T; expiresAt: number; storedAt: number }>();
  hits = 0;
  misses = 0;

  constructor(private readonly maxEntries: number) {}

  /** The value even if expired, for serving stale when the source is down. */
  peek(key: string, maxAgeMs = Infinity): T | undefined {
    const entry = this.entries.get(key);
    return entry && Date.now() - entry.storedAt < maxAgeMs ? entry.value : undefined;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.misses += 1;
      return undefined;
    }
    this.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs, storedAt: Date.now() });
    if (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value as string);
    }
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    return !!entry && entry.expiresAt > Date.now();
  }

  get size(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }
}
