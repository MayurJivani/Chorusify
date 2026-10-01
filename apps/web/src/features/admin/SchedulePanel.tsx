import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  getDailyPuzzles,
  setDailyPuzzle,
  unscheduleDailyPuzzle,
  updateSongFlags,
} from '../../api/admin';
import { SongPicker } from './SongPicker';
import { UpcomingPanel } from './UpcomingPanel';
import type { AdminDailyPuzzle } from '../../types/api';

const SLOTS_PER_DAY = 5;
const slotKey = (date: string, position: number) => `${date}#${position}`;

/**
 * The daily puzzle schedule.
 *
 * Controls that the server would reject — past dates, songs somebody has already finished —
 * are hidden rather than shown-and-refused, so the reason is visible up front. Hiding them is a
 * courtesy; the server enforces both rules regardless of what this page renders. Each date is
 * grouped here from the flat row list the server returns, since a date is now up to five songs.
 */
export function SchedulePanel() {
  const [puzzles, setPuzzles] = useState<AdminDailyPuzzle[]>([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [newDate, setNewDate] = useState('');
  const [newPosition, setNewPosition] = useState(1);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getDailyPuzzles();
      setPuzzles(list.puzzles);
      setToday(list.today);
    } catch {
      setError('Couldn’t load the schedule.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const byDate = useMemo(() => {
    const groups = new Map<string, AdminDailyPuzzle[]>();
    for (const puzzle of puzzles) {
      const bucket = groups.get(puzzle.puzzleDate) ?? [];
      bucket.push(puzzle);
      groups.set(puzzle.puzzleDate, bucket);
    }
    return groups;
  }, [puzzles]);

  const run = async (action: () => Promise<unknown>, successMessage: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(successMessage);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.');
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Loading schedule…</p>;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <p className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-200">
          {notice}
        </p>
      )}

      <UpcomingPanel />

      <div className="h-px bg-white/10" />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
          Schedule a song
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={newDate}
            min={today}
            onChange={(e) => setNewDate(e.target.value)}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          />
          <select
            value={newPosition}
            onChange={(e) => setNewPosition(Number(e.target.value))}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white"
          >
            {Array.from({ length: SLOTS_PER_DAY }, (_, i) => i + 1).map((position) => (
              <option key={position} value={position}>
                Song {position}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!newDate}
            onClick={() => setEditingSlot(slotKey(newDate, newPosition))}
            className="btn-secondary !py-2 text-sm disabled:opacity-40"
          >
            Choose a song
          </button>
        </div>
        {editingSlot === slotKey(newDate, newPosition) && newDate && (
          <SongPicker
            heading={`Song ${newPosition} for ${newDate}`}
            onCancel={() => setEditingSlot(null)}
            onPick={(song) =>
              run(
                () => setDailyPuzzle(newDate, newPosition, song.id),
                `${newDate} song ${newPosition} is now “${song.title}” by ${song.artist}.`,
              ).then(() => setEditingSlot(null))
            }
          />
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-200">
          Scheduled puzzles
        </h2>

        {byDate.size === 0 ? (
          <p className="text-sm text-slate-400">
            Nothing scheduled yet. The picker fills each slot in the first time someone opens it.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {[...byDate.entries()].map(([puzzleDate, slots]) => (
              <li
                key={puzzleDate}
                className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3"
              >
                <p className="flex items-center gap-2 font-mono text-xs text-slate-500">
                  {puzzleDate}
                  {puzzleDate === today && (
                    <span className="rounded-full bg-chorusify-accent/20 px-2 py-0.5 text-[10px] font-semibold text-chorusify-accent">
                      today
                    </span>
                  )}
                </p>

                <ul className="flex flex-col gap-1.5">
                  {slots.map((puzzle) => {
                    const key = slotKey(puzzle.puzzleDate, puzzle.position);
                    const locked = puzzle.plays > 0 || puzzle.puzzleDate < today;
                    return (
                      <li
                        key={puzzle.id}
                        className="flex flex-col gap-2 rounded-lg border border-white/5 bg-black/10 p-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-500">Song {puzzle.position}</p>
                            <p className="truncate text-sm font-semibold text-white">
                              {puzzle.title}
                            </p>
                            <p className="truncate text-xs text-slate-400">{puzzle.artist}</p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <span className="font-mono text-xs text-slate-500">
                              {puzzle.plays} {puzzle.plays === 1 ? 'play' : 'plays'}
                            </span>
                            {locked ? (
                              <span className="text-xs text-slate-600">
                                {puzzle.plays > 0 ? 'played, locked' : 'past'}
                              </span>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => setEditingSlot(editingSlot === key ? null : key)}
                                  className="btn-ghost !py-1 text-xs"
                                >
                                  Change song
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void run(
                                      () =>
                                        unscheduleDailyPuzzle(puzzle.puzzleDate, puzzle.position),
                                      `${puzzle.puzzleDate} song ${puzzle.position} unscheduled. It will be re-picked automatically.`,
                                    )
                                  }
                                  className="btn-ghost !py-1 text-xs text-red-300 hover:text-red-200"
                                >
                                  Remove
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {!puzzle.manualOverride && (
                          <button
                            type="button"
                            onClick={() =>
                              void run(
                                () => updateSongFlags(puzzle.songId, { manualOverride: true }),
                                `“${puzzle.title}” added to the curated pool.`,
                              )
                            }
                            className="self-start text-xs text-slate-500 underline decoration-dotted hover:text-slate-300"
                          >
                            Not in the curated pool, add it
                          </button>
                        )}

                        {editingSlot === key && !locked && (
                          <SongPicker
                            heading={`Replace song ${puzzle.position} for ${puzzle.puzzleDate}`}
                            onCancel={() => setEditingSlot(null)}
                            onPick={(song) =>
                              run(
                                () => setDailyPuzzle(puzzle.puzzleDate, puzzle.position, song.id),
                                `${puzzle.puzzleDate} song ${puzzle.position} is now “${song.title}” by ${song.artist}.`,
                              ).then(() => setEditingSlot(null))
                            }
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
