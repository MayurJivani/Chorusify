import { useEffect, useState } from 'react';
import {
  addSongFromDeezer,
  searchAdminSongs,
  searchDeezer,
  type DeezerSearchHit,
} from '../../api/admin';
import type { AdminSong } from '../../types/api';

function CoverRow({
  art,
  title,
  subtitle,
  onPick,
}: {
  art: string | null;
  title: string;
  subtitle: string;
  onPick: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left text-sm text-slate-300 hover:bg-white/5 hover:text-white"
      >
        {art ? (
          <img src={art} alt="" loading="lazy" className="h-9 w-9 flex-none rounded object-cover" />
        ) : (
          <span className="h-9 w-9 flex-none rounded bg-white/10" />
        )}
        <span className="min-w-0 truncate">
          {title} <span className="text-slate-500">{subtitle}</span>
        </span>
      </button>
    </li>
  );
}

/** Pick a cover from the whole song bank, or from anything on Deezer. */
export function CoverPicker({
  onPick,
  onClose,
}: {
  onPick: (song: AdminSong) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [pool, setPool] = useState<AdminSong[]>([]);
  const [more, setMore] = useState(false);
  const [deezer, setDeezer] = useState<DeezerSearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSearching(true);
    const timer = setTimeout(() => {
      Promise.all([searchAdminSongs(query), query.trim() ? searchDeezer(query) : []])
        .then(([songs, hits]) => {
          if (!live) return;
          setPool(songs);
          setMore(songs.length === 50);
          setDeezer(hits);
        })
        .catch(() => live && setError('Search failed. Please try again.'))
        .finally(() => live && setSearching(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [query]);

  const loadMore = () => {
    searchAdminSongs(query, pool.length)
      .then((songs) => {
        setPool((current) => [...current, ...songs]);
        setMore(songs.length === 50);
      })
      .catch(() => setError('Could not load more songs.'));
  };

  const pickFromDeezer = (hit: DeezerSearchHit) => {
    addSongFromDeezer(hit.deezerTrackId)
      .then(onPick)
      .catch(() => setError('Could not add that song. Please try again.'));
  };

  const poolIds = new Set(pool.map((s) => s.title + s.artist));
  const fresh = deezer.filter((hit) => !poolIds.has(hit.title + hit.artist));

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-black/20 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-white">Add a cover</p>
        <button type="button" onClick={onClose} className="text-xs text-slate-400 hover:text-white">
          Close
        </button>
      </div>
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Any song, album or artist"
        aria-label="Search for a cover"
        className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-slate-500"
      />
      {error && <p className="text-xs text-chorusify-danger">{error}</p>}
      {searching && <p className="text-xs text-slate-500">Searching…</p>}
      <div className="grid max-h-96 gap-3 overflow-y-auto md:grid-cols-2">
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            In the song bank
          </h3>
          {!searching && pool.length === 0 && <p className="text-xs text-slate-500">No matches.</p>}
          <ul className="flex flex-col gap-0.5">
            {pool.map((song) => (
              <CoverRow
                key={song.id}
                art={song.albumArtUrl}
                title={song.title}
                subtitle={song.artist}
                onPick={() => onPick(song)}
              />
            ))}
          </ul>
          {more && (
            <button
              type="button"
              onClick={loadMore}
              className="btn-ghost mt-2 w-full !py-1.5 !text-xs"
            >
              Load more
            </button>
          )}
        </section>
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
            On Deezer
          </h3>
          {!query.trim() && <p className="text-xs text-slate-500">Search to find anything else.</p>}
          {query.trim() && !searching && fresh.length === 0 && (
            <p className="text-xs text-slate-500">Nothing else found.</p>
          )}
          <ul className="flex flex-col gap-0.5">
            {fresh.map((hit) => (
              <CoverRow
                key={hit.deezerTrackId}
                art={hit.albumArtUrl}
                title={hit.title}
                subtitle={`${hit.artist}${hit.album ? ` · ${hit.album}` : ''}`}
                onPick={() => pickFromDeezer(hit)}
              />
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
