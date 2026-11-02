import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion } from 'motion/react';
import { useSession } from '../hooks/useSession';
import { getMyFandoms, getTopFandoms, joinFandom } from '../api/fandom';
import { apiRequest } from '../api/client';
import { usePageTitle } from '../hooks/usePageTitle';
import type { FandomInfo, TopFandom, ArtistSearchResult } from '../types/api';

export function FandomsPage() {
  usePageTitle('Fandoms');

  const { user } = useSession();
  const navigate = useNavigate();
  const [myFandoms, setMyFandoms] = useState<FandomInfo[]>([]);
  const [topFandoms, setTopFandoms] = useState<TopFandom[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ArtistSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);

  const userId = user?.id;
  useEffect(() => {
    getTopFandoms()
      .then(setTopFandoms)
      .catch(() => {});
    if (userId)
      getMyFandoms()
        .then(setMyFandoms)
        .catch(() => {});
  }, [userId]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await apiRequest<{ results: ArtistSearchResult[] }>(
          `/artists/search?q=${encodeURIComponent(query.trim())}`,
        );
        setResults(res.results);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [query]);

  const handleJoin = async (artist: ArtistSearchResult) => {
    if (!user) {
      navigate('/login');
      return;
    }
    setJoining(String(artist.id));
    try {
      const { membership } = await joinFandom(String(artist.id), artist.name, artist.pictureUrl);
      setMyFandoms((prev) => [
        membership,
        ...prev.filter((f) => f.deezerArtistId !== String(artist.id)),
      ]);
      setQuery('');
      setResults([]);
    } finally {
      setJoining(null);
    }
  };

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col gap-6 px-4 py-6">
      <motion.h1
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-extrabold gradient-text"
      >
        Fandoms
      </motion.h1>

      {/* Search to join a fandom */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search an artist to join their fandom..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder-slate-500 outline-none focus:border-chorusify-accent/50"
        />
        {searching && (
          <span className="absolute right-4 top-3.5 text-xs text-slate-500">Searching...</span>
        )}
        {results.length > 0 && (
          <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-xl border border-white/10 bg-[#1a1a2e] shadow-xl">
            {results.map((artist) => {
              const alreadyJoined = myFandoms.some((f) => f.deezerArtistId === String(artist.id));
              return (
                <button
                  key={artist.id}
                  onClick={() =>
                    alreadyJoined ? navigate(`/fandom/${artist.id}`) : handleJoin(artist)
                  }
                  disabled={joining === String(artist.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5"
                >
                  {artist.pictureUrl ? (
                    <img
                      src={artist.pictureUrl}
                      alt=""
                      className="h-9 w-9 rounded-full object-cover"
                    />
                  ) : (
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-xs font-bold text-slate-300">
                      {artist.name.charAt(0)}
                    </span>
                  )}
                  <span className="flex-1 truncate text-sm font-medium text-white">
                    {artist.name}
                  </span>
                  <span className="shrink-0 text-xs font-medium text-chorusify-accent">
                    {alreadyJoined ? 'View' : joining === String(artist.id) ? 'Joining...' : 'Join'}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* My fandoms */}
      {user && myFandoms.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Your fandoms
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {myFandoms.map((f) => (
              <Link
                key={f.deezerArtistId}
                to={`/fandom/${f.deezerArtistId}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/[0.08]"
              >
                {f.artistPictureUrl ? (
                  <img
                    src={f.artistPictureUrl}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-slate-300">
                    {f.artistName.charAt(0)}
                  </span>
                )}
                <div className="flex flex-1 flex-col overflow-hidden">
                  <span className="truncate text-sm font-semibold text-white">{f.fandomName}</span>
                  <span className="text-[11px] text-slate-400">
                    {f.fanScore} pts &middot; {f.tier} &middot; #{f.rank}
                  </span>
                </div>
                <span
                  className={
                    'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ' +
                    tierBadgeClass(f.cardStyle)
                  }
                >
                  {f.rarity}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Top fandoms */}
      {topFandoms.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
            Popular fandoms
          </h2>
          <div className="grid gap-2 sm:grid-cols-2">
            {topFandoms.map((f) => (
              <Link
                key={f.deezerArtistId}
                to={`/fandom/${f.deezerArtistId}`}
                className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-colors hover:bg-white/[0.08]"
              >
                {f.artistPictureUrl ? (
                  <img
                    src={f.artistPictureUrl}
                    alt=""
                    className="h-10 w-10 rounded-full object-cover"
                  />
                ) : (
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-slate-300">
                    {f.artistName.charAt(0)}
                  </span>
                )}
                <div className="flex flex-1 flex-col overflow-hidden">
                  <span className="truncate text-sm font-semibold text-white">{f.fandomName}</span>
                  <span className="text-[11px] text-slate-400">
                    {f.artistName} &middot; {f.memberCount}{' '}
                    {f.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {topFandoms.length === 0 && myFandoms.length === 0 && (
        <p className="text-center text-sm text-slate-500">
          No fandoms yet. Search for an artist above to start one!
        </p>
      )}
    </div>
  );
}

function tierBadgeClass(cardStyle: string): string {
  switch (cardStyle) {
    case 'holographic':
      return 'bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 text-white';
    case 'gold':
      return 'bg-gradient-to-r from-yellow-500 to-amber-400 text-black';
    case 'silver':
      return 'bg-gradient-to-r from-slate-300 to-slate-400 text-black';
    case 'gradient':
      return 'bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white';
    case 'warm':
      return 'bg-gradient-to-r from-orange-500 to-amber-600 text-white';
    case 'shine':
      return 'bg-chorusify-accent/20 text-chorusify-accent';
    case 'flat':
      return 'bg-white/10 text-slate-300';
    default:
      return 'bg-white/5 text-slate-400';
  }
}
