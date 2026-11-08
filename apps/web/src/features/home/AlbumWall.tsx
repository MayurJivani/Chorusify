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

// How far from the pointer colour reaches at most, in px.
const COLOUR_RADIUS = 300;
// A still pointer lets its light fade after this long, unless it rests on a cover.
const IDLE_MS = 2500;
// One cover flips to another song this often, like a departures board.
const FLIP_MS = 2600;
// The wall's drift, in px per second: slowly up and to the left, like a page being leafed through.
const DRIFT = { x: -16, y: -9 };

/** Cell size and count for a wall this big: a cell's width of spare on each side, so wrapping is never seen. */
export function wallGrid(width: number, height: number) {
  const across = width < 640 ? 4.5 : width < 1024 ? 7 : 9.5;
  const gap = width < 640 ? 8 : 12;
  const step = Math.max(60, width / across);
  return {
    step,
    tile: step - gap,
    cols: Math.ceil(width / step) + 2,
    rows: Math.ceil(height / step) + 2,
  };
}

/** Where a cell's cover sits after the wall has drifted by `offset`: wraps round so the wall never ends. */
export function cellPosition(
  index: number,
  cols: number,
  rows: number,
  step: number,
  offset: { x: number; y: number },
) {
  const wrap = (v: number, size: number) => ((v % size) + size) % size;
  return {
    x: wrap((index % cols) * step + offset.x, cols * step) - step,
    y: wrap(Math.floor(index / cols) * step + offset.y, rows * step) - step,
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
export function buildWall(covers: SamplerSong[], count: number): SamplerSong[] {
  if (covers.length === 0) return [];
  return Array.from({ length: count }, (_, i) => covers[i % covers.length]!);
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
 * Real covers behind the hero in a grid that drifts slowly on a diagonal, greyed and dim so the
 * text above stays readable. Moving the mouse lights the covers around it in colour, and the
 * cover under it lifts out and stops the drift, so it can be read and clicked. Every few seconds
 * one cover flips over to another song. Positions, light and parallax are written straight to
 * the DOM and motion values, so React never re-renders on a frame.
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
  const wallRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  // A fresh order each visit, so the covers are never in the same places twice.
  const covers = useMemo(() => uniqueCovers(shuffle(songs)), [songs]);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const grid = size && wallGrid(size.width, size.height);
  const count = grid ? grid.cols * grid.rows : 0;
  const [tiles, setTiles] = useState<SamplerSong[]>([]);
  const [hovered, setHovered] = useState<number | null>(null);
  const [intro, setIntro] = useState(true);
  const offset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const wall = wallRef.current;
    if (!wall) return;
    const observer = new ResizeObserver(() =>
      setSize({ width: wall.clientWidth, height: wall.clientHeight }),
    );
    observer.observe(wall);
    return () => observer.disconnect();
  }, []);

  // Wait for the covers to decode, so the scattered reveal is not a scattered load.
  useEffect(() => {
    const wall = buildWall(covers, count);
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
    return () => {
      cancelled = true;
    };
  }, [covers, count]);

  const ready = tiles.length > 0;
  useEffect(() => {
    if (!ready) return;
    const done = setTimeout(() => setIntro(false), 3500);
    return () => clearTimeout(done);
  }, [ready]);

  const locked = useRef<{ hovered: number | null; playingId?: number }>({ hovered: null });
  locked.current = { hovered, playingId };
  useEffect(() => {
    if (!ready || reduced) return;
    const timer = setInterval(() => {
      if (document.hidden) return;
      setTiles((current) => {
        const i = Math.floor(Math.random() * current.length);
        const { hovered: h, playingId: p } = locked.current;
        // Never pull a cover out from under the pointer or the player.
        if (i === h || current[i]?.id === p) return current;
        const next = flipTile(current, covers, i);
        // A full wall swaps two cells, and the other one may be the hovered or playing cover.
        const moved = next.some((t, k) => t !== current[k] && (k === h || current[k]?.id === p));
        return moved ? current : next;
      });
    }, FLIP_MS);
    return () => clearInterval(timer);
  }, [ready, reduced, covers]);

  const spotX = useMotionValue(0);
  const spotY = useMotionValue(0);
  const radius = useMotionValue(0);
  const shiftX = useSpring(0, { stiffness: 50, damping: 20 });
  const shiftY = useSpring(0, { stiffness: 50, damping: 20 });
  const veil = useMotionTemplate`radial-gradient(circle ${radius}px at ${spotX}px ${spotY}px, transparent 15%, rgba(0,0,0,0.65) 60%, #000 100%)`;
  const pointer = useRef<{ x: number; y: number; at: number } | null>(null);
  const onCover = useRef(false);
  const speed = useRef(1);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready || reduced) return;
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
  }, [ready, reduced, shiftX, shiftY]);

  useAnimationFrame((now, delta) => {
    const stage = stageRef.current;
    if (!stage || !grid || reduced) return;
    // The drift eases to a stop under a hovered cover, and eases back when it is let go.
    speed.current += ((onCover.current ? 0 : 1) - speed.current) * 0.08;
    const dt = Math.min(delta, 50) / 1000;
    offset.current.x += DRIFT.x * speed.current * dt;
    offset.current.y += DRIFT.y * speed.current * dt;
    const cells = stage.querySelectorAll<HTMLElement>('.album-wall-cell');
    cells.forEach((cell, i) => {
      const { x, y } = cellPosition(i, grid.cols, grid.rows, grid.step, offset.current);
      cell.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });

    // The light follows a moving pointer and fades once it rests, so it never sits behind the text.
    const p = pointer.current;
    const live = p && (onCover.current || now - p.at < IDLE_MS) ? p : null;
    const full = Math.min(COLOUR_RADIUS, stage.clientWidth * 0.3);
    const r = radius.get();
    const targetR = live ? full : 0;
    if (Math.abs(targetR - r) > 0.5) radius.set(r + (targetR - r) * (live ? 0.12 : 0.04));
    if (live) {
      // The first move puts the light straight under the pointer rather than sliding it in.
      const ease = r < 1 ? 1 : 0.2;
      spotX.set(spotX.get() + (live.x - spotX.get()) * ease);
      spotY.set(spotY.get() + (live.y - spotY.get()) * ease);
    }
  });

  const cellAt = (target: EventTarget) =>
    Number((target as HTMLElement).closest<HTMLElement>('[data-i]')?.dataset.i ?? NaN);
  const caption = hovered !== null ? tiles[hovered] : undefined;
  return (
    <>
      <div ref={wallRef} className="album-wall" aria-hidden="true">
        {ready && grid && (
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
            {tiles.map((song, i) => {
              const { x, y } = cellPosition(i, grid.cols, grid.rows, grid.step, offset.current);
              return (
                <span
                  key={i}
                  data-i={i}
                  className={`album-wall-cell${i === hovered ? ' album-wall-hovered' : ''}${song.id === playingId ? ' album-wall-playing' : ''}`}
                  style={{
                    width: grid.tile,
                    height: grid.tile,
                    transform: `translate3d(${x}px, ${y}px, 0)`,
                  }}
                >
                  <span className="album-wall-tile">
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
                          ? // Golden-ratio steps scatter the arrivals without a stored random list.
                            {
                              delay: 0.15 + ((i * 0.618) % 1) * 1.3,
                              duration: 0.9,
                              ease: [0.16, 1, 0.3, 1],
                            }
                          : { type: 'spring', stiffness: 140, damping: 16 }
                      }
                    />
                  </span>
                </span>
              );
            })}
            <motion.div
              className="album-wall-veil"
              style={{ maskImage: veil, WebkitMaskImage: veil }}
            />
            {/* Inside the stage, so a hovered cover can still rise above it. */}
            <div className="album-wall-scrim" />
          </motion.div>
        )}
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
