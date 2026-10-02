import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useSession } from '../hooks/useSession';
import { getMyDuels, getRatingLeaderboard, type DuelMode } from '../api/duels';
import { SourcePicker, type PickedSource } from '../features/multiplayer/SourcePicker';
import { useDuelQueue, queueKeyFor, type DuelQueueRequest } from '../features/duels/useDuelQueue';
import { usePageTitle } from '../hooks/usePageTitle';
import type { DuelView, RatingStanding } from '../types/api';

function formatDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

/** A live dot with a count, so "is anyone actually here?" is answerable at a glance. */
function WaitingBadge({ count }: { count: number }) {
  if (count <= 0) {
    return <span className="text-[11px] text-slate-500">nobody waiting</span>;
  }
  return (
    <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
      </span>
      {count} waiting
    </span>
  );
}

/**
 * Live rated 1v1.
 *
 * You queue for a specific artist or category and are only paired with someone who chose the
 * same one — which is the point, but also means a queue can be empty. The waiting counts are
 * therefore not decoration: without them, picking is a guess about whether anyone else is
 * there, and a player who waits alone once tends not to come back.
 */
export function DuelsPage() {
  usePageTitle('Duels');
  const { user, loading } = useSession();
  const navigate = useNavigate();

  const [mine, setMine] = useState<DuelView[]>([]);
  const [board, setBoard] = useState<RatingStanding[]>([]);
  const [source, setSource] = useState<PickedSource | null>(null);
  const [searchParams] = useSearchParams();
  const preselectSoundtrackId = searchParams.get('soundtrackId') ?? undefined;
  /** Which ladder the board is showing. Ratings are per mode, so it has to say which. */
  const [boardMode, setBoardMode] = useState<DuelMode>('artist');

  const signedIn = !loading && user != null;
  const queue = useDuelQueue(signedIn);

  const userId = user?.id;
  const refresh = useCallback(async () => {
    const ratings = await getRatingLeaderboard(boardMode).catch(() => null);
    if (ratings) setBoard(ratings.entries);
    if (!userId) return;
    setMine(await getMyDuels().catch(() => []));
  }, [userId, boardMode]);

  useEffect(() => {
    if (loading) return;
    void refresh();
  }, [loading, refresh]);

  // The moment the server pairs us, the room already exists — go straight into it.
  useEffect(() => {
    if (queue.matchedCode) navigate(`/room/${queue.matchedCode}`);
  }, [queue.matchedCode, navigate]);

  const countFor = (request: DuelQueueRequest): number =>
    queue.counts.find((c) => c.key === queueKeyFor(request))?.count ?? 0;

  const chosen: DuelQueueRequest | null =
    source == null
      ? null
      : source.kind === 'artist'
        ? { kind: 'artist', artistId: source.artist.id, label: source.artist.name }
        : source.kind === 'soundtrack'
          ? {
              kind: 'soundtrack',
              collectionId: source.collection.id,
              label: source.collection.label,
            }
          : {
              kind: 'category',
              categoryId: source.categories[0]!.id,
              label: source.categories[0]!.label,
            };

  const randomRequest: DuelQueueRequest = { kind: 'random', label: 'Any artist' };
  const queueing = queue.status === 'queued';

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-5 px-4 py-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-1 text-center"
      >
        <h1 className="flex items-center justify-center gap-2 text-3xl font-extrabold tracking-tight text-white">
          Duels
          {/* Beta because the ratings are real but young: the ladders were reset recently and a
              rating only means something once enough duels have settled on it. */}
          <span className="rounded-full border border-chorusify-accent2/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-chorusify-accent2">
            Beta
          </span>
        </h1>
        <p className="text-sm text-slate-500">Live 1v1 - same songs, same moment, rated</p>
      </motion.div>

      {queue.error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {queue.error}
        </p>
      )}

      {!signedIn ? (
        <div className="glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center">
          <p className="text-sm text-slate-300">
            Duels are rated, so they need an account. A rating tied to a browser cookie would vanish
            the moment you cleared it.
          </p>
          <div className="flex gap-2">
            <Link to="/register" className="btn-primary !py-2 text-sm">
              Create an account
            </Link>
            <Link to="/login" className="btn-secondary !py-2 text-sm">
              Log in
            </Link>
          </div>
        </div>
      ) : queueing ? (
        <motion.section
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass flex flex-col items-center gap-3 rounded-2xl p-6 text-center"
        >
          <span className="relative flex h-3 w-3">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-chorusify-accent2 opacity-70" />
            <span className="relative inline-flex h-3 w-3 rounded-full bg-chorusify-accent2" />
          </span>
          <div>
            <p className="font-bold text-white">Looking for an opponent…</p>
            <p className="mt-0.5 text-xs text-slate-400">
              {queue.queuedLabel} · you&apos;ll drop straight into the duel when someone joins
            </p>
          </div>
          <button
            type="button"
            onClick={queue.leave}
            className="btn-ghost w-full !rounded-xl !py-2.5 !text-sm"
          >
            Cancel
          </button>
        </motion.section>
      ) : (
        <section className="glass flex flex-col gap-4 rounded-2xl p-5">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="font-bold text-white">Find a duel</h2>
            <span className="text-[11px] text-slate-500">
              {queue.total > 0 ? `${queue.total} in the queue` : 'queue is empty'}
            </span>
          </div>

          {/* Quickest path: no picking, and the busiest line because everyone lands in it. */}
          <button
            type="button"
            onClick={() => queue.join(randomRequest)}
            disabled={queue.status === 'connecting'}
            className="flex items-center justify-between gap-3 rounded-xl border border-chorusify-accent2/40 bg-chorusify-accent2/10 px-4 py-3 text-left transition-all hover:border-chorusify-accent2/70 hover:bg-chorusify-accent2/20 disabled:opacity-50"
          >
            <span>
              <span className="block text-sm font-semibold text-white">Any artist</span>
              <span className="block text-[11px] text-slate-400">
                Fastest match - the server picks
              </span>
            </span>
            <WaitingBadge count={countFor(randomRequest)} />
          </button>

          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Or race something specific
            </p>
            <SourcePicker
              value={source}
              onChange={setSource}
              compact
              preselectSoundtrackId={preselectSoundtrackId}
            />
          </div>

          {chosen && (
            <button
              type="button"
              onClick={() => queue.join(chosen)}
              disabled={queue.status === 'connecting'}
              className="btn-primary flex w-full items-center justify-center gap-2 !rounded-xl disabled:opacity-50"
            >
              Queue for {chosen.label}
              {countFor(chosen) > 0 && (
                <span className="rounded-full bg-black/20 px-2 py-0.5 text-[11px] font-bold">
                  {countFor(chosen)} waiting
                </span>
              )}
            </button>
          )}

          {queue.counts.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
                People are waiting on
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {queue.counts.map((c) => (
                  <li
                    key={c.key}
                    className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.03] px-2 py-1 text-[11px] text-slate-300"
                  >
                    {c.label}
                    <span className="font-bold text-emerald-400">{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {user && mine.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
            Recent duels
          </h2>
          <ul className="flex flex-col gap-2">
            {mine.map((duel) => {
              const youAreChallenger = duel.challenger.userId === user.id;
              const them = youAreChallenger ? duel.opponent : duel.challenger;
              const delta =
                duel.ratingChange == null
                  ? null
                  : youAreChallenger
                    ? duel.ratingChange.challenger
                    : duel.ratingChange.opponent;

              return (
                <li
                  key={duel.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{duel.label}</p>
                    <p className="truncate text-xs text-slate-400">
                      {them ? `vs ${them.displayName}` : 'No opponent'}
                      {duel.forfeited && ' · forfeit'}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold text-white">
                      {duel.status !== 'complete'
                        ? '-'
                        : duel.winnerId == null
                          ? 'Draw'
                          : duel.winnerId === user.id
                            ? 'Won'
                            : 'Lost'}
                    </p>
                    {delta != null && (
                      <p
                        className={
                          'font-mono text-xs ' +
                          (delta > 0
                            ? 'text-emerald-400'
                            : delta < 0
                              ? 'text-red-400'
                              : 'text-slate-400')
                        }
                      >
                        {formatDelta(delta)}
                      </p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Ratings</h2>
          {/* One ladder per mode: the skills are different, so the numbers are too. */}
          <div className="flex gap-1 rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
            {(
              [
                ['artist', 'Artist'],
                ['category', 'Category'],
                ['soundtrack', 'Movie'],
                ['random', 'Any'],
              ] as [DuelMode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setBoardMode(value)}
                aria-pressed={boardMode === value}
                className={
                  'rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ' +
                  (boardMode === value
                    ? 'bg-white/10 text-white'
                    : 'text-slate-400 hover:text-white')
                }
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        {board.length === 0 ? (
          <p className="text-sm text-slate-400">
            Nobody has finished a rated duel in this mode yet. Everyone starts on 1200.
          </p>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {board.map((entry) => (
              <li
                key={entry.rank}
                className={
                  'flex items-center justify-between rounded-xl border px-4 py-2.5 text-sm ' +
                  (entry.isYou
                    ? 'border-white/20 bg-white/10 font-medium text-white'
                    : 'border-white/5 bg-white/[0.02] text-slate-300')
                }
              >
                <span className="truncate pr-2">
                  #{entry.rank} {entry.displayName}
                  {entry.isYou ? ' (you)' : ''}
                </span>
                <span className="shrink-0 font-mono text-xs">
                  <span className="font-bold text-purple-300">{entry.rating}</span>{' '}
                  <span className="text-slate-500">
                    {entry.ratedDuels} {entry.ratedDuels === 1 ? 'duel' : 'duels'}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
