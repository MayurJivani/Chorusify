import { useCallback, useEffect, useRef, useState } from 'react';

const WHITE = [
  { note: 'C', midi: 60, key: 'a' },
  { note: 'D', midi: 62, key: 's' },
  { note: 'E', midi: 64, key: 'd' },
  { note: 'F', midi: 65, key: 'f' },
  { note: 'G', midi: 67, key: 'g' },
  { note: 'A', midi: 69, key: 'h' },
  { note: 'B', midi: 71, key: 'j' },
  { note: "C'", midi: 72, key: 'k' },
];
/** `after` is the white key each black key sits on the right edge of. */
const BLACK = [
  { note: 'C sharp', midi: 61, key: 'w', after: 0 },
  { note: 'D sharp', midi: 63, key: 'e', after: 1 },
  { note: 'F sharp', midi: 66, key: 't', after: 3 },
  { note: 'G sharp', midi: 68, key: 'y', after: 4 },
  { note: 'A sharp', midi: 70, key: 'u', after: 5 },
];
const ALL = [...WHITE, ...BLACK];

export function noteFrequency(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

/** An octave you can actually play. Sound starts only from a tap or key press. */
export function PlayableKeys() {
  const audio = useRef<AudioContext | null>(null);
  const root = useRef<HTMLDivElement | null>(null);
  const [down, setDown] = useState<number | null>(null);

  const play = useCallback((midi: number) => {
    audio.current ??= new AudioContext();
    const context = audio.current;
    void context.resume();
    const now = context.currentTime;
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.3);
    gain.connect(context.destination);
    for (const [type, ratio] of [
      ['triangle', 1],
      ['sine', 2],
    ] as const) {
      const tone = context.createOscillator();
      tone.type = type;
      tone.frequency.value = noteFrequency(midi) * ratio;
      tone.connect(gain);
      tone.start(now);
      tone.stop(now + 1.35);
    }
    setDown(midi);
    window.setTimeout(() => setDown((d) => (d === midi ? null : d)), 180);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
      const box = root.current?.getBoundingClientRect();
      // Only while the keys are on screen: letters elsewhere on the page shouldn't make sound.
      if (!box || box.bottom < 0 || box.top > window.innerHeight) return;
      const match = ALL.find((n) => n.key === e.key.toLowerCase());
      if (match) play(match.midi);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      void audio.current?.close();
    };
  }, [play]);

  return (
    <div ref={root} className="relative flex h-44 w-full touch-none select-none gap-0.5 sm:h-60">
      {WHITE.map((n) => (
        <button
          key={n.midi}
          type="button"
          aria-label={`Play ${n.note}`}
          onPointerDown={() => play(n.midi)}
          className={`flex flex-1 items-end justify-center rounded-b-md pb-2 font-mono text-[10px] text-neutral-500 transition-[transform,background-color] duration-75 ${
            down === n.midi ? 'translate-y-1 bg-purple-300' : 'bg-neutral-200 hover:bg-white'
          }`}
        >
          <span aria-hidden="true">{n.note}</span>
        </button>
      ))}
      {BLACK.map((n) => (
        <button
          key={n.midi}
          type="button"
          aria-label={`Play ${n.note}`}
          onPointerDown={() => play(n.midi)}
          style={{ left: `${((n.after + 1) / WHITE.length) * 100}%`, width: '7.5%' }}
          className={`absolute top-0 h-[60%] -translate-x-1/2 rounded-b-md shadow-lg transition-colors duration-75 ${
            down === n.midi ? 'bg-chorusify-accent' : 'bg-neutral-900 hover:bg-neutral-800'
          }`}
        />
      ))}
    </div>
  );
}
