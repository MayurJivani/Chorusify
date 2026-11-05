import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, Reorder, useDragControls } from 'motion/react';
import { ApiError } from '../../api/client';
import { importSpotify, savePlaylist, searchEventSongs, type SearchField } from '../../api/events';
import { SongPreviewButton } from '../game/SongPreviewButton';
import type { Playlist, PlaylistDecoy, PlaylistTrack, SongHit } from '../../types/api';

const SEARCH_DEBOUNCE_MS = 350;
const MAX_TRACKS = 200;

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h ? `${h}h ${m}m` : `${m}:${String(s).padStart(2, '0')}`;
}

/** Debounced search that cancels what it no longer wants and never asks twice for the same thing. */
function useSongSearch(query: string, field: SearchField) {
  const [results, setResults] = useState<SongHit[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error' | 'done'>('idle');
  const [message, setMessage] = useState('');
  const cache = useRef(new Map<string, SongHit[]>());

  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const key = `${field}:${q}`;
    const hit = cache.current.get(key);
    if (hit) {
      setResults(hit);
      setStatus('done');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setStatus('loading');
      searchEventSongs(q, field, controller.signal).then(
        ({ results: found }) => {
          cache.current.set(key, found);
          setResults(found);
          setStatus('done');
        },
        (err: unknown) => {
          if (controller.signal.aborted) return;
          setStatus('error');
          setMessage(err instanceof ApiError ? err.message : 'Search failed. Try again.');
        },
      );
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, field]);

  return { results, status, message };
}

const toTrack = ({ previewUrl: _previewUrl, ...track }: SongHit): PlaylistTrack => track;

interface PlaylistBuilderProps {
  initial: Playlist | null;
  onSaved: (playlist: Playlist) => void;
  onCancel: () => void;
}

