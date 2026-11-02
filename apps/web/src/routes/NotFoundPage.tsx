import { Link, useLocation } from 'react-router-dom';
import { motion } from 'motion/react';
import { usePageTitle } from '../hooks/usePageTitle';

/**
 * The catch-all route.
 *
 * Worth more than a bare "404" here: the server serves index.html for every non-API path, so
 * anything mistyped, any dead shared link, and any renamed route all land on this page rather
 * than a browser error. The way back into the game is the point, so each mode gets a link.
 */
const DESTINATIONS = [
  { to: '/play', label: 'Daily Challenge' },
  { to: '/artist', label: 'Artist Mode' },
  { to: '/categories', label: 'Categories' },
  { to: '/multiplayer', label: 'Multiplayer' },
] as const;

export function NotFoundPage() {
  usePageTitle('Page Not Found');
  const { pathname } = useLocation();

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-6 px-4 py-10 text-center">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-4"
      >
        {/* A record that skipped - the same vinyl motif as the logo, stopped mid-spin. */}
        <div className="relative flex h-24 w-24 items-center justify-center" aria-hidden="true">
          <svg viewBox="0 0 32 32" className="h-full w-full opacity-70">
            <circle cx="16" cy="16" r="15.5" fill="#151515" stroke="#252525" strokeWidth="0.5" />
            <circle cx="16" cy="16" r="13" fill="none" stroke="#222" strokeWidth="0.3" />
            <circle cx="16" cy="16" r="11.5" fill="none" stroke="#1c1c1c" strokeWidth="0.3" />
            <circle cx="16" cy="16" r="10" fill="none" stroke="#222" strokeWidth="0.3" />
            <defs>
              <radialGradient id="notfound-grad" cx="50%" cy="50%" r="50%">
                <stop offset="0%" stopColor="#a78bfa" />
                <stop offset="100%" stopColor="#7c3aed" />
              </radialGradient>
            </defs>
            <circle cx="16" cy="16" r="5.5" fill="url(#notfound-grad)" />
            <circle cx="16" cy="16" r="1.2" fill="#000" />
          </svg>
        </div>

        <div className="flex flex-col gap-2">
          <p className="font-mono text-sm uppercase tracking-[0.3em] text-purple-400">404</p>
          <h1 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
            This track isn’t in our catalog
          </h1>
          <p className="mx-auto max-w-sm text-sm leading-relaxed text-slate-400">
            Nothing lives at <span className="break-all font-mono text-slate-300">{pathname}</span>.
            It may have been moved, or the link may be incomplete.
          </p>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="flex w-full flex-col items-center gap-5"
      >
        <Link to="/" className="btn-primary !px-8">
          Back to Chorusify
        </Link>

        <div className="grid w-full grid-cols-2 gap-2">
          {DESTINATIONS.map((destination) => (
            <Link
              key={destination.to}
              to={destination.to}
              className="glass rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-300 transition-all duration-200 hover:-translate-y-0.5 hover:border-white/20 hover:text-white"
            >
              <span className="truncate">{destination.label}</span>
            </Link>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
