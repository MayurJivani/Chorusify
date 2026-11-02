import { lazy, type ComponentType } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'motion/react';
import { SessionProvider } from './hooks/useSession';
import { GameConfigProvider } from './hooks/useGameConfig';
import { RootLayout } from './routes/RootLayout';
import { HomePage } from './routes/HomePage';
import { ToastProvider } from './hooks/useToast';
import { KonamiVinylPlayer } from './features/easter-eggs/KonamiVinylPlayer';
import { SecretDJMode } from './features/easter-eggs/SecretDJMode';

/**
 * A tab left open across a deploy asks for chunk names that no longer exist. One reload picks up the
 * new build; the flag stops a genuinely broken build reloading forever.
 */
function page<K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) {
  return lazy(async () => {
    try {
      const module = await load();
      sessionStorage.removeItem('chunk-reload');
      return { default: module[name] };
    } catch (err) {
      if (sessionStorage.getItem('chunk-reload')) throw err;
      sessionStorage.setItem('chunk-reload', '1');
      window.location.reload();
      return new Promise<never>(() => undefined);
    }
  });
}

// Every route but the home page loads on demand: someone scanning a QR code at an event should
// not download the admin console to answer a music question.
const PlayPage = page(() => import('./routes/PlayPage'), 'PlayPage');
const StatsPage = page(() => import('./routes/StatsPage'), 'StatsPage');
const LeaderboardPage = page(() => import('./routes/LeaderboardPage'), 'LeaderboardPage');
const LoginPage = page(() => import('./routes/LoginPage'), 'LoginPage');
const RegisterPage = page(() => import('./routes/RegisterPage'), 'RegisterPage');
const AboutPage = page(() => import('./routes/AboutPage'), 'AboutPage');
const PrivacyPage = page(() => import('./routes/PrivacyPage'), 'PrivacyPage');
const TermsPage = page(() => import('./routes/TermsPage'), 'TermsPage');
const CookiePolicyPage = page(() => import('./routes/CookiePolicyPage'), 'CookiePolicyPage');
const ArtistSearchPage = page(() => import('./routes/ArtistSearchPage'), 'ArtistSearchPage');
const ArtistPlayPage = page(() => import('./routes/ArtistPlayPage'), 'ArtistPlayPage');
const CategoryPickerPage = page(() => import('./routes/CategoryPickerPage'), 'CategoryPickerPage');
const SoundtrackPickerPage = page(
  () => import('./routes/SoundtrackPickerPage'),
  'SoundtrackPickerPage',
);
const CategoryPlayPage = page(() => import('./routes/CategoryPlayPage'), 'CategoryPlayPage');
const SurvivalPage = page(() => import('./routes/SurvivalPage'), 'SurvivalPage');
const EraPlayPage = page(() => import('./routes/EraPlayPage'), 'EraPlayPage');
const DuelsPage = page(() => import('./routes/DuelsPage'), 'DuelsPage');
const AdminPage = page(() => import('./routes/AdminPage'), 'AdminPage');
const NotFoundPage = page(() => import('./routes/NotFoundPage'), 'NotFoundPage');
const MultiplayerHomePage = page(
  () => import('./routes/MultiplayerHomePage'),
  'MultiplayerHomePage',
);
const MultiplayerRoomPage = page(
  () => import('./routes/MultiplayerRoomPage'),
  'MultiplayerRoomPage',
);
const FriendsPage = page(() => import('./routes/FriendsPage'), 'FriendsPage');
const ForgotPasswordPage = page(() => import('./routes/ForgotPasswordPage'), 'ForgotPasswordPage');
const ProfilePage = page(() => import('./routes/ProfilePage'), 'ProfilePage');
const FandomsPage = page(() => import('./routes/FandomsPage'), 'FandomsPage');
const FandomDetailPage = page(() => import('./routes/FandomDetailPage'), 'FandomDetailPage');
const EventsPage = page(() => import('./routes/EventsPage'), 'EventsPage');
const EventConsolePage = page(() => import('./routes/EventConsolePage'), 'EventConsolePage');

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/play', element: <PlayPage /> },
      { path: '/desi', element: <PlayPage /> },
      { path: '/stats', element: <StatsPage /> },
      { path: '/leaderboard', element: <LeaderboardPage /> },
      { path: '/login', element: <LoginPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/about', element: <AboutPage /> },
      { path: '/privacy', element: <PrivacyPage /> },
      { path: '/terms', element: <TermsPage /> },
      { path: '/cookies', element: <CookiePolicyPage /> },
      { path: '/artist', element: <ArtistSearchPage /> },
      { path: '/artist/:artistId/play', element: <ArtistPlayPage /> },
      { path: '/categories', element: <CategoryPickerPage /> },
      { path: '/soundtracks', element: <SoundtrackPickerPage /> },
      { path: '/category/:categoryId/play', element: <CategoryPlayPage /> },
      { path: '/survival', element: <SurvivalPage /> },
      { path: '/era', element: <EraPlayPage /> },
      { path: '/duels', element: <DuelsPage /> },
      { path: '/admin', element: <AdminPage /> },
      { path: '/events', element: <EventsPage /> },
      { path: '/events/:id/live', element: <EventConsolePage /> },
      { path: '/multiplayer', element: <MultiplayerHomePage /> },
      { path: '/room/:code', element: <MultiplayerRoomPage /> },
      { path: '/fandoms', element: <FandomsPage /> },
      { path: '/fandom/:deezerArtistId', element: <FandomDetailPage /> },
      { path: '/friends', element: <FriendsPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/profile', element: <ProfilePage /> },
      // Catch-all. Inside RootLayout so a mistyped URL still gets the nav and a way back,
      // rather than react-router's bare default error screen.
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

function App() {
  // Honours prefers-reduced-motion across every framer-motion animation in the app. A handful of
  // components check `useReducedMotion()` themselves where they need a different still frame;
  // this covers the rest without each one having to remember.
  return (
    <MotionConfig reducedMotion="user">
      <SessionProvider>
        <GameConfigProvider>
          <ToastProvider>
            <KonamiVinylPlayer />
            <SecretDJMode />
            <RouterProvider router={router} />
          </ToastProvider>
        </GameConfigProvider>
      </SessionProvider>
    </MotionConfig>
  );
}

export default App;
