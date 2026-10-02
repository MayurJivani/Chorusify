/**
 * Artist-or-category chooser shared by room creation and the "race something else" flow on the
 * results screen. Extracted so the post-game switch offers exactly the same choices as the
 * lobby did — a second, drifting copy of this list is how the two ended up disagreeing about
 * which categories exist.
 */
import { useEffect, useState } from 'react';
import { VinylSpinner } from '../easter-eggs/VinylSpinner';
import { ArtistSearchInput } from '../artist/ArtistSearchInput';
import { getCategories } from '../../api/categories';
import { getSoundtrackCollections } from '../../api/soundtracks';
import type { ArtistSearchResult, Category, SoundtrackCollection } from '../../types/api';

/**
 * What a room races over. The game is identical for all three; only the pool differs.
 *
 * Movies are a separate kind rather than a category even though the server resolves them
 * through the same source, because they are a separate mode to a player — mixing four film
 * collections into a list of seventy-two categories is how they got lost in the first place.
 */
export type SourceKind = 'artist' | 'category' | 'soundtrack';

export type PickedSource =
  | { kind: 'artist'; artist: ArtistSearchResult }
  // Always non-empty. Most callers (duels) only ever put one category in here; multiplayer's
  // room creation and "race something else" opt into picking several via `multiSelectCategories`.
  | { kind: 'category'; categories: Category[] }
  | { kind: 'soundtrack'; collection: SoundtrackCollection };

/** Mirrors MAX_COMBINED_CATEGORIES in the server's challengeSource.ts. */
const MAX_SELECTED_CATEGORIES = 5;

interface SourcePickerProps {
  value: PickedSource | null;
  onChange: (source: PickedSource | null) => void;
  /** Caps the category grid's height. The results screen has less room than the home page. */
  compact?: boolean;
  /**
   * Opens on the Movie tab with this collection already chosen. Set from `?soundtrackId=` so the
   * "Multiplayer" and "Duel" buttons on the Guess the Movie page land somewhere useful instead
   * of dropping the player on an artist search with their choice forgotten.
   */
  preselectSoundtrackId?: string;
  /**
   * Lets the Category tab pick up to MAX_SELECTED_CATEGORIES at once, merged into one pool —
   * the same composite-id trick the solo Category picker uses. Off by default: duels queue
   * players by an exact source key, and mixing categories there would need its own rating
   * ladder per combination rather than reusing the single-category ones.
   */
  multiSelectCategories?: boolean;
}

