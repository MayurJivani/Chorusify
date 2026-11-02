import { useEffect, useRef, useState } from 'react';
import { useReducedMotion, useMotionValueEvent } from 'motion/react';
import { useGameConfig } from '../../hooks/useGameConfig';
import { useSectionProgress } from './useSectionProgress';
import { drawRidges } from '../game/ridges';

const LINES = [
  'A single note.',
  'Wait, that voice.',
  'Is that the riff?',
  'It is on the tip of your tongue.',
  'You should have it by now.',
  'Last listen. Name it.',
];

/** The snippet ladder, drawn: each stage of the schedule adds ridges and lifts them. */
export function SnippetRidges() {
  const { snippetSchedule } = useGameConfig();
  const track = useRef<HTMLElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const reduced = useReducedMotion();
  const progress = useSectionProgress(track, 0, 1);
  const [stage, setStage] = useState(0);
  const stages = snippetSchedule.length;

  useMotionValueEvent(progress, 'change', (p) => {
    setStage(Math.min(stages - 1, Math.floor(p * stages)));
  });

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    let frame = 0;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    observer.observe(element);

    const draw = (now: number) => {
      const p = progress.get();
      const height = element.clientHeight;
      drawRidges(element, {
        count: Math.round(8 + p * 28),
        gap: (height * 0.72) / 36,
        lift: height * (0.1 + p * 0.42),
        time: reduced ? 0 : now / 1400,
        ground: '#121214',
      });
      if (!reduced) frame = requestAnimationFrame(tick);
    };
    const tick = (now: number) => {
      if (visible) draw(now);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    const stop = progress.on('change', () => reduced && draw(0));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      stop();
    };
  }, [progress, reduced]);

  return (
    <section ref={track} aria-label="How a round works" className="relative h-[280vh] w-full">
      <div className="sticky top-0 grid h-[calc(100dvh-8rem)] grid-rows-[1fr_auto] items-end gap-4 py-6 sm:grid-cols-[1fr_1.1fr] sm:grid-rows-1 sm:gap-8">
        <div className="order-2 sm:order-1">
          <p className="font-mono text-xs uppercase tracking-widest text-slate-400">
            Listen {stage + 1} of {stages}
          </p>
          <p className="my-1 text-7xl font-black leading-none tracking-tight text-white sm:text-9xl">
            {snippetSchedule[stage]}s
          </p>
          <p className="text-base text-slate-200 sm:text-lg" aria-live="polite">
            {LINES[Math.min(stage, LINES.length - 1)]}
          </p>
          <ol className="mt-4 flex gap-1.5" aria-hidden="true">
            {snippetSchedule.map((seconds, i) => (
              <li
                key={seconds}
                className={`h-0.5 w-6 transition-colors ${i === stage ? 'bg-chorusify-accent' : i < stage ? 'bg-white/50' : 'bg-white/15'}`}
              />
            ))}
          </ol>
        </div>
        <canvas
          ref={canvas}
          aria-hidden="true"
          className="order-1 h-full min-h-0 w-full sm:order-2"
        />
      </div>
    </section>
  );
}
