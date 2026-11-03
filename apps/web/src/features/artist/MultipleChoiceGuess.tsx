import { useState, useEffect } from 'react';
import { RevealMoreButton } from '../game/RevealMoreButton';
import type { ArtistRoundOption, RevealedSong, SongSearchResult } from '../../types/api';

interface MultipleChoiceGuessProps {
  options: ArtistRoundOption[];
  onGuess: (song: SongSearchResult) => void;
  onSkip: () => void;
  disabled?: boolean;
  revealedSong?: RevealedSong | null;
  roundEnded?: boolean;
  selectedGuessId?: string | null;
  /** When provided, a separate "Reveal more" button is shown alongside Skip. */
  onRevealMore?: () => void;
  /** Whether there is more snippet left to reveal. Hides the reveal button when false. */
  canRevealMore?: boolean;
  /**
   * Multiplayer: the answer this player committed to, still awaiting everyone else.
   *
   * The options stay on screen rather than being swapped for a status card, because in a race
   * the thing you want to check while waiting is *what you picked* — replacing the list with
   * "Locked in!" left players unable to see their own answer until the reveal.
   */
  lockedGuessId?: string | null;
  /** Tightens spacing so four options and the player still fit a phone without scrolling. */
  dense?: boolean;
  /**
   * Lays the options out two-up instead of stacked.
   *
   * Four in a column is a long read on a phone and pushes the scoreboard off screen; a 2×2 grid
   * is one glance, and the pairs stay big enough to hit with a thumb. Titles truncate harder as
   * a result, which is the trade — the artist line underneath still disambiguates.
   */
  twoColumn?: boolean;
  /** Seconds now and after the next reveal, so the button can offer a concrete "+3s". */
  currentSeconds?: number;
  nextSeconds?: number;
  /** Draws attention to the reveal the first time it is offered in a run. */
  emphasiseReveal?: boolean;
}

/** The same four tints as the TV screen, so "B" means the same tile on the wall and the phone. */
const LETTER_TINT = [
  'bg-violet-500/25 text-violet-100',
  'bg-cyan-500/25 text-cyan-100',
  'bg-amber-500/25 text-amber-100',
  'bg-emerald-500/25 text-emerald-100',
];

