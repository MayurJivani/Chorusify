import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useSession } from '../hooks/useSession';
import { OverviewPanel } from '../features/admin/OverviewPanel';
import { SettingsPanel } from '../features/admin/SettingsPanel';
import { SchedulePanel } from '../features/admin/SchedulePanel';
import { UsersPanel } from '../features/admin/UsersPanel';
import { MultiplayerPanel } from '../features/admin/MultiplayerPanel';
import { SongsPanel } from '../features/admin/SongsPanel';
import { CardsPanel } from '../features/admin/CardsPanel';
import { PoolsPanel } from '../features/admin/PoolsPanel';
import { ActivityPanel } from '../features/admin/ActivityPanel';
import { EventHostsPanel } from '../features/admin/EventHostsPanel';
import { usePageTitle } from '../hooks/usePageTitle';
import { VinylSpinner } from '../features/easter-eggs/VinylSpinner';

type Tab =
  | 'overview'
  | 'activity'
  | 'settings'
  | 'schedule'
  | 'users'
  | 'hosts'
  | 'multiplayer'
  | 'songs'
  | 'pools'
  | 'cards';

const TABS: [Tab, string][] = [
  ['overview', 'Overview'],
  ['activity', 'Activity'],
  ['settings', 'Game settings'],
  ['schedule', 'Daily schedule'],
  ['users', 'Users'],
  ['hosts', 'Event hosts'],
  ['multiplayer', 'Multiplayer'],
  ['songs', 'Song bank'],
  ['pools', 'Categories'],
  ['cards', 'Cards'],
];

/**
 * The admin command centre.
 *
 * Access is decided by the server, not by this page: every panel's first request either returns
 * data or 404s, and a non-admin sees the same "not available" as someone hitting a route that
 * doesn't exist. Hiding the nav link is cosmetic.
 */
export function AdminPage() {
  usePageTitle('Admin');
  const { user, loading } = useSession();
  const [tab, setTab] = useState<Tab>('overview');

  if (loading)
    return (
      <Centered>
        <VinylSpinner />
      </Centered>
    );

  if (!user) {
    return (
      <Centered>
        <p className="text-slate-300">You need to be logged in to use the admin tools.</p>
        <Link to="/login" className="btn-primary mt-4">
          Log in
        </Link>
      </Centered>
    );
  }

  if (!user.isAdmin) {
    return <Centered>This page isn’t available for your account.</Centered>;
  }

  return (
    <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col gap-6 px-4 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Command Center</h1>
        <p className="text-sm text-slate-400">
          Signed in as {user.displayName}. All dates are UTC.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Admin sections"
        className="flex flex-wrap gap-1.5 rounded-xl border border-white/5 bg-chorusify-bg/80 p-1.5"
      >
        {TABS.map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={tab === value}
            onClick={() => setTab(value)}
            className={
              'rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ' +
              (tab === value
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewPanel />}
      {tab === 'settings' && <SettingsPanel />}
      {tab === 'schedule' && <SchedulePanel />}
      {tab === 'users' && <UsersPanel />}
      {tab === 'hosts' && <EventHostsPanel />}
      {tab === 'multiplayer' && <MultiplayerPanel />}
      {tab === 'songs' && <SongsPanel />}
      {tab === 'activity' && <ActivityPanel />}
      {tab === 'pools' && <PoolsPanel />}
      {tab === 'cards' && <CardsPanel />}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center px-4 py-10 text-center text-slate-400">
      {children}
    </div>
  );
}
