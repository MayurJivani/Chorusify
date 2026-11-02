import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import { Disc } from '../game/Disc';

export const LINES = [
  'Hear one second of a song.',
  'Name it, if you can.',
  'Hear more, if you need it.',
  'The sooner you get it, the more it is worth.',
  'Hearing more is free, except on the dailies.',
];
const LINE_MS = 2800;

/** Which line is being sung at a moment, and how far through it, looping forever. */
export function lineAtTime(ms: number, lines = LINES.length) {
  const position = (ms / LINE_MS) % lines;
  const index = Math.floor(position);
  return { index, through: position - index };
}

/** The sleeve sings the rules, a line at a time, over the colours of its own cover. */
export function LyricStrip({ cover }: { cover?: string | null }) {
  const reduced = useReducedMotion();
  const viewport = useRef<HTMLDivElement | null>(null);
  const sheet = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    if (reduced) return;
    let frame = 0;
    let current = -1;
    const started = performance.now();
    const tick = (now: number) => {
      const { index, through } = lineAtTime(now - started);
      if (index !== current) {
        current = index;
        setActive(index);
      }
      const words = sheet.current?.children[index]?.querySelectorAll<HTMLElement>('.lyric-word');
      words?.forEach((word, i) => {
        const fill = Math.min(1, Math.max(0, through * 1.25 * words.length - i));
        word.style.setProperty('--p', `${fill * 124 - 12}%`);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduced]);

  useEffect(() => {
    const line = sheet.current?.children[active] as HTMLElement | undefined;
    const height = viewport.current?.clientHeight ?? 0;
    if (line) setOffset(height * 0.45 - (line.offsetTop + line.offsetHeight / 2));
  }, [active]);

  return (
    <section
      aria-label="How it works"
      className="relative isolate flex h-44 items-center gap-[12%] overflow-hidden rounded-2xl border border-white/10 p-4 sm:h-full sm:min-h-52 sm:gap-[15%] sm:p-6"
    >
      {cover && (
        <img
          src={cover}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 -z-20 h-full w-full scale-150 object-cover blur-[50px] saturate-150"
        />
      )}
      <div className="absolute inset-0 -z-10 bg-black/60" />

      <div aria-hidden="true" className="relative aspect-square h-[62%] flex-none sm:h-[70%]">
        <span className="absolute inset-[3%] translate-x-[36%]">
          <Disc size="100%" art={cover} spinning={!reduced} />
        </span>
        <div className="absolute inset-0 overflow-hidden rounded-[3px] bg-chorusify-surface-2 shadow-[6px_10px_26px_rgba(0,0,0,0.7)]">
          {cover && <img src={cover} alt="" className="h-full w-full object-cover" />}
        </div>
      </div>

      <div
        ref={viewport}
        className="lyric-strip relative h-full min-w-0 flex-1 overflow-hidden [mask-image:linear-gradient(180deg,transparent,#000_22%,#000_72%,transparent)]"
      >
        <div
          ref={sheet}
          className="transition-transform duration-500 ease-out"
          style={{ transform: `translateY(${offset}px)` }}
        >
          {LINES.map((text, i) => (
            <p
              key={text}
              className={`lyric-line ${reduced || i === active ? 'lyric-line-active' : i < active ? 'lyric-line-past' : ''} ${reduced ? 'lyric-line-plain' : ''}`}
            >
              {text.split(' ').map((word, w) => (
                <span key={w} className="lyric-word">
                  {word}{' '}
                </span>
              ))}
            </p>
          ))}
        </div>
      </div>
    </section>
  );
}