export function PlaylistBuilder({ initial, onSaved, onCancel }: PlaylistBuilderProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [tracks, setTracks] = useState<PlaylistTrack[]>(initial?.tracks ?? []);
  const [trialTrack, setTrialTrack] = useState<PlaylistTrack | null>(initial?.trialTrack ?? null);
  const [query, setQuery] = useState('');
  const [field, setField] = useState<SearchField>('any');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { results, status, message } = useSongSearch(query, field);
  const [spotifyUrl, setSpotifyUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importNote, setImportNote] = useState<string | null>(null);

  const runImport = async () => {
    setImporting(true);
    setImportNote(null);
    try {
      const found = await importSpotify(spotifyUrl.trim());
      let added = 0;
      setTracks((prev) => {
        const have = new Set(prev.map((t) => t.deezerTrackId));
        const fresh = found.matched.filter((h) => !have.has(h.deezerTrackId)).map(toTrack);
        const next = [...prev, ...fresh].slice(0, MAX_TRACKS);
        added = next.length - prev.length;
        return next;
      });
      if (!name.trim()) setName(found.name.slice(0, 80));
      const missing = found.missing.map((t) => `${t.title} (${t.artist})`);
      setImportNote(
        `Added ${added} of ${found.matched.length + found.missing.length} songs.` +
          (missing.length ? ` Not on Deezer with a preview: ${missing.join(', ')}.` : ''),
      );
      setSpotifyUrl('');
    } catch (err) {
      setImportNote(err instanceof Error ? err.message : 'Import failed. Try again.');
    } finally {
      setImporting(false);
    }
  };

  const inList = useMemo(() => new Set(tracks.map((t) => t.deezerTrackId)), [tracks]);
  const totalSeconds = useMemo(
    () => tracks.reduce((sum, t) => sum + t.durationSeconds, 0),
    [tracks],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { playlist } = await savePlaylist(initial?.id ?? null, name.trim(), tracks, trialTrack);
      onSaved(playlist);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the playlist.');
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5 text-sm font-medium text-slate-300">
          Playlist name
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Freshers week bangers"
            className="event-input"
          />
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="btn-ghost !rounded-xl !py-2 !text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || !name.trim() || tracks.length === 0}
            className="btn-primary !rounded-xl !py-2 !text-sm"
          >
            {saving ? 'Saving…' : 'Save playlist'}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Search songs" className="flex min-w-0 flex-col gap-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (spotifyUrl.trim()) void runImport();
            }}
            className="flex gap-2"
          >
            <input
              value={spotifyUrl}
              onChange={(e) => setSpotifyUrl(e.target.value)}
              placeholder="Paste a Spotify playlist link"
              aria-label="Spotify playlist link"
              className="event-input min-w-0 flex-1"
            />
            <button
              type="submit"
              disabled={importing || !spotifyUrl.trim()}
              className="btn-secondary !rounded-xl !px-3 !py-2 !text-sm"
            >
              {importing ? 'Importing…' : 'Import'}
            </button>
          </form>
          {importing && (
            <p aria-live="polite" className="text-xs text-slate-400">
              Finding each song on Deezer. A long playlist takes up to a minute.
            </p>
          )}
          {importNote && (
            <p aria-live="polite" className="text-xs text-slate-300">
              {importNote}
            </p>
          )}
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={
                field === 'album'
                  ? 'Search albums'
                  : field === 'artist'
                    ? 'Search artists'
                    : 'Search songs'
              }
              aria-label="Search"
              className="event-input min-w-0 flex-1"
            />
            <select
              value={field}
              onChange={(e) => setField(e.target.value as SearchField)}
              aria-label="Search by"
              className="event-input w-auto"
            >
              <option value="any">Song</option>
              <option value="artist">Artist</option>
              <option value="album">Album</option>
            </select>
          </div>
          <p aria-live="polite" className="min-h-5 text-xs text-slate-400">
            {status === 'loading' && 'Searching…'}
            {status === 'error' && message}
            {status === 'done' && results.length === 0 && 'Nothing found. Try fewer words.'}
          </p>
          <ul className="flex max-h-[28rem] flex-col gap-1.5 overflow-y-auto pr-1">
            <AnimatePresence initial={false} mode="popLayout">
              {results.map((song, i) => {
                const added = inList.has(song.deezerTrackId);
                return (
                  <motion.li
                    key={song.deezerTrackId}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: 0.22,
                      delay: Math.min(i, 8) * 0.018,
                      ease: [0.16, 1, 0.3, 1],
                    }}
                    className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] p-2"
                  >
                    <TrackArt url={song.albumArtUrl} />
                    <TrackText track={song} />
                    {song.previewUrl ? (
                      <SongPreviewButton previewUrl={song.previewUrl} />
                    ) : (
                      <span className="text-xs text-slate-400">No audio</span>
                    )}
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.92 }}
                      disabled={added || !song.previewUrl || tracks.length >= MAX_TRACKS}
                      onClick={() => setTracks((prev) => [...prev, toTrack(song)])}
                      aria-label={added ? `${song.title} is in the playlist` : `Add ${song.title}`}
                      className="btn-secondary !rounded-lg !px-2.5 !py-1 !text-xs"
                    >
                      {added ? 'Added' : 'Add'}
                    </motion.button>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ul>
        </section>

        <section aria-label="Playlist" className="flex min-w-0 flex-col gap-3">
          <section aria-label="Trial song" className="flex flex-col gap-1.5 text-sm">
            <p className="font-medium text-slate-300">Trial song (optional)</p>
            <p className="text-xs text-slate-400">
              Plays before the game so everyone learns how it works. Its points do not count, and
              you start the real game after it.
            </p>
            {trialTrack ? (
              <div className="flex items-center gap-2.5 rounded-xl bg-white/[0.03] p-2">
                <TrackArt url={trialTrack.albumArtUrl} />
                <TrackText track={trialTrack} />
                <button
                  type="button"
                  onClick={() => setTrialTrack(null)}
                  className="btn-ghost !rounded-lg !px-2.5 !py-1 !text-xs"
                >
                  Remove
                </button>
              </div>
            ) : (
              <SongPicker
                exclude={tracks.map((t) => t.deezerTrackId)}
                actionLabel="Use as trial"
                onPick={(hit) => setTrialTrack(toTrack(hit))}
              />
            )}
          </section>
          <p className="text-sm text-slate-300">
            <span className="font-semibold tabular-nums text-white">{tracks.length}</span>{' '}
            {tracks.length === 1 ? 'song' : 'songs'} ·{' '}
            <span className="tabular-nums">{formatDuration(totalSeconds)}</span>
            {tracks.length > 0 && tracks.length < 4 && (
              <span className="text-slate-400"> · an event needs at least 4</span>
            )}
          </p>
          {tracks.length === 0 ? (
            <p className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">
              Search and add songs. Drag to set the order they play in.
            </p>
          ) : (
            // The scrolling lives on a plain wrapper: a Reorder.Group that scrolls itself ignores the
            // wheel, and rows drag by their grip only so a finger swipe scrolls instead.
            <motion.div layoutScroll className="max-h-[28rem] overflow-y-auto pr-1">
              <Reorder.Group
                axis="y"
                values={tracks}
                onReorder={setTracks}
                className="flex flex-col gap-1.5"
              >
                {tracks.map((track, i) => (
                  <PlaylistRow
                    key={track.deezerTrackId}
                    track={track}
                    index={i}
                    last={i === tracks.length - 1}
                    setTracks={setTracks}
                  />
                ))}
              </Reorder.Group>
            </motion.div>
          )}
        </section>
      </div>
    </div>
  );
}

