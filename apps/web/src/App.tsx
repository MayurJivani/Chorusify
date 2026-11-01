import { lazy } from 'react';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { MotionConfig } from 'framer-motion';
import { SessionProvider } from './hooks/useSession';
import { GameConfigProvider } from './hooks/useGameConfig';
import { RootLayout } from './routes/RootLayout';
import { HomePage } from './routes/HomePage';
import { ToastProvider } from './hooks/useToast';
import { KonamiVinylPlayer } from './features/easter-eggs/KonamiVinylPlayer';
import { SecretDJMode } from './features/easter-eggs/SecretDJMode';

// Every route but the home page loads on demand: someone scanning a QR code at an event should
// not download the admin console to answer a music question.
const PlayPage = lazy(() => import('./routes/PlayPage').then((m) => ({ default: m.PlayPage })));
const StatsPage = lazy(() => import('./routes/StatsPage').then((m) => ({ default: m.StatsPage })));
const LeaderboardPage = lazy(() => import('./routes/LeaderboardPage').then((m) => ({ default: m.LeaderboardPage })));
const LoginPage = lazy(() => import('./routes/LoginPage').then((m) => ({ default: m.LoginPage })));
const RegisterPage = lazy(() => import('./routes/RegisterPage').then((m) => ({ default: m.RegisterPage })));
const AboutPage = lazy(() => import('./routes/AboutPage').then((m) => ({ default: m.AboutPage })));
const PrivacyPage = lazy(() => import('./routes/PrivacyPage').then((m) => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./routes/TermsPage').then((m) => ({ default: m.TermsPage })));
const CookiePolicyPage = lazy(() => import('./routes/CookiePolicyPage').then((m) => ({ default: m.CookiePolicyPage })));
const ArtistSearchPage = lazy(() => import('./routes/ArtistSearchPage').then((m) => ({ default: m.ArtistSearchPage })));
const ArtistPlayPage = lazy(() => import('./routes/ArtistPlayPage').then((m) => ({ default: m.ArtistPlayPage })));
const CategoryPickerPage = lazy(() => import('./routes/CategoryPickerPage').then((m) => ({ default: m.CategoryPickerPage })));
const SoundtrackPickerPage = lazy(() => import('./routes/SoundtrackPickerPage').then((m) => ({ default: m.SoundtrackPickerPage })));
const CategoryPlayPage = lazy(() => import('./routes/CategoryPlayPage').then((m) => ({ default: m.CategoryPlayPage })));
const SurvivalPage = lazy(() => import('./routes/SurvivalPage').then((m) => ({ default: m.SurvivalPage })));
const EraPlayPage = lazy(() => import('./routes/EraPlayPage').then((m) => ({ default: m.EraPlayPage })));
const DuelsPage = lazy(() => import('./routes/DuelsPage').then((m) => ({ default: m.DuelsPage })));
const AdminPage = lazy(() => import('./routes/AdminPage').then((m) => ({ default: m.AdminPage })));
const NotFoundPage = lazy(() => import('./routes/NotFoundPage').then((m) => ({ default: m.NotFoundPage })));
const MultiplayerHomePage = lazy(() => import('./routes/MultiplayerHomePage').then((m) => ({ default: m.MultiplayerHomePage })));
const MultiplayerRoomPage = lazy(() => import('./routes/MultiplayerRoomPage').then((m) => ({ default: m.MultiplayerRoomPage })));
const FriendsPage = lazy(() => import('./routes/FriendsPage').then((m) => ({ default: m.FriendsPage })));
const ForgotPasswordPage = lazy(() => import('./routes/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })));
const ProfilePage = lazy(() => import('./routes/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const FandomsPage = lazy(() => import('./routes/FandomsPage').then((m) => ({ default: m.FandomsPage })));
const FandomDetailPage = lazy(() => import('./routes/FandomDetailPage').then((m) => ({ default: m.FandomDetailPage })));
const EventsPage = lazy(() => import('./routes/EventsPage').then((m) => ({ default: m.EventsPage })));
const EventConsolePage = lazy(() =>
  import('./routes/EventConsolePage').then((m) => ({ default: m.EventConsolePage })),
);

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/play', element: <PlayPage /> },
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
