import { useEffect, useMemo, useRef, useState } from 'react';
import {
  motion,
  useAnimationFrame,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from 'motion/react';
import type { SamplerSong } from '../../api/songs';

// Enough cells to fill the widest wall (11 columns by 6 rows); narrower walls clip the rest.
const TILES = 66;
// How far from the spotlight colour reaches at most, in px.
const COLOUR_RADIUS = 320;
// A still pointer hands the spotlight back to its wander after this long, unless it rests on a cover.
const IDLE_MS = 4000;
// One cover flips to another song this often, like a departures board.
const FLIP_MS = 2600;

/** Where the idle spotlight drifts at `seconds`: a slow loop through the middle of the wall. */
export function wanderPoint(seconds: number, width: number, height: number) {
  return {
    x: width * (0.5 + 0.3 * Math.sin(0.33 * seconds)),
    y: height * (0.42 + 0.2 * Math.cos(0.27 * seconds)),
  };
}

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** One song per album, since two songs from one album share a cover and a doubled cover looks like a bug. */
export function uniqueCovers(songs: SamplerSong[]): SamplerSong[] {
  return [...new Map(songs.map((s) => [s.albumArtUrl, s])).values()];
}

/** The wall's cells: every cover once before any repeats. */
export function buildWall(covers: SamplerSong[]): SamplerSong[] {
  if (covers.length === 0) return [];
  return Array.from({ length: TILES }, (_, i) => covers[i % covers.length]!);
}

/**
 * Cell `i` flips to a cover that is not on the wall. When every cover is already up, it trades
 * places with another cell instead, so the wall still moves.
 */
export function flipTile(
  tiles: SamplerSong[],
  covers: SamplerSong[],
  i: number,
  rand: () => number = Math.random,
): SamplerSong[] {
  const next = [...tiles];
  const shown = new Set(tiles.map((t) => t.albumArtUrl));
  const unused = covers.filter((c) => !shown.has(c.albumArtUrl));
  if (unused.length > 0) {
    next[i] = unused[Math.floor(rand() * unused.length)]!;
  } else if (tiles.length > 1) {
    const j = (i + 1 + Math.floor(rand() * (tiles.length - 1))) % tiles.length;
    [next[i], next[j]] = [next[j]!, next[i]!];
  }
  return next;
}

/**
 * Real covers behind the hero in a still grid, greyed except around a spotlight that follows the
 * pointer and drifts on its own when the pointer rests. One masked backdrop filter does the
 * greying, so no cover repaints as the light moves; the hovered and playing covers rise above it
 * in full colour. Every few seconds one cover flips over to another song.
 */
export function AlbumWall({
  songs,
  onPlay,
  playingId,
}: {
  songs: SamplerSong[];
  /** A cover was clicked: play that song. */
  onPlay: (song: SamplerSong) => void;
  /** The song in the mini player, whose cover stays lit. */
  playingId?: number;
}) {
  const reduced = useReducedMotion();
  const stageRef = useRef<HTMLDivElement | null>(null);
  // A fresh order each visit, so the covers are never in the same places twice.
  const covers = useMemo(() => uniqueCovers(shuffle(songs)), [songs]);
  const [tiles, setTiles] = useState<SamplerSong[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  // Covers arrive one by one in a scattered order, not row by row.
  const delays = useMemo(() => Array.from({ length: TILES }, () => 0.15 + Math.random() * 1.3), []);
  const [intro, setIntro] = useState(true);

  // Wait for the first screen of covers to decode, so the scattered reveal is not a scattered load.
  useEffect(() => {
    const wall = buildWall(covers);
    if (wall.length === 0) return;
    let cancelled = false;
    const decoded = wall.map((s) => {
      const img = new Image();
      img.src = s.albumArtUrl ?? '';
      return img.decode().catch(() => undefined);
    });
    const timeout = new Promise((resolve) => setTimeout(resolve, 2500));
    void Promise.race([Promise.all(decoded), timeout]).then(() => {
      if (!cancelled) setTiles(wall);
    });
    const done = setTimeout(() => setIntro(false), 4500);
    return () => {
      cancelled = true;
      clearTimeout(done);
    };
  }, [covers]);

  const locked = useRef<{ hovered: number | null; playingId?: number }>({ hovered: null });
  locked.current = { hovered, playingId };
  const ready = tiles.length > 0;
  useEffect(() => {
    if (!ready || reduced) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      setTiles((current) => {
        const i = Math.floor(Math.random() * current.length);
        const { hovered: h, playingId: p } = locked.current;
        // Never pull a cover out from under the pointer or the player.
        if (i === h || current[i]?.id === p) return current;
        return flipTile(current, covers, i);
      });
    }, FLIP_MS);
    return () => clearInterval(timer);
  }, [ready, reduced, covers]);

  // The spotlight and the parallax are motion values, so React never re-renders on a frame.
  const spotX = useMotionValue(0);
  const spotY = useMotionValue(0);
  const radius = useMotionValue(COLOUR_RADIUS);
  const shiftX = useSpring(0, { stiffness: 50, damping: 20 });
  const shiftY = useSpring(0, { stiffness: 50, damping: 20 });
  const veil = useMotionTemplate`radial-gradient(circle ${radius}px at ${spotX}px ${spotY}px, transparent 12%, rgba(0,0,0,0.6) 55%, #000 100%)`;
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null);
  const onCover = useRef(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    spotX.set(stage.clientWidth / 2);
    spotY.set(stage.clientHeight * 0.4);
    // A phone's wall is short, so a full-size light would colour all of it.
    radius.set(Math.min(COLOUR_RADIUS, stage.clientWidth * 0.3));
    if (reduced) return;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const box = stage.getBoundingClientRect();
      pointer.current = { x: e.clientX - box.left, y: e.clientY - box.top, at: performance.now() };
      // A few pixels against the pointer, so the wall reads as a layer behind the page.
      shiftX.set((0.5 - e.clientX / window.innerWidth) * 18);
      shiftY.set((0.5 - e.clientY / window.innerHeight) * 12);
    };
    const onLeave = () => {
      pointer.current = null;
      shiftX.set(0);
      shiftY.set(0);
    };
    window.addEventListener('pointermove', onMove);
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
    };
  }, [ready, reduced, spotX, spotY, radius, shiftX, shiftY]);

  useAnimationFrame((now) => {
    const stage = stageRef.current;
    if (!stage || reduced) return;
    const p = pointer.current;
    const live = p && (onCover.current || now - p.at < IDLE_MS) ? p : null;
    const target = live ?? wanderPoint(now / 1000, stage.clientWidth, stage.clientHeight);
    // Idle glides in slowly, so letting go of the mouse never yanks the light across the wall.
    const ease = live ? 0.16 : 0.012;
    const x = spotX.get();
    const y = spotY.get();
    if (Math.abs(target.x - x) + Math.abs(target.y - y) < 0.5) return;
    spotX.set(x + (target.x - x) * ease);
    spotY.set(y + (target.y - y) * ease);
  });

  if (!ready) return null;
  const cellAt = (target: EventTarget) =>
    Number((target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i ?? NaN);
  const caption = hovered !== null ? tiles[hovered] : undefined;
  return (
    <>
      <div className="album-wall" aria-hidden="true">
        <motion.div
          ref={stageRef}
          className="album-wall-stage"
          style={{ x: shiftX, y: shiftY }}
          onPointerOver={(e) => {
            if (e.pointerType !== 'mouse') return;
            const i = cellAt(e.target);
            onCover.current = !Number.isNaN(i);
            setHovered(Number.isNaN(i) ? null : i);
          }}
          onPointerLeave={() => {
            onCover.current = false;
            setHovered(null);
          }}
          onClick={(e) => {
            const song = tiles[cellAt(e.target)];
            if (song) onPlay(song);
          }}
        >
          {tiles.map((song, i) => (
            <span
              key={i}
              data-i={i}
              className={`album-wall-cell${i === hovered ? ' album-wall-hovered' : ''}${song.id === playingId ? ' album-wall-playing' : ''}`}
            >
              {/* Keyed by cover, so a new song mounts fresh and flips in over the old one. */}
              <motion.img
                key={song.albumArtUrl}
                src={song.albumArtUrl ?? undefined}
                alt=""
                decoding="async"
                width={250}
                height={250}
                initial={
                  reduced
                    ? false
                    : intro
                      ? { opacity: 0, scale: 0.86, filter: 'blur(6px)' }
                      : { opacity: 0, rotateX: -90 }
                }
                animate={{ opacity: 1, scale: 1, rotateX: 0, filter: 'blur(0px)' }}
                transition={
                  intro
                    ? { delay: delays[i], duration: 0.9, ease: [0.16, 1, 0.3, 1] }
                    : { type: 'spring', stiffness: 140, damping: 16 }
                }
              />
            </span>
          ))}
          <motion.div
            className="album-wall-veil"
            style={{ maskImage: veil, WebkitMaskImage: veil }}
          />
        </motion.div>
      </div>
      {caption && (
        <p className="album-wall-caption">
          <span className="text-chorusify-accent">▶</span> <strong>{caption.title}</strong> ·{' '}
          {caption.artist}
        </p>
      )}
    </>
  );
}