function PlaylistRow({
  track,
  index,
  last,
  setTracks,
}: {
  track: PlaylistTrack;
  index: number;
  last: boolean;
  setTracks: React.Dispatch<React.SetStateAction<PlaylistTrack[]>>;
}) {
  const controls = useDragControls();
  const [editing, setEditing] = useState(false);
  const decoys = track.decoys ?? [];
  const setDecoys = (next: PlaylistDecoy[]) =>
    setTracks((prev) =>
      prev.map((t) => (t === track ? { ...t, decoys: next.length ? next : undefined } : t)),
    );

  return (
    <Reorder.Item
      value={track}
      dragListener={false}
      dragControls={controls}
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      whileDrag={{ scale: 1.02, boxShadow: '0 12px 28px rgba(0,0,0,0.45)' }}
      className="rounded-xl bg-chorusify-surface-2 p-2"
    >
      <div className="flex items-center gap-2.5">
        <span
          onPointerDown={(e) => controls.start(e)}
          aria-hidden="true"
          title="Drag to reorder"
          className="w-6 cursor-grab touch-none select-none text-right text-xs tabular-nums text-slate-400 active:cursor-grabbing"
        >
          ⠿{index + 1}
        </span>
        <TrackArt url={track.albumArtUrl} />
        <TrackText track={track} />
        <button
          type="button"
          onClick={() => setEditing((v) => !v)}
          aria-expanded={editing}
          aria-label={`Wrong answers for ${track.title}`}
          className="rounded-lg px-2 py-1 text-[11px] text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          Options {decoys.length}/3
        </button>
        <span className="flex flex-col">
          <MoveButton
            label={`Move ${track.title} up`}
            disabled={index === 0}
            dir={-1}
            index={index}
            setTracks={setTracks}
          />
          <MoveButton
            label={`Move ${track.title} down`}
            disabled={last}
            dir={1}
            index={index}
            setTracks={setTracks}
          />
        </span>
        <button
          type="button"
          onClick={() => setTracks((prev) => prev.filter((t) => t !== track))}
          aria-label={`Remove ${track.title}`}
          className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M2 2l10 10M12 2L2 12" />
          </svg>
        </button>
      </div>
      {editing && (
        <div className="mt-2 flex flex-col gap-2 border-t border-white/5 pt-2">
          <p className="text-xs text-slate-400">
            Pick up to 3 wrong answers. Any you leave empty come from the rest of the playlist.
          </p>
          {decoys.map((d) => (
            <div key={d.deezerTrackId} className="flex items-center gap-2.5">
              <TrackArt url={d.albumArtUrl} />
              <TrackText track={{ ...d, album: null, durationSeconds: 0 }} />
              <button
                type="button"
                onClick={() => setDecoys(decoys.filter((x) => x !== d))}
                aria-label={`Remove ${d.title} from the options`}
                className="btn-ghost !rounded-lg !px-2.5 !py-1 !text-xs"
              >
                Remove
              </button>
            </div>
          ))}
          {decoys.length < 3 && (
            <SongPicker
              exclude={[track.deezerTrackId, ...decoys.map((d) => d.deezerTrackId)]}
              actionLabel="Use"
              onPick={(hit) =>
                setDecoys([
                  ...decoys,
                  {
                    deezerTrackId: hit.deezerTrackId,
                    title: hit.title,
                    artist: hit.artist,
                    albumArtUrl: hit.albumArtUrl,
                  },
                ])
              }
            />
          )}
        </div>
      )}
    </Reorder.Item>
  );
}

