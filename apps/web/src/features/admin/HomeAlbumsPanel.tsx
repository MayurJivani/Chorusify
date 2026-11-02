import { useEffect, useState } from 'react';
import { getAdminSettings, saveAdminSettings } from '../../api/admin';
import { getSampler } from '../../api/songs';
import { CoverPicker } from './CoverPicker';

interface Album {
  id: number;
  title: string;
  artist: string;
  albumArtUrl: string | null;
}

const MAX_ALBUMS = 60;
const KEY = 'homeWallSongIds';

/** Choose the covers on the home page wall. Nothing chosen means a random selection. */
export function HomeAlbumsPanel() {
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([getAdminSettings(), getSampler()])
      .then(([settings, sampler]) => {
        const chosen = settings.find((s) => s.key === KEY)?.value;
        // The sampler returns the picks when there are any; otherwise it is a random selection,
        // which must not be shown here as if someone chose it.
        if (Array.isArray(chosen) && chosen.length > 0) setAlbums(sampler.songs);
      })
      .catch(() => setError('Could not load the home albums.'))
      .finally(() => setLoading(false));
  }, []);

  const save = async (next: Album[]) => {
    const previous = albums;
    setAlbums(next);
    setError(null);
    try {
      await saveAdminSettings([{ key: KEY, value: next.map((a) => a.id) }]);
    } catch {
      setAlbums(previous);
      setError('That change was not saved. Please try again.');
    }
  };

  const move = (index: number, by: number) => {
    const next = [...albums];
    const [album] = next.splice(index, 1);
    if (album) next.splice(index + by, 0, album);
    void save(next);
  };

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-slate-300">
        {albums.length === 0
          ? 'Showing a random selection. Pick a cover to take over the wall.'
          : `${albums.length} of ${MAX_ALBUMS} chosen. The wall repeats them to fill the space.`}
      </p>
      {error && <p className="text-sm text-chorusify-danger">{error}</p>}

      {albums.length > 0 && (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {albums.map((album, i) => (
            <li key={album.id} className="glass flex flex-col gap-1.5 rounded-xl p-2">
              <img
                src={album.albumArtUrl ?? undefined}
                alt=""
                loading="lazy"
                className="aspect-square w-full rounded-lg object-cover"
              />
              <p className="truncate text-xs font-semibold text-white">{album.title}</p>
              <p className="truncate text-[11px] text-slate-400">{album.artist}</p>
              <div className="flex gap-1">
                <button
                  type="button"
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                  aria-label={`Move ${album.title} earlier`}
                  className="btn-ghost flex-1 !rounded-lg !px-0 !py-1 !text-xs"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={i === albums.length - 1}
                  onClick={() => move(i, 1)}
                  aria-label={`Move ${album.title} later`}
                  className="btn-ghost flex-1 !rounded-lg !px-0 !py-1 !text-xs"
                >
                  →
                </button>
                <button
                  type="button"
                  onClick={() => void save(albums.filter((a) => a.id !== album.id))}
                  aria-label={`Remove ${album.title}`}
                  className="btn-ghost flex-1 !rounded-lg !px-0 !py-1 !text-xs"
                >
                  ✕
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {albums.length < MAX_ALBUMS && !picking && (
        <button type="button" className="btn-secondary self-start" onClick={() => setPicking(true)}>
          Add a cover
        </button>
      )}
      {albums.length < MAX_ALBUMS && picking && (
        <CoverPicker
          onClose={() => setPicking(false)}
          onPick={(song) => {
            if (albums.some((a) => a.id === song.id)) return;
            void save([...albums, song]);
          }}
        />
      )}
    </div>
  );
}
