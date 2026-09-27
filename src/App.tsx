import { useEffect } from 'react';
import { BrowserRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { isFamily, loginUrl, logoutUrl, forgetUser } from './auth/identity';
import { Layout } from './components/Layout';
import { LinkButton } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Settings } from './pages/Settings';
import { startSync, syncEngine } from './sync/useSync';
import { gearRoutes } from './features/gear/routes';
import { tripRoutes } from './features/trips/routes';
import { reservationRoutes } from './features/reservations/routes';
import { trailRoutes } from './features/trails/routes';
import { journalRoutes } from './features/journal/routes';
import { SharePage } from './features/trips/SharePage';
import { IS_PREVIEW } from './lib/preview';

// The preview is embedded in a page whose URL we don't control.
const Router = IS_PREVIEW ? MemoryRouter : BrowserRouter;

export function App() {
  return (
    <AuthProvider>
      <Router>
        <PublicOrGate />
      </Router>
    </AuthProvider>
  );
}

/** Read-only trip links (/s/:token) are public; everything else needs sign-in. */
function PublicOrGate() {
  const { pathname } = useLocation();
  if (pathname.startsWith('/s/')) {
    return (
      <Routes>
        <Route path="/s/:token" element={<SharePage />} />
      </Routes>
    );
  }
  return <Gate />;
}

function Gate() {
  const { auth } = useAuth();
  const canSync = auth?.kind === 'unavailable' || (auth?.kind === 'signed-in' && isFamily(auth.user));

  const expired = auth?.kind === 'signed-out' && !!auth.previousUser;
  useEffect(() => {
    if (canSync) startSync();
    // Still usable on this phone, but the pill should say "Sign in", not "Starting…".
    else if (expired) syncEngine.setSignedOut();
  }, [canSync, expired]);

  if (!auth) return <Splash />;
  if (auth.kind === 'signed-out' && !auth.previousUser) return <SignIn />;
  if (auth.kind === 'signed-in' && !auth.offline && !isFamily(auth.user)) return <NotInvited email={auth.user.userDetails} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        {gearRoutes}
        {tripRoutes}
        {reservationRoutes}
        {trailRoutes}
        {journalRoutes}
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Dashboard />} />
      </Route>
    </Routes>
  );
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center text-ink-2" aria-busy="true">
      Loading…
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="safe-top mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="text-3xl font-bold text-brand">Camp Planner</h1>
      {children}
    </div>
  );
}

function SignIn() {
  return (
    <Shell>
      <p className="text-lg text-ink-2">Family trip planning for the 2027 season. Sign in with your Microsoft account.</p>
      <LinkButton href={loginUrl()}>Sign in with Microsoft</LinkButton>
    </Shell>
  );
}

function NotInvited({ email }: { email: string }) {
  return (
    <Shell>
      <p className="text-lg">
        You’re signed in as <strong>{email}</strong>, but this account hasn’t been invited.
      </p>
      <p className="text-ink-2">
        Ask the app owner to send a family invitation (Azure portal → Static Web App → Role management → Invite), then open
        the invitation link on this phone.
      </p>
      <a href={logoutUrl()} onClick={() => forgetUser()} className="min-h-12 content-center font-semibold text-brand">
        Sign out
      </a>
    </Shell>
  );
}
