import { useEffect, useRef, useState } from 'react';
import { useReducedMotion, useMotionValueEvent } from 'motion/react';
import { useGameConfig } from '../../hooks/useGameConfig';
import { useSectionProgress } from './useSectionProgress';

const LINES = [
  'A single note.',
  'Wait, that voice.',
  'Is that the riff?',
  'It is on the tip of your tongue.',
  'You should have it by now.',
  'Last listen. Name it.',
];

/** Soft, repeatable bumps: the same line and moment always give the same shape. */
function bump(x: number, line: number, time: number): number {
  const wave = (f: number, p: number) => Math.sin(x * f + line * p + time);
  return Math.abs(wave(19, 1.7) * 0.5 + wave(41, 2.9) * 0.3 + wave(83, 0.7) * 0.2);
}

/** A ridge's height at x (0 to 1): tall in the middle, flat at the edges, scaled by `energy`. */
export function ridgeHeight(x: number, line: number, time: number, energy: number): number {
  const centre = Math.exp(-(((x - 0.5) / 0.17) ** 2));
  return centre * (0.12 + bump(x, line, time) ** 2) * energy;
}

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
    const context = element?.getContext('2d');
    if (!element || !context) return;
    let frame = 0;
    let visible = true;
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
    });
    observer.observe(element);

    const draw = (now: number) => {
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = element.clientWidth;
      const height = element.clientHeight;
      if (element.width !== Math.round(width * ratio)) element.width = Math.round(width * ratio);
      if (element.height !== Math.round(height * ratio))
        element.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const p = progress.get();
      const count = Math.round(8 + p * 28);
      const time = reduced ? 0 : now / 1400;
      const gap = (height * 0.72) / 36;
      const lift = height * (0.1 + p * 0.42);
      const steps = 110;
      context.lineJoin = 'round';

      // Back to front, each filled with the page colour so nearer ridges hide farther ones.
      for (let line = 0; line < count; line += 1) {
        const y = height * 0.97 - (count - 1 - line) * gap;
        const nearest = line === count - 1;
        context.beginPath();
        context.moveTo(0, y);
        for (let s = 0; s <= steps; s += 1) {
          const x = s / steps;
          context.lineTo(x * width, y - ridgeHeight(x, line * 1.3, time, lift));
        }
        context.lineTo(width, y + 2);
        context.lineTo(0, y + 2);
        context.closePath();
        context.fillStyle = '#121214';
        context.fill();
        context.lineWidth = 1;
        context.strokeStyle = nearest ? '#a78bfa' : 'rgba(255,255,255,0.72)';
        context.stroke();
      }
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
