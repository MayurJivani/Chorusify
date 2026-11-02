import { useEffect, useMemo, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { SamplerSong } from '../../api/songs';

const TILES = 60;

/**
 * Real covers behind the home page, grey until touched. One lights up by itself every moment so the
 * wall feels alive, and only that one tile changes, so it costs next to nothing.
 */
export function AlbumWall({ songs }: { songs: SamplerSong[] }) {
  const reduced = useReducedMotion();
  const [lit, setLit] = useState(-1);
  const tiles = useMemo(
    () =>
      songs.length < 12 ? [] : Array.from({ length: TILES }, (_, i) => songs[i % songs.length]!),
    [songs],
  );

  useEffect(() => {
    if (reduced || tiles.length === 0) return;
    const timer = setInterval(() => setLit(Math.floor(Math.random() * 24)), 1400);
    return () => clearInterval(timer);
  }, [reduced, tiles.length]);

  if (tiles.length === 0) return null;
  return (
    <div className="album-wall">
      {tiles.map((song, i) => (
        <img
          key={i}
          src={song.albumArtUrl ?? undefined}
          alt=""
          title={`${song.title} · ${song.artist}`}
          loading="lazy"
          decoding="async"
          width={250}
          height={250}
          className={i === lit ? 'album-wall-lit' : undefined}
        />
      ))}
    </div>
  );
}
