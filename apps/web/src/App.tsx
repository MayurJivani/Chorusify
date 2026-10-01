import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { SessionProvider } from './hooks/useSession';
import { GameConfigProvider } from './hooks/useGameConfig';
import { RootLayout } from './routes/RootLayout';
import { HomePage } from './routes/HomePage';
import { PlayPage } from './routes/PlayPage';
import { StatsPage } from './routes/StatsPage';
import { LeaderboardPage } from './routes/LeaderboardPage';
import { LoginPage } from './routes/LoginPage';
import { RegisterPage } from './routes/RegisterPage';
import { AboutPage } from './routes/AboutPage';
import { PrivacyPage } from './routes/PrivacyPage';
import { TermsPage } from './routes/TermsPage';
import { CookiePolicyPage } from './routes/CookiePolicyPage';
import { ArtistSearchPage } from './routes/ArtistSearchPage';
import { ArtistPlayPage } from './routes/ArtistPlayPage';
import { CategoryPickerPage } from './routes/CategoryPickerPage';
import { SoundtrackPickerPage } from './routes/SoundtrackPickerPage';
import { CategoryPlayPage } from './routes/CategoryPlayPage';
import { SurvivalPage } from './routes/SurvivalPage';
import { EraPlayPage } from './routes/EraPlayPage';
import { DuelsPage } from './routes/DuelsPage';
import { AdminPage } from './routes/AdminPage';
import { NotFoundPage } from './routes/NotFoundPage';
import { MultiplayerHomePage } from './routes/MultiplayerHomePage';
import { MultiplayerRoomPage } from './routes/MultiplayerRoomPage';
import { FriendsPage } from './routes/FriendsPage';
import { ForgotPasswordPage } from './routes/ForgotPasswordPage';
import { ProfilePage } from './routes/ProfilePage';
import { FandomsPage } from './routes/FandomsPage';
import { FandomDetailPage } from './routes/FandomDetailPage';
import { ToastProvider } from './hooks/useToast';
import { KonamiVinylPlayer } from './features/easter-eggs/KonamiVinylPlayer';
import { SecretDJMode } from './features/easter-eggs/SecretDJMode';

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
  return (
    <SessionProvider>
      <GameConfigProvider>
        <ToastProvider>
          <KonamiVinylPlayer />
          <SecretDJMode />
          <RouterProvider router={router} />
        </ToastProvider>
      </GameConfigProvider>
    </SessionProvider>
  );
}

export default App;