export function MultipleChoiceGuess({
  options,
  onGuess,
  onSkip,
  disabled,
  revealedSong,
  roundEnded,
  selectedGuessId,
  onRevealMore,
  canRevealMore = true,
  lockedGuessId = null,
  dense = false,
  twoColumn = false,
  currentSeconds,
  nextSeconds,
  emphasiseReveal = false,
}: MultipleChoiceGuessProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    setSelectedId(null);
  }, [options]);

  const locked = lockedGuessId !== null;

  const handleSelect = (option: ArtistRoundOption) => {
    if (disabled || roundEnded || locked) return;
    setSelectedId(option.deezerTrackId);
    onGuess({
      id: option.deezerTrackId,
      title: option.title,
      artist: option.artist,
      albumArtUrl: null,
    });
  };

  return (
    <div className={`flex w-full max-w-md flex-col ${dense ? 'gap-1.5' : 'gap-2.5'}`}>
      {/* The options get their own container so the grid does not also lay out Skip/Reveal. */}
      <div
        className={
          (twoColumn ? 'grid grid-cols-2 items-stretch' : 'flex flex-col') +
          (dense ? ' gap-1.5' : ' gap-2.5')
        }
      >
        {options.map((option, index) => {
          const isSelected = roundEnded
            ? selectedGuessId === option.deezerTrackId
            : selectedId === option.deezerTrackId;
          const isCorrect =
            roundEnded &&
            revealedSong &&
            option.title.toLowerCase() === revealedSong.title.toLowerCase();
          const isWrong = roundEnded && isSelected && !isCorrect;

          let styleClass =
            'border-white/10 bg-chorusify-surface/80 text-slate-100 hover:border-white/30 hover:bg-white/5';
          let badge = null;

          if (roundEnded) {
            if (isCorrect) {
              styleClass =
                'border-emerald-500 bg-emerald-950/80 text-emerald-200 ring-2 ring-emerald-500/50 shadow-lg shadow-emerald-950/50';
              badge = (
                <span className="text-emerald-400 font-bold text-xs px-2 py-0.5 rounded-md bg-emerald-900/60 border border-emerald-500/30">
                  {twoColumn ? '✓' : '✓ Correct'}
                </span>
              );
            } else if (isWrong) {
              styleClass =
                'border-red-500 bg-red-950/80 text-red-200 ring-2 ring-red-500/50 shadow-lg shadow-red-950/50';
              badge = (
                <span className="text-red-400 font-bold text-xs px-2 py-0.5 rounded-md bg-red-900/60 border border-red-500/30">
                  {twoColumn ? '✕' : '✕ Wrong'}
                </span>
              );
            } else {
              styleClass = 'border-white/5 bg-white/5 text-slate-500 opacity-40';
            }
          } else if (locked) {
            // Waiting on the rest of the room: the pick stays legible and everything else dims,
            // so a glance answers "what did I go with?" without waiting for the reveal.
            if (option.deezerTrackId === lockedGuessId) {
              styleClass =
                'border-chorusify-accent2/70 bg-chorusify-accent2/10 text-white ring-2 ring-chorusify-accent2/40';
              badge = (
                <span className="rounded-md border border-chorusify-accent2/30 bg-chorusify-accent2/15 px-2 py-0.5 text-[11px] font-bold text-chorusify-accent2">
                  {twoColumn ? '🔒' : '🔒 Locked'}
                </span>
              );
            } else {
              styleClass = 'border-white/5 bg-white/5 text-slate-500 opacity-40';
            }
          } else if (isSelected) {
            styleClass = 'border-white/40 bg-white/10 text-white';
          }

          return (
            <button
              key={option.deezerTrackId}
              type="button"
              disabled={disabled || roundEnded || locked}
              onClick={() => handleSelect(option)}
              className={`flex items-center justify-between gap-2 rounded-xl border text-left backdrop-blur-sm transition-all duration-200 ${
                dense ? 'px-3 py-2.5' : 'px-4 py-3.5'
              } ${styleClass} disabled:cursor-not-allowed`}
            >
              {/* min-w-0 is what lets the truncation actually happen: without it this flex child
                refuses to shrink below its content, and a long title ("Bang My Head (feat. Sia
                & Fetty Wap)") pushes the result badge off a phone screen entirely. */}
              <span
                aria-hidden="true"
                className={`flex shrink-0 items-center justify-center rounded-full font-bold ${LETTER_TINT[index % 4]} ${dense ? 'h-6 w-6 text-[11px]' : 'h-7 w-7 text-xs'}`}
              >
                {'ABCD'[index] ?? index + 1}
              </span>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={`truncate font-semibold ${dense ? 'text-sm' : 'text-base'}`}>
                  {option.title}
                </span>
                {/* Guess the Movie sends options with no artist line - the option is a film, and
                    the field that would sit here holds the song that is currently playing.
                    Rendering it empty would just leave a dead row of padding under each title. */}
                {option.artist && (
                  <span className="truncate text-xs opacity-75">{option.artist}</span>
                )}
              </div>
              {badge && <span className="shrink-0">{badge}</span>}
            </button>
          );
        })}
      </div>

      {!roundEnded &&
        !locked &&
        (onRevealMore ? (
          <div className="mt-1 flex gap-2 w-full">
            <button
              type="button"
              onClick={onSkip}
              disabled={disabled}
              // Narrower and quieter than Reveal: this is the one that costs you the round.
              className="btn-ghost shrink-0 !rounded-xl !px-4 !py-2.5 !text-sm !text-slate-400"
            >
              Skip
            </button>
            {canRevealMore && (
              <RevealMoreButton
                onRevealMore={onRevealMore}
                currentSeconds={currentSeconds}
                nextSeconds={nextSeconds}
                disabled={disabled}
                emphasise={emphasiseReveal}
              />
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={onSkip}
            disabled={disabled}
            className="btn-ghost mt-1 w-full !rounded-xl !py-2.5 !text-sm"
          >
            Skip
          </button>
        ))}
    </div>
  );
}
