/**
 * In-process numbers for /api/admin/metrics. One process holds every room, so there is nothing to
 * aggregate and no reason for a metrics service yet.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { sql } from 'drizzle-orm';
import { db } from '../db/client';
import { logger } from '../logger';

const counters = {
  wsConnections: 0,
  wsMessagesIn: 0,
  wsFramesOut: 0,
  wsSlowClientsDropped: 0,
  reconnects: 0,
  deezerRequests: 0,
  deezerErrors: 0,
  deezerCoalesced: 0,
  deezerBreakerOpens: 0,
  searchCacheHits: 0,
  searchCacheMisses: 0,
  eventCreateFailures: 0,
};

export type Counter = keyof typeof counters;

export function count(name: Counter, by = 1): void {
  counters[name] += by;
}

/** The last 2048 samples: enough for a stable p95, and it cannot grow. */
class Samples {
  private values = new Float64Array(2048);
  private next = 0;
  private filled = 0;
  add(value: number): void {
    this.values[this.next] = value;
    this.next = (this.next + 1) % this.values.length;
    this.filled = Math.min(this.filled + 1, this.values.length);
  }
  summary(): { n: number; p50: number; p95: number; p99: number } {
    const sorted = this.values.slice(0, this.filled).sort();
    const at = (p: number) => sorted[Math.floor((sorted.length - 1) * p)] ?? 0;
    return { n: this.filled, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
  }
}

export const answerProcessingMs = new Samples();
export const dbPingMs = new Samples();

const loop = monitorEventLoopDelay({ resolution: 20 });
loop.enable();

let liveness: () => Record<string, unknown> = () => ({});
let caches: () => Record<string, unknown> = () => ({});
export function registerMetricSources(sources: {
  rooms?: () => Record<string, unknown>;
  deezer?: () => Record<string, unknown>;
}): void {
  if (sources.rooms) liveness = sources.rooms;
  if (sources.deezer) caches = sources.deezer;
}

const startedAt = Date.now();
let lastRates = { at: Date.now(), in: 0, out: 0, deezer: 0 };
let rates = { messagesInPerSec: 0, framesOutPerSec: 0, deezerPerMinute: 0 };

/** Sampled on a timer so the rate does not depend on how often someone reads the endpoint. */
const sampler = setInterval(() => {
  const now = Date.now();
  const secs = (now - lastRates.at) / 1000;
  rates = {
    messagesInPerSec: Math.round((counters.wsMessagesIn - lastRates.in) / secs),
    framesOutPerSec: Math.round((counters.wsFramesOut - lastRates.out) / secs),
    deezerPerMinute: Math.round(((counters.deezerRequests - lastRates.deezer) / secs) * 60),
  };
  lastRates = {
    at: now,
    in: counters.wsMessagesIn,
    out: counters.wsFramesOut,
    deezer: counters.deezerRequests,
  };
  const t0 = performance.now();
  db.execute(sql`select 1`).then(
    () => dbPingMs.add(performance.now() - t0),
    (err) => logger.warn({ err }, 'Database ping failed'),
  );
}, 15_000);
sampler.unref();

export function metricsSnapshot() {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  return {
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    counters: { ...counters },
    rates,
    answerProcessingMs: answerProcessingMs.summary(),
    dbPingMs: dbPingMs.summary(),
    eventLoopLagMs: {
      p50: loop.percentile(50) / 1e6,
      p99: loop.percentile(99) / 1e6,
      max: loop.max / 1e6,
    },
    memoryMb: { rss: memory.rss / 1048576, heapUsed: memory.heapUsed / 1048576 },
    cpuSeconds: (cpu.user + cpu.system) / 1e6,
    rooms: liveness(),
    deezer: caches(),
  };
}
