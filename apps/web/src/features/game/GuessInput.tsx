import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { searchSongs } from '../../api/songs';
import { RevealMoreButton } from './RevealMoreButton';
import type { SongSearchResult } from '../../types/api';

interface GuessInputProps {
  onGuess: (song: SongSearchResult) => void;
  onSkip: () => void;
  disabled?: boolean;
  /** Defaults to searching the global curated song bank (the daily puzzle). Artist Mode
   * passes a search scoped to that artist's challenge tracks instead. */
  searchFn?: (query: string) => Promise<SongSearchResult[]>;
  /** Brief visual feedback after a guess: 'correct' = green flash, 'wrong' = red flash. */
  guessFeedback?: 'correct' | 'wrong' | null;
  /** When provided, a separate "Reveal more" button is shown alongside Skip. */
  onRevealMore?: () => void;
  /** Whether there is more snippet left to reveal. Hides the reveal button when false. */
  canRevealMore?: boolean;
  /** Seconds now and after the next reveal, so the button can offer a concrete "+3s". */
  currentSeconds?: number;
  nextSeconds?: number;
  /** Draws attention to the reveal the first time it is offered in a run. */
  emphasiseReveal?: boolean;
  /**
   * Set on the daily, where hearing more spends an attempt. Skip still gets its own button there:
   * without it, the only way past a song was pressing Hear more once per attempt, which a player
   * in a hurry spammed straight into the rate limit.
   */
  revealCostsGuess?: boolean;
}

export function GuessInput({
  onGuess,
  onSkip,
  disabled,
  searchFn = searchSongs,
  guessFeedback,
  onRevealMore,
  canRevealMore = true,
  currentSeconds,
  nextSeconds,
  emphasiseReveal = false,
  revealCostsGuess = false,
}: GuessInputProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SongSearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      const matches = await searchFn(query);
      setResults(matches);
      setActiveIndex(-1);
      setOpen(matches.length > 0);
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, searchFn]);

  const selectSong = (song: SongSearchResult) => {
    onGuess(song);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      const song = results[activeIndex];
      if (song) selectSong(song);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div className="relative w-full max-w-md">
      <input
        type="text"
        value={query}
        disabled={disabled}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={() => setOpen(results.length > 0)}
        placeholder="Guess the song title or artist…"
        className={
          'input-base transition-shadow duration-300 ' +
          (guessFeedback === 'correct'
            ? 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.4)]'
            : guessFeedback === 'wrong'
              ? 'ring-2 ring-red-500 shadow-[0_0_12px_rgba(239,68,68,0.4)]'
              : '')
        }
      />

      {open && (
        <ul className="absolute z-10 mt-1.5 w-full overflow-hidden rounded-xl border border-white/10 bg-chorusify-surface/90 shadow-2xl shadow-black/50 backdrop-blur-xl">
          {results.map((song, i) => (
            <li key={song.id}>
              <button
                type="button"
                onClick={() => selectSong(song)}
                className={
                  'flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ' +
                  (i === activeIndex ? 'bg-chorusify-accent/20' : 'hover:bg-chorusify-accent/10')
                }
              >
                {/* Album art thumbnail */}
                {song.albumArtUrl ? (
                  <img
                    src={song.albumArtUrl}
                    alt=""
                    className="h-9 w-9 flex-shrink-0 rounded-md object-cover shadow-md"
                  />
                ) : (
                  <div className="h-9 w-9 flex-shrink-0 rounded-md bg-chorusify-surface-2 flex items-center justify-center text-slate-600 text-xs">
                    ♪
                  </div>
                )}
                <span className="flex flex-col">
                  <span className="text-sm font-medium text-slate-100">{song.title}</span>
                  <span className="text-xs text-slate-400">{song.artist}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {onRevealMore ? (
        <div className="mt-3 flex gap-2 w-full">
          <button
            type="button"
            onClick={onSkip}
            disabled={disabled}
            // Narrower and quieter than Reveal: this is the one that costs you the round.
            className={`btn-ghost ${canRevealMore ? 'shrink-0' : 'w-full'} !rounded-xl !px-4 !py-2.5 !text-sm !text-slate-400`}
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
              costsGuess={revealCostsGuess}
            />
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={onSkip}
          disabled={disabled}
          className="btn-ghost mt-3 w-full !rounded-xl !py-2.5 !text-sm"
        >
          Skip
        </button>
      )}
    </div>
  );
}
