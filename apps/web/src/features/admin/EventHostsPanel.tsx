import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../../api/client';
import { updateAdminUser } from '../../api/admin';

interface HostRow {
  id: string;
  email: string;
  displayName: string;
  eventCount: number;
}
interface EventRow {
  id: string;
  code: string;
  name: string;
  status: string;
  audioMode: string;
  playerCount: number;
  hostName: string;
  createdAt: string;
}
interface Metrics {
  rates: { messagesInPerSec: number; framesOutPerSec: number; deezerPerMinute: number };
  answerProcessingMs: { p95: number };
  eventLoopLagMs: { p99: number };
  memoryMb: { rss: number };
  rooms: { connections: number; eventsRunning: number };
  deezer: { breakerOpen: boolean; searchCache: { hits: number; misses: number } };
  counters: { deezerErrors: number; reconnects: number; deezerCoalesced: number };
}

/** Promotion happens on the Users tab, where accounts can be searched. This is the current list. */
export function EventHostsPanel() {
  const [hosts, setHosts] = useState<HostRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [h, e, m] = await Promise.all([
        apiRequest<{ hosts: HostRow[] }>('/admin/event-hosts', { skipCache: true }),
        apiRequest<{ events: EventRow[] }>('/admin/events', { skipCache: true }),
        apiRequest<Metrics>('/admin/metrics', { skipCache: true }),
      ]);
      setHosts(h.hosts);
      setEvents(e.events);
      setMetrics(m);
    } catch {
      setError('Could not load event hosts.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 15_000);
    return () => clearInterval(timer);
  }, [refresh]);

  const revoke = async (host: HostRow) => {
    if (!window.confirm(`Stop ${host.displayName} hosting? Any event they are running ends now.`)) return;
    await updateAdminUser(host.id, { role: 'user' }).catch(() => setError('Could not revoke.'));
    void refresh();
  };

  const hitRate = metrics
    ? Math.round(
        (metrics.deezer.searchCache.hits /
          Math.max(1, metrics.deezer.searchCache.hits + metrics.deezer.searchCache.misses)) *
          100,
      )
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <section>
        <h2 className="mb-2 font-semibold text-white">Event hosts</h2>
        {hosts.length === 0 && (
          <p className="text-sm text-slate-400">None yet. Promote an account from the Users tab.</p>
        )}
        <ul className="divide-y divide-white/[0.07]">
          {hosts.map((host) => (
            <li key={host.id} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0 truncate text-slate-200">
                {host.displayName} <span className="text-slate-400">{host.email}</span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <span className="tabular-nums text-slate-400">{host.eventCount} events</span>
                <button type="button" onClick={() => void revoke(host)} className="btn-ghost !rounded-lg !px-3 !py-1 !text-xs">
                  Revoke
                </button>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-semibold text-white">Events</h2>
        <ul className="divide-y divide-white/[0.07]">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap justify-between gap-x-3 py-2 text-sm">
              <span className="min-w-0 truncate text-slate-200">{event.name}</span>
              <span className="text-xs text-slate-400">
                {event.hostName} · <span className="font-mono">{event.code}</span> · {event.status} ·{' '}
                {event.playerCount} players
              </span>
            </li>
          ))}
        </ul>
      </section>
      {metrics && (
        <section>
          <h2 className="mb-2 font-semibold text-white">Server right now</h2>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-3">
            {(
              [
                ['Connections', metrics.rooms.connections],
                ['Events running', metrics.rooms.eventsRunning],
                ['Frames out / s', metrics.rates.framesOutPerSec],
                ['Messages in / s', metrics.rates.messagesInPerSec],
                ['Answer p95', `${metrics.answerProcessingMs.p95.toFixed(2)} ms`],
                ['Event loop p99', `${metrics.eventLoopLagMs.p99.toFixed(0)} ms`],
                ['Memory', `${Math.round(metrics.memoryMb.rss)} MB`],
                ['Reconnects', metrics.counters.reconnects],
                ['Deezer calls / min', metrics.rates.deezerPerMinute],
                ['Deezer errors', metrics.counters.deezerErrors],
                ['Deezer', metrics.deezer.breakerOpen ? 'Paused (failing)' : 'OK'],
                ['Search cache hits', `${hitRate}%`],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex justify-between gap-2">
                <dt className="text-slate-400">{label}</dt>
                <dd className="font-medium tabular-nums text-white">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}
    </div>
  );
}
