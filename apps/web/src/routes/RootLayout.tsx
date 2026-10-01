import { useState, type ReactNode } from 'react';
import { Link, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useSession } from '../hooks/useSession';
import { useLogoClickEasterEgg } from '../features/easter-eggs/LogoClickEasterEgg';

/** The drawer's links. The home page is the mode picker, so there is no separate "play" entry. */
const MOBILE_LINKS: { to: string; label: string }[] = [
  { to: '/', label: 'Home' },
  { to: '/leaderboard', label: 'Leaderboard' },
  { to: '/stats', label: 'Stats' },
  { to: '/fandoms', label: 'Fandoms' },
  { to: '/friends', label: 'Friends' },
  { to: '/about', label: 'About' },
];

function MobileLink({
  to,
  label,
  onNavigate,
}: {
  to: string;
  label: string;
  onNavigate: () => void;
}) {
  const { pathname } = useLocation();
  const isActive = to === '/' ? pathname === '/' : pathname.startsWith(to);

  return (
    <Link
      to={to}
      onClick={onNavigate}
      aria-current={isActive ? 'page' : undefined}
      className={
        'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ' +
        (isActive ? 'bg-white/10 text-white' : 'text-slate-300 hover:bg-white/5 hover:text-white')
      }
    >
      {/* A rule that fills in on the active row: the same "you are here" signal the desktop bar
          gives, without borrowing an icon set the rest of the interface doesn't use. */}
      <span
        className={
          'h-4 w-0.5 rounded-full transition-colors ' +
          (isActive ? 'bg-chorusify-accent' : 'bg-transparent')
        }
        aria-hidden="true"
      />
      {label}
    </Link>
  );
}

function NavLink({ to, children }: { to: string; children: ReactNode }) {
  const { pathname } = useLocation();
  const isActive = pathname === to || (to !== '/' && pathname.startsWith(to));
  return (
    <Link
      to={to}
      className={
        'relative text-sm font-medium transition-colors duration-200 ' +
        (isActive ? 'text-white' : 'text-slate-400 hover:text-white')
      }
    >
      {children}
      {isActive && (
        <span className="absolute -bottom-1 left-0 right-0 h-0.5 bg-white rounded-full" />
      )}
    </Link>
  );
}

