import { useRef } from 'react';
import { motion, useReducedMotion, useTransform, type MotionValue } from 'motion/react';
import type { SamplerSong } from '../../api/songs';
import { useSectionProgress } from './useSectionProgress';

/** A number marks where a cover sits in the sentence. */
const NOTES: (string | number)[] = [
  ...'Five songs a day,'.split(' '),
  0,
  ...'the same five for everyone. Hear one second,'.split(' '),
  1,
  ...'then two, then four. Name it before your friends do.'.split(' '),
  2,
];

/** Reads like the notes inside a sleeve: the sentence lights up as you scroll past it. */
export function LinerNotes({ songs }: { songs: SamplerSong[] }) {
  const covers = songs.slice(0, 3);
  // Mounted only once covers exist, so the scroll tracking starts with a real element.
  return covers.length < 3 ? null : <Notes covers={covers} />;
}

function Notes({ covers }: { covers: SamplerSong[] }) {
  const ref = useRef<HTMLParagraphElement | null>(null);
  const reduced = useReducedMotion();

  const scrollYProgress = useSectionProgress(ref, 0.9, 0.55);

  return (
    <p
      ref={ref}
      aria-label="Five songs a day, the same five for everyone. Hear one second, then two, then four. Name it before your friends do."
      className="w-full py-10 text-3xl font-black leading-tight tracking-tight text-white sm:py-16 sm:text-5xl"
    >
      {NOTES.map((part, i) => (
        <Note
          key={i}
          part={part}
          art={typeof part === 'number' ? covers[part]?.albumArtUrl : null}
          progress={scrollYProgress}
          start={i / NOTES.length}
          still={Boolean(reduced)}
        />
      ))}
    </p>
  );
}

function Note({
  part,
  art,
  progress,
  start,
  still,
}: {
  part: string | number;
  art?: string | null;
  progress: MotionValue<number>;
  start: number;
  still: boolean;
}) {
  const end = Math.min(1, start + 0.12);
  const opacity = useTransform(progress, [start, end], [0.16, 1]);
  const scale = useTransform(progress, [start, end], [0, 1]);
  const rotate = useTransform(progress, [start, end], [-12, -3]);

  if (typeof part === 'number') {
    return (
      <motion.img
        aria-hidden="true"
        src={art ?? undefined}
        alt=""
        loading="lazy"
        style={still ? { rotate: -3 } : { scale, rotate }}
        className="mx-1.5 inline-block h-[0.9em] w-[0.9em] rounded object-cover align-[-0.08em] shadow-lg"
      />
    );
  }
  return (
    <motion.span aria-hidden="true" style={still ? undefined : { opacity }}>
      {part}{' '}
    </motion.span>
  );
}
