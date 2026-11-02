import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { getSampler, type SamplerSong } from '../../api/songs';

const TILES = 60;

/**
 * Real covers behind the home page, grey until touched. Colour follows the pointer as a soft
 * spotlight and the cover under it lifts out in full. Without a pointer, one lights up by itself
 * every moment, so phones get the same life. Only CSS variables change on move, so nothing re-renders.
 */
export function AlbumWall() {
  const reduced = useReducedMotion();
  const wallRef = useRef<HTMLDivElement | null>(null);
  const [songs, setSongs] = useState<SamplerSong[]>([]);
  const [lit, setLit] = useState(-1);
  const tiles = useMemo(() => {
    // Two songs from one album share a cover, and a wall showing it twice looks like a bug.
    const covers = [...new Map(songs.map((s) => [s.albumArtUrl, s])).values()];
    return covers.length === 0
      ? []
      : Array.from({ length: TILES }, (_, i) => covers[i % covers.length]!);
  }, [songs]);

  useEffect(() => {
    getSampler()
      .then((r) => setSongs(r.songs))
      .catch(() => setSongs([]));
  }, []);

  useEffect(() => {
    if (reduced || tiles.length === 0) return;
    const timer = setInterval(() => setLit(Math.floor(Math.random() * 24)), 1400);
    return () => clearInterval(timer);
  }, [reduced, tiles.length]);

  // On window, not the wall: the spotlight should carry on while the pointer crosses a card.
  useEffect(() => {
    if (!window.matchMedia('(hover: hover)').matches) return;
    let frame = 0;
    const onMove = (e: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const wall = wallRef.current;
        if (!wall) return;
        const box = wall.getBoundingClientRect();
        wall.style.setProperty('--x', `${e.clientX - box.left}px`);
        wall.style.setProperty('--y', `${e.clientY - box.top}px`);
        wall.dataset.pointer = 'on';
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointermove', onMove);
    };
  }, []);

  if (tiles.length === 0) return null;
  const size = { loading: 'lazy', decoding: 'async', width: 250, height: 250 } as const;
  return (
    <div ref={wallRef} className="album-wall">
      {tiles.map((song, i) => (
        <img
          key={i}
          {...size}
          src={song.albumArtUrl ?? undefined}
          alt=""
          title={`${song.title} · ${song.artist}`}
          className={i === lit ? 'album-wall-lit' : undefined}
        />
      ))}
      <div aria-hidden="true" className="album-wall-colour">
        {tiles.map((song, i) => (
          <img key={i} {...size} src={song.albumArtUrl ?? undefined} alt="" />
        ))}
      </div>
    </div>
  );
}
