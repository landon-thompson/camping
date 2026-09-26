import { useEffect } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth/AuthContext';
import { isFamily, loginUrl, logoutUrl, forgetUser } from './auth/identity';
import { Layout } from './components/Layout';
import { LinkButton } from './components/ui';
import { Dashboard } from './pages/Dashboard';
import { Placeholder } from './pages/Placeholder';
import { Settings } from './pages/Settings';
import { startSync } from './sync/useSync';

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Gate />
      </BrowserRouter>
    </AuthProvider>
  );
}

function Gate() {
  const { auth } = useAuth();
  const canSync = auth?.kind === 'unavailable' || (auth?.kind === 'signed-in' && isFamily(auth.user));

  useEffect(() => {
    if (canSync) startSync();
  }, [canSync]);

  if (!auth) return <Splash />;
  if (auth.kind === 'signed-out' && !auth.previousUser) return <SignIn />;
  if (auth.kind === 'signed-in' && !auth.offline && !isFamily(auth.user)) return <NotInvited email={auth.user.userDetails} />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route
          path="gear"
          element={
            <Placeholder
              title="Gear"
              phase="Phase 1"
              items={[
                'Everything we own or plan to buy, with priority, status, cost, weight and power draw',
                'Where it rides: roof / cargo / cab / boat / trailer',
                'Budget totals by category and a “buy next” list',
                'Load & tow and power calculators',
              ]}
            />
          }
        />
        <Route
          path="trips"
          element={
            <Placeholder
              title="Trips"
              phase="Phase 2"
              items={['All five 2027 trips on one map', 'Trip pages with dates, site, launch, checklist and notes', 'Readiness score and read-only share link']}
            />
          }
        />
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
