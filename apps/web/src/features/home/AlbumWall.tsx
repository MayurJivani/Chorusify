import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import type { SamplerSong } from '../../api/songs';

const COLUMNS = 14;
const TILES_PER_LOOP = 8;

/** Column `c` starts at a different place in the list, so neighbours never line up. */
export function buildColumns(songs: SamplerSong[]): SamplerSong[][] {
  // Two songs from one album share a cover, and a wall showing it twice looks like a bug.
  const covers = [...new Map(songs.map((s) => [s.albumArtUrl, s])).values()];
  if (covers.length === 0) return [];
  return Array.from({ length: COLUMNS }, (_, c) =>
    Array.from(
      { length: TILES_PER_LOOP },
      (_, t) => covers[(c * TILES_PER_LOOP + c * 3 + t) % covers.length]!,
    ),
  );
}

/**
 * Real covers behind the hero, in columns drifting opposite ways. A dim layer covers them, with a
 * soft hole that follows the pointer so colour shows through; without a pointer the hole wanders.
 * Everything moves through CSS variables and playback rate, so React never re-renders on a frame.
 */
export function AlbumWall({ songs }: { songs: SamplerSong[] }) {
  const reduced = useReducedMotion();
  const wallRef = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState<SamplerSong | null>(null);
  const columns = useMemo(() => buildColumns(songs), [songs]);

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
    let tiltX = 0;
    let tiltY = 0;
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
      spotX += (targetX - spotX) * ease;
      spotY += (targetY - spotY) * ease;
      tiltX += ((pointer ? targetX / width - 0.5 : 0) - tiltX) * 0.05;
      tiltY += ((pointer ? targetY / height - 0.5 : 0) - tiltY) * 0.05;
      wall.style.setProperty('--x', `${spotX}px`);
      wall.style.setProperty('--y', `${spotY}px`);
      wall.style.setProperty('--tilt-x', `${(-tiltY * 2.4).toFixed(3)}deg`);
      wall.style.setProperty('--tilt-y', `${(tiltX * 2.4).toFixed(3)}deg`);

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
              className={`album-wall-column ${c % 2 ? 'album-wall-column-down' : ''}`}
              style={{
                animationDuration: `${70 + (c % 5) * 16}s`,
                animationDelay: `${-13 * c}s`,
              }}
            >
              {/* The list twice, so moving by half its height lands on an identical frame. */}
              {[...tiles, ...tiles].map((song, t) => (
                <img
                  key={t}
                  src={song.albumArtUrl ?? undefined}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  width={250}
                  height={250}
                  onLoad={(e) => e.currentTarget.classList.add('album-wall-loaded')}
                  onPointerEnter={(e) => e.pointerType === 'mouse' && setHovered(song)}
                  onPointerLeave={() => setHovered(null)}
                />
              ))}
            </div>
          ))}
          <div className="album-wall-dim" />
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
