import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { SamplerSong } from '../../api/songs';

const COLUMNS = 14;
// A column holds at least this many, more when there are enough covers to fill them.
const MIN_TILES_PER_LOOP = 8;

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/** Column `c` starts at a different place in the list, so neighbours never line up. */
export function buildColumns(songs: SamplerSong[]): SamplerSong[][] {
  // Two songs from one album share a cover, and a wall showing it twice looks like a bug.
  const covers = [...new Map(songs.map((s) => [s.albumArtUrl, s])).values()];
  if (covers.length === 0) return [];
  // Long enough that every cover gets a slot of its own before anything repeats.
  const perLoop = Math.max(MIN_TILES_PER_LOOP, Math.ceil(covers.length / COLUMNS));
  return Array.from({ length: COLUMNS }, (_, c) =>
    Array.from({ length: perLoop }, (_, t) => covers[(c * perLoop + t) % covers.length]!),
  );
}

/**
 * Real covers behind the hero, in columns drifting opposite ways, greyed until hovered, under a
 * soft light that follows the pointer (and wanders without one).
 * Everything moves through CSS variables and playback rate, so React never re-renders on a frame.
 */
export function AlbumWall({
  songs,
  onPlay,
  playingId,
}: {
  songs: SamplerSong[];
  /** A cover was clicked: play that song. */
  onPlay: (song: SamplerSong) => void;
  /** The song in the mini player, whose covers stay in colour. */
  playingId?: number;
}) {
  const reduced = useReducedMotion();
  const wallRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<SamplerSong | null>(null);
  // A fresh order each visit, so the covers are never in the same places twice.
  const columns = useMemo(() => buildColumns(shuffle(songs)), [songs]);

  const ready = columns.length > 0;
  useEffect(() => {
    const wall = wallRef.current;
    if (!wall || !ready || reduced) return;
    const scroller = wall.closest('main');
    // Only the column drift: hover transitions and the intro must keep their own timing.
    const drift = wall
      .getAnimations({ subtree: true })
      .filter((a) => a instanceof CSSAnimation && a.animationName === 'album-wall-drift');
    let applied = 1;
    let pointer: { x: number; y: number } | null = null;
    let spotX = wall.clientWidth / 2;
    let spotY = wall.clientHeight / 3;
    let speed = 1;
    let lastScroll = scroller?.scrollTop ?? 0;
    let visible = true;
    let frame = 0;

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const box = wall.getBoundingClientRect();
      pointer = { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    observer.observe(wall);
    window.addEventListener('pointermove', onMove);

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (!visible) return;
      const width = wall.clientWidth;
      const height = wall.clientHeight;
      const targetX = pointer?.x ?? width * (0.5 + 0.34 * Math.sin(now / 3100));
      const targetY = pointer?.y ?? height * (0.42 + 0.26 * Math.cos(now / 3700));
      const ease = pointer ? 0.14 : 0.04;
      const nextX = spotX + (targetX - spotX) * ease;
      const nextY = spotY + (targetY - spotY) * ease;
      // Repaint the glow only when it visibly moves; the covers themselves never repaint.
      if (Math.abs(nextX - spotX) + Math.abs(nextY - spotY) > 0.5) {
        wall.style.setProperty('--x', `${nextX}px`);
        wall.style.setProperty('--y', `${nextY}px`);
      }
      spotX = nextX;
      spotY = nextY;

      // Scrolling the page pushes the columns along, then they settle back to their own drift.
      const scrollTop = scroller?.scrollTop ?? 0;
      const push = Math.min(6, Math.abs(scrollTop - lastScroll));
      lastScroll = scrollTop;
      speed += (1 + push - speed) * 0.08;
      // updatePlaybackRate keeps each column where it is, and only when the speed really changed.
      if (Math.abs(speed - applied) > 0.04) {
        applied = speed;
        for (const animation of drift) animation.updatePlaybackRate(speed);
      }
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('pointermove', onMove);
    };
  }, [ready, reduced]);

  if (!ready) return null;
  return (
    <>
      <div className="album-wall" aria-hidden="true">
        <div ref={wallRef} className="album-wall-stage">
          {columns.map((tiles, c) => (
            <div
              key={c}
              className={`album-wall-column ${c % 2 ? 'album-wall-column-down' : ''} ${tiles.some((t) => t.id === playingId) ? 'album-wall-column-live' : ''}`}
              style={{
                animationDuration: `${60 + (c % 5) * 14}s`,
                animationDelay: `${-13 * c}s`,
              }}
            >
              {/* The list twice, so moving by half its height lands on an identical frame. */}
              {[...tiles, ...tiles].map((song, t) => (
                <img
                  key={t}
                  src={song.albumArtUrl ?? undefined}
                  alt=""
                  loading="eager"
                  decoding="async"
                  width={250}
                  height={250}
                  className={song.id === playingId ? 'album-wall-playing' : undefined}
                  onLoad={(e) => e.currentTarget.classList.add('album-wall-loaded')}
                  onClick={() => onPlay(song)}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(song)}
                  onPointerLeave={() => setHovered(null)}
                />
              ))}
            </div>
          ))}
          <div className="album-wall-glow" />
        </div>
      </div>
      {hovered && (
        <p className="album-wall-caption">
          <span className="text-chorusify-accent">▶</span> <strong>{hovered.title}</strong> ·{' '}
          {hovered.artist}
        </p>
      )}
    </>
  );
}
