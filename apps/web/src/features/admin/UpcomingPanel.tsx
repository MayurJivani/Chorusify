import { useCallback, useEffect, useState } from 'react';
import { getUpcomingSchedule, randomizeDailyPuzzle, setDailyPuzzle } from '../../api/admin';
import { SongPicker } from './SongPicker';
import type { UpcomingDay } from '../../types/api';

const slotKey = (date: string, position: number) => `${date}#${position}`;

/**
 * What the next two weeks will play.
 *
 * The picker is deterministic, so upcoming days can be projected rather than created: asking the
 * database would show nothing, because a slot has no row until somebody opens it or an admin
 * pins it. A projected slot is marked as such — it is what *would* be chosen, and stays free to
 * change until it is either played or pinned here. Each day is now up to five songs, each its
 * own independently shuffleable/pinnable slot.
 */
export function UpcomingPanel() {
  const [days, setDays] = useState<UpcomingDay[]>([]);
  const [today, setToday] = useState('');
  const [loading, setLoading] = useState(true);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const [editingSlot, setEditingSlot] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const schedule = await getUpcomingSchedule(14);
      setDays(schedule.days);
      setToday(schedule.today);
    } catch {
      setError('Couldn’t load the upcoming schedule.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const run = async (key: string, action: () => Promise<unknown>, message: string) => {
    setBusySlot(key);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That didn’t work.');
    } finally {
      setBusySlot(null);
    }
  };

  if (loading) return <p className="text-sm text-slate-400">Loading upcoming days…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-200">Coming up</h3>
        <p className="text-xs text-slate-500">
          Projected from the automatic picker. Shuffle or set a song to pin it.
        </p>
      </div>

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

      <ul className="flex flex-col gap-2">
        {days.map((day) => (
          <li
            key={day.puzzleDate}
            className="flex flex-col gap-2 rounded-xl border border-white/5 bg-white/[0.02] p-3"
          >
            <p className="flex items-center gap-2 font-mono text-xs text-slate-500">
              {day.puzzleDate}
              {day.puzzleDate === today && (
                <span className="rounded-full bg-chorusify-accent/20 px-2 py-0.5 text-[10px] font-semibold text-chorusify-accent">
                  today
                </span>
              )}
            </p>

            <ul className="flex flex-col gap-1.5">
              {day.slots.map((slot) => {
                const key = slotKey(day.puzzleDate, slot.position);
                return (
                  <li
                    key={key}
                    className="flex flex-col gap-2 rounded-lg border border-white/5 bg-black/10 p-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[11px] text-slate-500">
                          Song {slot.position}
                          <span
                            className={
                              'rounded-full px-2 py-0.5 text-[10px] font-semibold ' +
                              (slot.scheduled
                                ? 'bg-emerald-500/15 text-emerald-300'
                                : 'bg-white/5 text-slate-500')
                            }
                          >
                            {slot.scheduled ? 'set' : 'projected'}
                          </span>
                        </p>
                        <p className="truncate text-sm font-semibold text-white">
                          {slot.song ? slot.song.title : 'No song available'}
                        </p>
                        {slot.song && (
                          <p className="truncate text-xs text-slate-400">{slot.song.artist}</p>
                        )}
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          disabled={busySlot === key}
                          onClick={() =>
                            void run(
                              key,
                              () => randomizeDailyPuzzle(day.puzzleDate, slot.position),
                              `${day.puzzleDate} song ${slot.position} shuffled onto a new song.`,
                            )
                          }
                          className="btn-ghost !py-1 text-xs disabled:opacity-40"
                        >
                          {busySlot === key ? 'Shuffling…' : 'Shuffle'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingSlot(editingSlot === key ? null : key)}
                          className="btn-ghost !py-1 text-xs"
                        >
                          Pick
                        </button>
                      </div>
                    </div>

                    {editingSlot === key && (
                      <SongPicker
                        heading={`Song ${slot.position} for ${day.puzzleDate}`}
                        onCancel={() => setEditingSlot(null)}
                        onPick={(song) =>
                          void run(
                            key,
                            () => setDailyPuzzle(day.puzzleDate, slot.position, song.id),
                            `${day.puzzleDate} song ${slot.position} is now “${song.title}”.`,
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
    </div>
  );
}
