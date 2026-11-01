import { useEffect, useState } from 'react';
import { getAdminDashboard } from '../../api/admin';
import type { AdminDashboard, MostPlayedArtist } from '../../types/api';

/** The at-a-glance view: what the game is made of, what people are doing with it, and whether
 *  the caches are healthy. One request, so every number is from the same instant. */
export function OverviewPanel() {
  const [data, setData] = useState<AdminDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getAdminDashboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-sm text-slate-400">Loading dashboard…</p>;
  if (!data) return <p className="text-sm text-slate-400">Couldn’t load the dashboard.</p>;

  const { content, players, activity, caches, topArtists, topCategories, liveRooms } = data;

  return (
    <div className="flex flex-col gap-6">
      <Section title="Activity">
        <Stat label="Daily plays (24h)" value={activity.dailyPlays24h} />
        <Stat label="Daily plays (7d)" value={activity.dailyPlays7d} />
        <Stat label="Artist runs (7d)" value={activity.artistRuns7d} />
        <Stat label="Category runs (7d)" value={activity.categoryRuns7d} />
        <Stat label="Runs in progress" value={activity.runsInProgress} />
        <Stat
          label="Live rooms"
          value={liveRooms.total}
          hint={liveRooms.playing > 0 ? `${liveRooms.playing} playing` : 'none playing'}
        />
      </Section>

      <Section title="Players">
        <Stat label="Accounts" value={players.total} />
        <Stat label="Event hosts" value={players.eventHosts} />
        <Stat label="New this week" value={players.newThisWeek} />
        <Stat label="Signed in this week" value={players.activeThisWeek} />
      </Section>

      <Section title="Song bank">
        <Stat label="Songs" value={content.total} />
        <Stat label="Active" value={content.active} />
        <Stat
          label="Curated pool"
          value={content.curated}
          hint={content.curated === 0 ? 'daily is falling back to all active songs' : undefined}
        />
      </Section>

      <Section title="Deezer cache">
        <Stat label="Artist pools" value={caches.artistPools} />
        <Stat label="Category pools" value={caches.categoryPools} />
        <Stat label="Cached tracks" value={caches.tracks} />
        <Stat
          label="Idlest pool"
          value={
            caches.oldestIdleSeconds == null ? 0 : Math.floor(caches.oldestIdleSeconds / 86400)
          }
          hint="days since last opened"
        />
      </Section>

      <div className="grid gap-4 sm:grid-cols-2">
        <TopList title="Most played artists (all time)" rows={topArtists} />
        <TopList title="Most played categories (all time)" rows={topCategories} />
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">{title}</h3>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className="font-mono text-xl font-bold text-white">{value}</p>
      {hint && <p className="mt-0.5 text-[10px] leading-snug text-slate-600">{hint}</p>}
    </div>
  );
}

function TopList({ title, rows }: { title: string; rows: MostPlayedArtist[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing finished yet.</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {rows.map((row, i) => (
            <li
              key={row.deezerArtistId}
              className="flex items-center gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-3 py-1.5 text-sm"
            >
              <span className="w-4 font-mono text-xs text-slate-600">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-slate-200">{row.artistName}</span>
              <span className="shrink-0 font-mono text-xs text-slate-500">
                {row.runs} {row.runs === 1 ? 'run' : 'runs'} · avg {row.averageScore}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