export function RootLayout() {
  const { user, loading, logout } = useSession();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const handleLogoClick = useLogoClickEasterEgg();

  const handleLogout = async () => {
    await logout();
    navigate('/');
    setMenuOpen(false);
  };

  return (
    <div className="h-screen flex flex-col bg-chorusify-bg text-slate-100 overflow-hidden">
      {/* Sticky dark header */}
      <header className="sticky top-0 z-50 border-b border-white/[0.08] bg-chorusify-bg/90 backdrop-blur-md">
        <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 sm:px-6">
          {/* Logo with vinyl disc */}
          <Link
            to="/"
            onClick={handleLogoClick}
            className="flex items-center gap-2.5 font-bold text-white text-xl tracking-tight group"
          >
            <span
              className="relative flex h-8 w-8 items-center justify-center rounded-full overflow-hidden"
              style={{
                boxShadow: '0 0 12px rgba(139, 92, 246, 0.4), 0 0 24px rgba(139, 92, 246, 0.15)',
              }}
            >
              {/* Rotating Vinyl Disc */}
              <span className="w-full h-full rounded-full group-hover:animate-spin-slow transition-transform duration-300">
                <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
                  {/* Outer disc */}
                  <circle
                    cx="16"
                    cy="16"
                    r="15.5"
                    fill="#151515"
                    stroke="#252525"
                    strokeWidth="0.5"
                  />
                  {/* Grooves */}
                  <circle cx="16" cy="16" r="13" fill="none" stroke="#222" strokeWidth="0.3" />
                  <circle cx="16" cy="16" r="11.5" fill="none" stroke="#1c1c1c" strokeWidth="0.3" />
                  <circle cx="16" cy="16" r="10" fill="none" stroke="#222" strokeWidth="0.3" />
                  <circle cx="16" cy="16" r="8.5" fill="none" stroke="#1c1c1c" strokeWidth="0.3" />
                  {/* Purple gradient center label */}
                  <defs>
                    <radialGradient id="logo-center-grad" cx="50%" cy="50%" r="50%">
                      <stop offset="0%" stopColor="#a78bfa" />
                      <stop offset="100%" stopColor="#7c3aed" />
                    </radialGradient>
                  </defs>
                  <circle cx="16" cy="16" r="5.5" fill="url(#logo-center-grad)" />
                  <circle cx="16" cy="16" r="5.5" fill="none" stroke="#111" strokeWidth="0.5" />
                  {/* Spindle hole */}
                  <circle cx="16" cy="16" r="1.2" fill="#000" />
                </svg>
              </span>

              {/* Stationary Sheen / Gloss Overlay */}
              <span className="absolute inset-0 rounded-full overflow-hidden pointer-events-none">
                <svg viewBox="0 0 32 32" className="h-full w-full" aria-hidden="true">
                  <defs>
                    <linearGradient id="sheen-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="rgba(255, 255, 255, 0.15)" />
                      <stop offset="35%" stopColor="rgba(255, 255, 255, 0)" />
                      <stop offset="50%" stopColor="rgba(255, 255, 255, 0.05)" />
                      <stop offset="65%" stopColor="rgba(255, 255, 255, 0)" />
                      <stop offset="100%" stopColor="rgba(255, 255, 255, 0.15)" />
                    </linearGradient>
                  </defs>
                  <circle cx="16" cy="16" r="15.5" fill="url(#sheen-grad)" />
                </svg>
              </span>
            </span>
            <span>Chorusify</span>
          </Link>

          {/* Desktop nav */}
          <div className="hidden items-center gap-7 sm:flex">
            {/* No "play" entry: the home page *is* the mode picker, and the logo already goes
                there. Listing the modes individually ran this bar to eight items. */}
            <NavLink to="/leaderboard">Leaderboard</NavLink>
            <NavLink to="/stats">Stats</NavLink>
            <NavLink to="/fandoms">Fandoms</NavLink>
            <NavLink to="/friends">Friends</NavLink>
            <NavLink to="/about">About</NavLink>

            {!loading && (
              <div className="flex items-center gap-3 pl-3 border-l border-white/10">
                {user ? (
                  <>
                    {user.isAdmin && <NavLink to="/admin">Admin</NavLink>}
                    <Link
                      to="/profile"
                      className="text-sm text-slate-300 font-medium hover:text-white transition-colors duration-200"
                    >
                      {user.displayName}
                    </Link>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="text-sm font-medium text-slate-400 hover:text-white transition-colors duration-200"
                    >
                      Log out
                    </button>
                  </>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="text-sm font-medium text-slate-300 hover:text-white transition-colors duration-200"
                    >
                      Log in
                    </Link>
                    <Link to="/register" className="btn-primary !py-1.5 !px-4 !text-sm">
                      Sign up
                    </Link>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            type="button"
            className="flex sm:hidden flex-col gap-1.5 p-2 text-slate-400 hover:text-white"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Toggle menu"
          >
            <span
              className={`block h-px w-5 bg-current transition-all duration-200 ${menuOpen ? 'translate-y-[7px] rotate-45' : ''}`}
            />
            <span
              className={`block h-px w-5 bg-current transition-all duration-200 ${menuOpen ? 'opacity-0' : ''}`}
            />
            <span
              className={`block h-px w-5 bg-current transition-all duration-200 ${menuOpen ? '-translate-y-[7px] -rotate-45' : ''}`}
            />
          </button>
        </nav>

        {/* Mobile dropdown */}
        {menuOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="glass-2 border-t border-white/[0.06] px-3 pb-4 pt-3 sm:hidden"
          >
            <div className="flex flex-col gap-1">
              {MOBILE_LINKS.map(({ to, label }) => (
                <MobileLink key={to} to={to} label={label} onNavigate={() => setMenuOpen(false)} />
              ))}
              {user?.isAdmin && (
                <MobileLink to="/admin" label="Admin" onNavigate={() => setMenuOpen(false)} />
              )}
            </div>

            <div className="my-3 h-px bg-white/10" />

            {!loading &&
              (user ? (
                <div className="flex items-center justify-between gap-3 rounded-xl bg-white/[0.03] px-3 py-2.5">
                  <Link
                    to="/profile"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-w-0 items-center gap-2.5 hover:opacity-80 transition-opacity"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-chorusify-accent/25 text-sm font-bold text-white">
                      {user.displayName.charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate text-sm font-medium text-slate-200">
                      {user.displayName}
                    </span>
                  </Link>
                  <button
                    type="button"
                    onClick={handleLogout}
                    className="shrink-0 text-sm font-medium text-slate-400 transition-colors hover:text-white"
                  >
                    Log out
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    to="/login"
                    className="btn-secondary flex-1 !py-2 text-center text-sm"
                    onClick={() => setMenuOpen(false)}
                  >
                    Log in
                  </Link>
                  <Link
                    to="/register"
                    className="btn-primary flex-1 !py-2 text-center text-sm"
                    onClick={() => setMenuOpen(false)}
                  >
                    Sign up
                  </Link>
                </div>
              ))}
          </motion.div>
        )}
      </header>

      <main className="flex-1 overflow-y-auto overflow-x-hidden min-w-0">
        <Outlet />
      </main>

      <footer className="shrink-0 border-t border-white/[0.06] py-4">
        <div className="mx-auto flex max-w-6xl flex-col items-center gap-2 px-4 sm:flex-row sm:justify-between sm:px-6">
          <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-slate-500 sm:justify-start">
            <span>&copy; {new Date().getFullYear()} Chorusify</span>
            <Link to="/privacy" className="hover:text-slate-300">
              Privacy
            </Link>
            <Link to="/terms" className="hover:text-slate-300">
              Terms
            </Link>
            <Link to="/cookies" className="hover:text-slate-300">
              Cookies
            </Link>
          </div>
          {/* Deezer attribution - required by Deezer API brand guidelines */}
          <a
            href="https://www.deezer.com"
            target="_blank"
            rel="noopener noreferrer"
            className="transition-opacity hover:opacity-80"
          >
            <img
              src="/Horizontal - Signatures-PoweredBy-EN.png"
              alt="Powered by Deezer"
              className="h-5 w-auto"
            />
          </a>
        </div>
      </footer>
    </div>
  );
}
