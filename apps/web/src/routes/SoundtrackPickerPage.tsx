/**
 * Soundtracks' landing page — the mode's front door, not a slice of the category list.
 *
 * Each collection offers all three ways to play it up front. Burying multiplayer behind a
 * separate page meant the only obvious thing to do with a collection was play it alone, which
 * is the least interesting of the three for a mode that is mostly fun to argue about.
 */
import { useEffect, useState } from 'react';
import { VinylSpinner } from '../features/easter-eggs/VinylSpinner';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { getSoundtrackCollections } from '../api/soundtracks';
import { usePageTitle } from '../hooks/usePageTitle';
import type { SoundtrackCollection } from '../types/api';

export function SoundtrackPickerPage() {
  usePageTitle('Soundtracks');
  const navigate = useNavigate();
  const [collections, setCollections] = useState<SoundtrackCollection[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getSoundtrackCollections()
      .then(setCollections)
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pb-16 pt-4 sm:pt-6">
      <header className="mb-6 text-center">
        <h1 className="text-3xl font-extrabold text-white sm:text-4xl">Soundtracks</h1>
        <p className="mt-1 text-sm text-slate-400">
          A few seconds of music. Name the film, game or anime it came from.
        </p>
      </header>

      {loading && (
        <div className="py-10">
          <VinylSpinner text="Loading collections…" />
        </div>
      )}
      {failed && (
        <p className="py-10 text-center text-sm text-slate-400">
          Could not load the collections. Please try again.
        </p>
      )}

      <div className="flex flex-col gap-3">
        {collections.map((collection, index) => {
          const here = (collection.playing ?? 0) + (collection.queued ?? 0);
          return (
            <motion.section
              key={collection.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
              className="glass rounded-2xl border border-white/10 p-4"
            >
              {/* Badges sit on the title row rather than in the same wrapping flow as the
                  blurb, which dropped them onto their own line only for the collections whose
                  blurb happened to be long. */}
              <div className="flex items-center justify-between gap-2">
                <h2 className="min-w-0 text-lg font-bold leading-tight text-white">
                  {collection.label}
                </h2>
                <div className="flex shrink-0 items-center gap-1.5">
                  {collection.kind === 'score' && (
                    <span className="rounded-full border border-chorusify-accent2/40 bg-chorusify-accent2/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-chorusify-accent2">
                      Instrumental
                    </span>
                  )}
                  <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] font-semibold text-slate-300">
                    {collection.filmCount} titles
                  </span>
                </div>
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{collection.blurb}</p>

              {/* Only rendered where somebody actually is: a row of zeroes reads as "nobody
                  plays this", which is worse than saying nothing at all. */}
              {here > 0 && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  {here} {here === 1 ? 'person' : 'people'} here right now
                </p>
              )}

              {/* Solo gets the full width and the other two share a row beneath it. Three
                  equal buttons in a phone-width card wrapped "Play solo" onto two lines, and
                  gave no signal which of the three is the obvious thing to press. */}
              <div className="mt-3 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/category/${collection.id}/play?guessMode=choice`)}
                  className="btn-primary w-full !rounded-xl !py-2.5 !text-sm"
                >
                  Play solo
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/multiplayer?soundtrackId=${collection.id}`)}
                    className="btn-secondary flex-1 !rounded-xl !py-2.5 !text-sm"
                  >
                    Multiplayer
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/duels?soundtrackId=${collection.id}`)}
                    className="btn-ghost flex-1 !rounded-xl !py-2.5 !text-sm"
                  >
                    Duel
                  </button>
                </div>
              </div>
            </motion.section>
          );
        })}
      </div>
    </div>
  );
}
