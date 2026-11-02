import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { ArtistSearchInput } from '../features/artist/ArtistSearchInput';
import { ArtistModeGuide } from '../features/game/ModeGuide';
import { usePageTitle } from '../hooks/usePageTitle';
import type { ArtistSearchResult } from '../types/api';

export function ArtistSearchPage() {
  usePageTitle('Artist Mode');
  const navigate = useNavigate();
  const [artist, setArtist] = useState<ArtistSearchResult | null>(null);

  const startGame = (mode: 'search' | 'choice') => {
    if (!artist) return;
    navigate(`/artist/${artist.id}/play?guessMode=${mode}&includeFeatures=false`);
  };

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center gap-5 px-4 py-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-1 text-center"
      >
        <h1 className="text-3xl font-extrabold text-white tracking-tight">Artist Mode</h1>
        <p className="text-sm text-slate-500">10 songs from any artist's discography</p>
      </motion.div>

      {/* Only before an artist is chosen: once someone has picked, they know what they came
          for and the guide is just something between them and the start button. */}
      {!artist && <ArtistModeGuide />}

      <ArtistSearchInput onSelect={(a) => setArtist(a)} />

      {artist && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass w-full rounded-2xl p-5 flex flex-col gap-4 border border-white/10"
        >
          <div className="flex items-center gap-3.5">
            {artist.pictureUrl ? (
              <img
                src={artist.pictureUrl}
                alt={artist.name}
                className="h-11 w-11 rounded-full object-cover ring-2 ring-white/10"
              />
            ) : (
              <div className="h-11 w-11 rounded-full bg-white/10 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5 text-slate-500">
                  <path d="M11.645 20.91l-.007-.003-.022-.012a15.247 15.247 0 01-.383-.218 25.18 25.18 0 01-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0112 5.052 5.5 5.5 0 0116.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 01-4.244 3.17 15.247 15.247 0 01-.383.219l-.022.012-.007.004-.003.001a.752.752 0 01-.704 0l-.003-.001z" />
                </svg>
              </div>
            )}
            <h2 className="text-lg font-bold text-white truncate">{artist.name}</h2>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => startGame('search')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3.5 transition-all hover:bg-white/[0.07] hover:border-white/20 active:scale-[0.97]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-5 w-5 text-slate-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10"
                />
              </svg>
              <span className="text-sm font-medium text-white">Type to search</span>
            </button>
            <button
              type="button"
              onClick={() => startGame('choice')}
              className="flex flex-col items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3.5 transition-all hover:bg-white/[0.07] hover:border-white/20 active:scale-[0.97]"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="h-5 w-5 text-slate-400"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z"
                />
              </svg>
              <span className="text-sm font-medium text-white">Multiple choice</span>
            </button>
          </div>
        </motion.div>
      )}
    </div>
  );
}
