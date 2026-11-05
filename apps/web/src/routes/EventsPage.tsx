import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { deleteEvent, deletePlaylist, listMyEvents, listPlaylists } from '../api/events';
import { EventForm } from '../features/events/EventForm';
import { Disc } from '../features/game/Disc';
import { formatDuration, PlaylistBuilder } from '../features/events/PlaylistBuilder';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSession } from '../hooks/useSession';
import type { HostedEvent, Playlist } from '../types/api';

type View =
  | { kind: 'home' }
  | { kind: 'playlist'; playlist: Playlist | null }
  | { kind: 'event'; event: HostedEvent | null };

const ENTER = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -6 },
  transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] as const },
};

const STATUS_LABEL: Record<HostedEvent['status'], string> = {
  open: 'Not started',
  live: 'Live',
  ended: 'Ended',
};

export function EventsPage() {
  usePageTitle('Events');
  const { user, loading } = useSession();
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ kind: 'home' });
  const [events, setEvents] = useState<HostedEvent[] | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canHost = user?.role === 'event_host' || user?.role === 'admin';

  const refresh = useCallback(async () => {
    try {
      const [e, p] = await Promise.all([listMyEvents(), listPlaylists()]);
      setEvents(e.events);
      setPlaylists(p.playlists);
      setError(null);
    } catch {
      setError('Could not load your events.');
    }
  }, []);

  useEffect(() => {
    if (canHost) void refresh();
  }, [canHost, refresh]);

  if (loading) return null;
  if (!canHost) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <h1 className="text-xl font-bold text-white">Hosting is by invitation</h1>
        <p className="mt-2 text-sm text-slate-400">
          {user
            ? 'Ask the Chorusify admin to make your account an event host.'
            : 'Log in with an event host account to run events.'}
        </p>
        <Link to={user ? '/multiplayer' : '/login'} className="btn-primary mt-5 inline-block">
          {user ? 'Back to multiplayer' : 'Log in'}
        </Link>
      </div>
    );
  }

  const act = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work.');
    }
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col gap-6 px-4 py-6 sm:py-10">
      <AnimatePresence mode="wait" initial={false}>
        {view.kind === 'playlist' ? (
          <motion.div key="playlist" {...ENTER}>
            <h1 className="mb-4 text-2xl font-extrabold text-white">
              {view.playlist ? 'Edit playlist' : 'New playlist'}
            </h1>
            <PlaylistBuilder
              initial={view.playlist}
              onCancel={() => setView({ kind: 'home' })}
              onSaved={() => {
                void refresh();
                setView({ kind: 'home' });
              }}
            />
          </motion.div>
        ) : view.kind === 'event' ? (
          <motion.div key="event" {...ENTER} className="mx-auto w-full max-w-2xl">
            <h1 className="mb-4 text-2xl font-extrabold text-white">
              {view.event ? 'Edit event' : 'New event'}
            </h1>
            <EventForm
              playlists={playlists}
              event={view.event}
              onCancel={() => setView({ kind: 'home' })}
              onSaved={(saved) => navigate(`/events/${saved.id}/live`)}
            />
          </motion.div>
        ) : (
          <motion.div key="home" {...ENTER} className="flex flex-col gap-10">
            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h1 className="text-2xl font-extrabold text-white">Your events</h1>
                <button
                  type="button"
                  disabled={playlists.length === 0}
                  onClick={() => setView({ kind: 'event', event: null })}
                  className="btn-primary !rounded-xl !py-2 !text-sm"
                >
                  New event
                </button>
              </div>
              {error && (
                <p role="alert" className="text-sm text-red-300">
                  {error}
                </p>
              )}
              {events?.length === 0 && (
                <p className="py-4 text-sm text-slate-400">
                  {playlists.length === 0
                    ? 'An event plays one of your playlists, so start by building one below.'
                    : 'Nothing yet. Create an event to get its join code and QR.'}
                </p>
              )}
              <ul className="divide-y divide-white/[0.07]">
                {events?.map((event) => (
                  <li key={event.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate font-semibold text-white">{event.name}</p>
                      <p className="text-xs text-slate-400">
                        <span className="font-mono">{event.code}</span> · {event.rounds} rounds ·{' '}
                        {event.audioMode === 'host_only' ? 'Host only' : 'Everyone plays'} ·{' '}
                        <span className={event.status === 'live' ? 'text-emerald-400' : undefined}>
                          {STATUS_LABEL[event.status]}
                        </span>
                        {event.status === 'ended' && ` · ${event.playerCount} players`}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {event.status !== 'ended' && (
                        <Link
                          to={`/events/${event.id}/live`}
                          className="btn-primary !rounded-lg !px-3 !py-1.5 !text-xs"
                        >
                          {event.status === 'live' ? 'Back to console' : 'Open console'}
                        </Link>
                      )}
                      {event.status === 'open' && (
                        <button
                          type="button"
                          onClick={() => setView({ kind: 'event', event })}
                          className="btn-secondary !rounded-lg !px-3 !py-1.5 !text-xs"
                        >
                          Edit
                        </button>
                      )}
                      {event.status !== 'live' && (
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete "${event.name}"? This cannot be undone.`)) {
                              void act(() => deleteEvent(event.id));
                            }
                          }}
                          className="btn-ghost !rounded-lg !px-3 !py-1.5 !text-xs"
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-white">Playlists</h2>
                <button
                  type="button"
                  onClick={() => setView({ kind: 'playlist', playlist: null })}
                  className="btn-secondary !rounded-xl !py-2 !text-sm"
                >
                  New playlist
                </button>
              </div>
              <ul className="divide-y divide-white/[0.07]">
                {playlists.map((playlist) => (
                  <li
                    key={playlist.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3"
                  >
                    <Disc size={44} art={playlist.tracks[0]?.albumArtUrl} />
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="truncate font-semibold text-white">{playlist.name}</p>
                      <p className="text-xs text-slate-400">
                        {playlist.tracks.filter((t) => !t.trial).length} songs
                        {playlist.tracks.some((t) => t.trial) ? ' + trial' : ''} ·{' '}
                        {formatDuration(playlist.tracks.reduce((s, t) => s + t.durationSeconds, 0))}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setView({ kind: 'playlist', playlist })}
                        className="btn-secondary !rounded-lg !px-3 !py-1.5 !text-xs"
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            window.confirm(
                              `Delete "${playlist.name}"? Events already made from it keep their songs.`,
                            )
                          ) {
                            void act(() => deletePlaylist(playlist.id));
                          }
                        }}
                        className="btn-ghost !rounded-lg !px-3 !py-1.5 !text-xs"
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
