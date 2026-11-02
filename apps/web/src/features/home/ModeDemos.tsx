/**
 * Looping mini-demos that stand in for the paragraph each mode used to carry.
 *
 * The home page's job is to answer "what actually happens if I click this?" — and a sentence
 * like "Race friends in real time" doesn't, because it describes a feeling rather than a
 * screen. These render a stripped-down version of the real thing (a name being typed, avatars
 * joining, a bar growing) so the answer is visible in about two seconds without reading.
 *
 * Deliberately fake: no audio, no network, no real data. They are illustrations sized to sit
 * inside a card, not live previews, and they must never become a reason for the home page to
 * talk to the API.
 *
 * All of them stop when `prefers-reduced-motion` is set, falling back to a still final frame —
 * looping motion behind text is exactly what that setting exists to switch off.
 */
import { motion } from 'motion/react';
import { useReducedMotion } from 'motion/react';

/** Artist Mode: a name is typed, an artist resolves, ten songs queue up. */
export function ArtistModeDemo() {
  const reduce = useReducedMotion();
  const letters = 'Peter Cat Recording Co.'.split('');

  // No border or panel of its own: sitting inside the card's border already, a second frame
  // just added a box-in-a-box at every breakpoint.
  return (
    <div className="flex h-14 w-full flex-col justify-center gap-1.5 overflow-hidden">
      {/* Search field with the name typing itself in */}
      <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-2 py-1">
        <span aria-hidden="true" className="text-[10px] opacity-60">
          🔍
        </span>
        <span className="font-mono text-[11px] text-slate-200">
          {reduce
            ? letters.join('')
            : letters.map((char, i) => (
                <motion.span
                  key={i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: [0, 0, 1, 1, 0] }}
                  transition={{
                    duration: 5,
                    times: [0, 0.06 + i * 0.03, 0.12 + i * 0.03, 0.85, 0.95],
                    repeat: Infinity,
                    ease: 'linear',
                  }}
                >
                  {char === ' ' ? ' ' : char}
                </motion.span>
              ))}
        </span>
      </div>

      {/* The ten rounds that get built from it */}
      <div className="flex items-center gap-1.5">
        {Array.from({ length: 10 }, (_, i) => (
          <motion.span
            key={i}
            className="h-1.5 flex-1 rounded-full bg-chorusify-accent"
            initial={{ opacity: 0.15 }}
            animate={reduce ? { opacity: 0.8 } : { opacity: [0.15, 0.15, 0.8, 0.8, 0.15] }}
            transition={
              reduce
                ? undefined
                : {
                    duration: 5,
                    times: [0, 0.45 + i * 0.02, 0.5 + i * 0.02, 0.85, 0.95],
                    repeat: Infinity,
                    ease: 'linear',
                  }
            }
          />
        ))}
      </div>
    </div>
  );
}

/** Multiplayer: players join a room, then scores pull apart. */
export function MultiplayerDemo() {
  const reduce = useReducedMotion();
  const players = [
    { name: 'You', colour: 'bg-chorusify-accent2', width: '85%', delay: 0 },
    { name: 'Sam', colour: 'bg-chorusify-accent', width: '60%', delay: 0.15 },
    { name: 'Ana', colour: 'bg-emerald-500', width: '40%', delay: 0.3 },
  ];

  return (
    <div className="flex h-14 w-full flex-col justify-center gap-1 overflow-hidden">
      {players.map((p, i) => (
        <div key={p.name} className="flex items-center gap-2">
          <motion.span
            className="w-8 shrink-0 font-mono text-[10px] text-slate-400"
            initial={{ opacity: 0, x: -6 }}
            animate={reduce ? { opacity: 1, x: 0 } : { opacity: [0, 1, 1, 0], x: [-6, 0, 0, 0] }}
            transition={
              reduce
                ? undefined
                : {
                    duration: 4,
                    times: [0, 0.15 + p.delay * 0.1, 0.85, 0.97],
                    repeat: Infinity,
                    ease: 'easeOut',
                  }
            }
          >
            {p.name}
          </motion.span>
          {/* Score bars racing - the whole point of the mode in one gesture */}
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/5">
            <motion.div
              className={`h-full rounded-full ${p.colour}`}
              initial={{ width: '0%' }}
              animate={
                reduce ? { width: p.width } : { width: ['0%', '0%', p.width, p.width, '0%'] }
              }
              transition={
                reduce
                  ? undefined
                  : {
                      duration: 4,
                      times: [0, 0.2 + i * 0.05, 0.6 + i * 0.05, 0.85, 0.97],
                      repeat: Infinity,
                      ease: 'easeOut',
                    }
              }
            />
          </div>
        </div>
      ))}
    </div>
  );
}