export function SourcePicker({
  value,
  onChange,
  compact = false,
  preselectSoundtrackId,
  multiSelectCategories = false,
}: SourcePickerProps) {
  const [kind, setKind] = useState<SourceKind>(
    preselectSoundtrackId ? 'soundtrack' : (value?.kind ?? 'artist'),
  );
  const [categories, setCategories] = useState<Category[]>([]);
  const [movies, setMovies] = useState<SoundtrackCollection[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Fetched lazily, per tab: someone racing over an artist never needs either list.
  useEffect(() => {
    if (kind !== 'category' || categories.length > 0) return;
    getCategories()
      // Movie collections come back from /categories too (they are browsable there), but this
      // picker has its own Movie tab. Choosing one from the Category tab would queue a duel on
      // the category rating ladder instead of the movie one, so they are filtered out here.
      .then((all) => setCategories(all.filter((c) => c.group !== 'soundtrack')))
      .catch(() => setError('Could not load categories.'));
  }, [kind, categories.length]);

  useEffect(() => {
    if (kind !== 'soundtrack' || movies.length > 0) return;
    getSoundtrackCollections()
      .then(setMovies)
      .catch(() => setError('Could not load movie collections.'));
  }, [kind, movies.length]);

  /* Runs once the list arrives rather than on mount, because the collection object itself is
     what the caller needs - an id alone cannot fill in the label the confirm button shows. */
  useEffect(() => {
    if (!preselectSoundtrackId || value != null) return;
    const match = movies.find((m) => m.id === preselectSoundtrackId);
    if (match) onChange({ kind: 'soundtrack', collection: match });
  }, [preselectSoundtrackId, movies, value, onChange]);

  const selectedCategoryIds =
    value?.kind === 'category' ? new Set(value.categories.map((c) => c.id)) : null;
  const selectedId = value?.kind === 'soundtrack' ? value.collection.id : null;

  const pickCategory = (category: Category) => {
    if (!multiSelectCategories) {
      onChange({ kind: 'category', categories: [category] });
      return;
    }
    const current = value?.kind === 'category' ? value.categories : [];
    const isSelected = current.some((c) => c.id === category.id);
    if (isSelected) {
      const next = current.filter((c) => c.id !== category.id);
      onChange(next.length > 0 ? { kind: 'category', categories: next } : null);
      return;
    }
    if (current.length >= MAX_SELECTED_CATEGORIES) return;
    onChange({ kind: 'category', categories: [...current, category] });
  };

  return (
    <div className="flex w-full flex-col gap-3">
      <div
        role="tablist"
        aria-label="What to race over"
        className="flex w-full gap-1.5 rounded-xl border border-white/5 bg-chorusify-bg/80 p-1.5"
      >
        {(
          [
            ['artist', 'Artist'],
            ['category', 'Category'],
            ['soundtrack', 'Soundtrack'],
          ] as [SourceKind, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={kind === k}
            onClick={() => {
              setKind(k);
              onChange(null);
            }}
            className={
              'flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-all duration-200 ' +
              (kind === k
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {kind === 'artist' ? (
        <ArtistSearchInput onSelect={(artist) => onChange({ kind: 'artist', artist })} />
      ) : (
        <div
          className={`glass grid w-full auto-rows-min grid-cols-2 items-stretch gap-2 overflow-y-auto rounded-2xl p-3 sm:grid-cols-3 ${
            compact ? 'max-h-44' : 'max-h-64'
          }`}
        >
          {error && (
            <p className="col-span-full py-4 text-center text-sm text-slate-400">{error}</p>
          )}
          {!error && (kind === 'category' ? categories : movies).length === 0 && (
            <div className="col-span-full py-4">
              <VinylSpinner size={28} text="Loading…" />
            </div>
          )}
          {(kind === 'category'
            ? categories.map((c) => ({
                id: c.id,
                label: c.label,
                here: (c.playing ?? 0) + (c.queued ?? 0),
                pick: () => pickCategory(c),
                selected: selectedCategoryIds?.has(c.id) ?? false,
              }))
            : movies.map((m) => ({
                id: m.id,
                label: m.label,
                here: (m.playing ?? 0) + (m.queued ?? 0),
                pick: () => onChange({ kind: 'soundtrack' as const, collection: m }),
                selected: selectedId === m.id,
              }))
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.pick}
              aria-pressed={item.selected}
              className={
                'rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all ' +
                (item.selected
                  ? 'border-chorusify-accent/60 bg-chorusify-accent/15 text-white'
                  : 'border-white/5 bg-white/[0.03] text-slate-300 hover:bg-white/[0.06]')
              }
            >
              {/*
                Wraps rather than truncates. A single line at this width cut ten of the
                seventy-odd names - "Top Worldwide 2025" became "Top Worldwide 20…", losing the
                year, which is the only thing distinguishing it from "Top Worldwide Now". A name
                you cannot read is not a choice you can make.
              */}
              <span className="block leading-tight">{item.label}</span>
              {/* Only shown where somebody actually is - a row of zeroes would just say
                  "nobody is anywhere", which is worse than saying nothing. */}
              {item.here > 0 && (
                <span className="mt-0.5 flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                  <span className="h-1 w-1 rounded-full bg-emerald-400" />
                  {item.here} here
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
