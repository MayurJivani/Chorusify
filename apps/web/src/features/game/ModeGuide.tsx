/**
 * The three-step "what happens here" strip shown at the top of a mode.
 *
 * It lives inside the mode rather than on the home page because that is where the answer is
 * actually needed: on the landing page it was explaining scoring to someone who hadn't chosen
 * anything yet, and it pushed the modes themselves below the fold.
 *
 * Purely shapes and motion — no emoji. The home page already carries an icon per mode and
 * those have to stay distinct from each other; adding a second decorative set here is how you
 * end up with the same glyph meaning two different things on adjacent screens.
 */
import { motion, useReducedMotion } from 'motion/react';
import type { ReactNode } from 'react';

interface GuideStep {
  title: string;
  visual: ReactNode;
}

function GuideShell({ steps }: { steps: GuideStep[] }) {
  return (
    <div className="glass w-full rounded-2xl border border-white/10 p-3">
      <ol className="grid grid-cols-3 gap-2">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-col items-center gap-1.5 text-center">
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-white/10 font-mono text-[9px] font-bold text-slate-300">
              {i + 1}
            </span>
            <div className="flex h-7 w-full items-center justify-center">{step.visual}</div>
            <span className="text-[10px] leading-tight text-slate-400">{step.title}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** A clip growing from a sliver to the full bar — the thing "hear more" actually does. */
function GrowingClip({ accent }: { accent: string }) {
  const reduce = useReducedMotion();
  return (
    <div className="h-1.5 w-full max-w-[52px] overflow-hidden rounded-full bg-white/10">
      <motion.div
        className={`h-full rounded-full ${accent}`}
        initial={{ width: '15%' }}
        animate={reduce ? { width: '100%' } : { width: ['15%', '100%', '100%', '15%'] }}
        transition={reduce ? undefined : { duration: 3, times: [0, 0.5, 0.8, 1], repeat: Infinity }}
      />
    </div>
  );
}

/** Score falling as the clip runs on — the trade the reveal control is making. */
function FallingPoints() {
  const reduce = useReducedMotion();
  const values = [6, 4, 2];
  return (
    <div className="relative h-full w-full">
      {values.map((v, i) => (
        <motion.span
          key={v}
          className="absolute inset-0 flex items-center justify-center font-mono text-xs font-bold text-chorusify-accent2"
          initial={{ opacity: i === 0 ? 1 : 0 }}
          animate={reduce ? { opacity: i === 0 ? 1 : 0 } : { opacity: [0, 1, 1, 0] }}
          transition={
            reduce
              ? undefined
              : {
                  duration: 3,
                  times: [0, 0.05, 0.28, 0.33],
                  delay: i,
                  repeat: Infinity,
                  repeatDelay: values.length - 1,
                }
          }
        >
          {v} pts
        </motion.span>
      ))}
    </div>
  );
}

/** Three dots settling into a row — a room filling up. */
function JoiningPlayers() {
  const reduce = useReducedMotion();
  const colours = ['bg-chorusify-accent2', 'bg-chorusify-accent', 'bg-emerald-500'];
  return (
    <div className="flex items-center gap-1.5">
      {colours.map((c, i) => (
        <motion.span
          key={c}
          className={`h-2.5 w-2.5 rounded-full ${c}`}
          initial={{ scale: 0, opacity: 0 }}
          animate={
            reduce ? { scale: 1, opacity: 1 } : { scale: [0, 1, 1, 0], opacity: [0, 1, 1, 0] }
          }
          transition={
            reduce
              ? undefined
              : {
                  duration: 3,
                  times: [0, 0.2, 0.85, 1],
                  delay: i * 0.18,
                  repeat: Infinity,
                }
          }
        />
      ))}
    </div>
  );
}

/** Bars pulling apart, the winner arriving first. */
function RacingBars() {
  const reduce = useReducedMotion();
  const rows = [
    { c: 'bg-chorusify-accent2', w: '100%' },
    { c: 'bg-chorusify-accent', w: '65%' },
  ];
  return (
    <div className="flex w-full max-w-[52px] flex-col gap-1">
      {rows.map((r, i) => (
        <div key={r.c} className="h-1.5 overflow-hidden rounded-full bg-white/10">
          <motion.div
            className={`h-full rounded-full ${r.c}`}
            initial={{ width: '0%' }}
            animate={reduce ? { width: r.w } : { width: ['0%', r.w, r.w, '0%'] }}
            transition={
              reduce
                ? undefined
                : {
                    duration: 3,
                    times: [0, 0.45 + i * 0.12, 0.85, 1],
                    repeat: Infinity,
                    ease: 'easeOut',
                  }
            }
          />
        </div>
      ))}
    </div>
  );
}

/** A search field with a name landing in it. */
function TypedName({ name }: { name: string }) {
  return (
    <div className="flex w-full max-w-[68px] items-center rounded border border-white/10 bg-white/5 px-1.5 py-0.5">
      <span className="truncate font-mono text-[8px] text-slate-300">{name}</span>
    </div>
  );
}

export function ArtistModeGuide() {
  return (
    <GuideShell
      steps={[
        { title: 'Pick any artist', visual: <TypedName name="Peter Cat…" /> },
        {
          title: 'Hear a clip, name the song',
          visual: <GrowingClip accent="bg-chorusify-accent" />,
        },
        { title: 'Guess sooner, score more', visual: <FallingPoints /> },
      ]}
    />
  );
}

export function MultiplayerGuide() {
  return (
    <GuideShell
      steps={[
        { title: 'Share the code or QR', visual: <JoiningPlayers /> },
        {
          title: 'Everyone hears the same clip',
          visual: <GrowingClip accent="bg-chorusify-accent2" />,
        },
        { title: 'Fastest correct wins', visual: <RacingBars /> },
      ]}
    />
  );
}
