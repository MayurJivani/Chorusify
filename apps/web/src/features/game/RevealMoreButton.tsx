/**
 * The "hear more audio" control, and the reason it looks the way it does.
 *
 * Reveal and Skip used to be two identical ghost buttons side by side, which hid the only thing
 * that matters about them: **Skip spends the round, Reveal costs nothing.** Players read two
 * equally-weighted grey buttons, guessed that both were some flavour of giving up, and never
 * touched Reveal — so they guessed off one second of audio and lost rounds they'd have got.
 *
 * So the hierarchy is inverted here: Reveal carries the accent and the width, Skip recedes.
 * The label states the actual gain ("+3s") rather than the vague "Reveal more", and the free-ness
 * is said outright instead of being something you infer after using it once.
 */
import { motion } from 'motion/react';

interface RevealMoreButtonProps {
  onRevealMore: () => void;
  /** Seconds of audio the next reveal unlocks. Shown so the offer is concrete. */
  nextSeconds?: number;
  /** Current seconds, for the "3s → 6s" framing. */
  currentSeconds?: number;
  disabled?: boolean;
  /** Nudges attention the first time it is offered in a run, then stops. */
  emphasise?: boolean;
  /**
   * True where hearing more spends an attempt — the daily puzzle, where advancing the snippet
   * *is* the guess. Saying "free" there would be a straight lie, and the daily is most players'
   * first screen, so it is the worst possible place to teach the wrong rule.
   */
  costsGuess?: boolean;
}

export function RevealMoreButton({
  onRevealMore,
  nextSeconds,
  currentSeconds,
  disabled,
  emphasise = false,
  costsGuess = false,
}: RevealMoreButtonProps) {
  const gain =
    nextSeconds != null && currentSeconds != null
      ? Math.max(0, nextSeconds - currentSeconds)
      : null;

  return (
    <motion.button
      type="button"
      onClick={onRevealMore}
      disabled={disabled}
      // The pulse runs only while `emphasise` is set — an animation that never stops becomes
      // background noise, and this one is meant to be noticed exactly once.
      animate={emphasise && !disabled ? { scale: [1, 1.025, 1] } : { scale: 1 }}
      transition={
        emphasise && !disabled
          ? { duration: 1.6, repeat: Infinity, ease: 'easeInOut' }
          : { duration: 0.2 }
      }
      className="group flex flex-1 items-center justify-center gap-2 rounded-xl border border-chorusify-accent2/40 bg-chorusify-accent2/10 px-4 py-2.5 font-semibold text-chorusify-accent2 transition-all duration-200 hover:border-chorusify-accent2/70 hover:bg-chorusify-accent2/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span aria-hidden="true" className="text-base leading-none">
        🔊
      </span>
      <span className="flex flex-col items-start leading-tight">
        <span className="text-sm">Hear more{gain != null && gain > 0 ? ` (+${gain}s)` : ''}</span>
        {/*
          Only the warning is worth a second line. "Free - no guess used" was reassurance nobody
          needed once the button stopped looking like Skip, and it sat under every reveal for the
          whole run. The cost case still has to be said: on the daily, advancing the snippet *is*
          the guess, and staying silent there would teach the wrong rule on most players' first
          screen.
        */}
        {costsGuess && (
          <span className="text-[10px] font-normal text-chorusify-accent2/70">
            Uses one attempt
          </span>
        )}
      </span>
    </motion.button>
  );
}