/** A small song search with one action per result. */
export function SongPicker({
  exclude,
  actionLabel,
  onPick,
}: {
  exclude: string[];
  actionLabel: string;
  onPick: (hit: SongHit) => void;
}) {
  const [query, setQuery] = useState('');
  const { results, status, message } = useSongSearch(query, 'any');
  return (
    <div className="flex flex-col gap-1.5">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search songs"
        aria-label="Search songs"
        className="event-input"
      />
      <p aria-live="polite" className="text-xs text-slate-400 empty:hidden">
        {status === 'loading' && 'Searching…'}
        {status === 'error' && message}
        {status === 'done' && results.length === 0 && 'Nothing found.'}
      </p>
      <ul className="flex max-h-56 flex-col gap-1 overflow-y-auto">
        {results
          .filter((hit) => !exclude.includes(hit.deezerTrackId))
          .map((hit) => (
            <li
              key={hit.deezerTrackId}
              className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] p-1.5"
            >
              <TrackArt url={hit.albumArtUrl} />
              <TrackText track={hit} />
              <button
                type="button"
                onClick={() => {
                  onPick(hit);
                  setQuery('');
                }}
                className="btn-secondary !rounded-lg !px-2.5 !py-1 !text-xs"
              >
                {actionLabel}
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}

/** Dragging has no keyboard path, so ordering must work without it. */
function MoveButton({
  label,
  disabled,
  dir,
  index,
  setTracks,
}: {
  label: string;
  disabled: boolean;
  dir: -1 | 1;
  index: number;
  setTracks: React.Dispatch<React.SetStateAction<PlaylistTrack[]>>;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={() =>
        setTracks((prev) => {
          const next = [...prev];
          const [moved] = next.splice(index, 1);
          next.splice(index + dir, 0, moved!);
          return next;
        })
      }
      className="rounded px-1 text-slate-400 transition-colors hover:text-white disabled:opacity-25"
    >
      <svg width="10" height="8" viewBox="0 0 10 8" fill="currentColor" aria-hidden="true">
        <path d={dir < 0 ? 'M5 1l4 6H1z' : 'M5 7L1 1h8z'} />
      </svg>
    </button>
  );
}

export function TrackArt({ url }: { url: string | null }) {
  return url ? (
    <img
      src={url}
      alt=""
      loading="lazy"
      width={36}
      height={36}
      className="h-9 w-9 shrink-0 rounded-lg object-cover"
    />
  ) : (
    <span className="h-9 w-9 shrink-0 rounded-lg bg-white/10" />
  );
}

export function TrackText({ track }: { track: PlaylistTrack }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm font-medium text-white">{track.title}</span>
      <span className="block truncate text-xs text-slate-400">
        {track.artist}
        {track.album ? ` · ${track.album}` : ''}
      </span>
    </span>
  );
}
