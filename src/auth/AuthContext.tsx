import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadAuth, type AuthState } from './identity';
import { IS_PREVIEW } from '../lib/preview';

type Ctx = { auth: AuthState | null; refresh: () => void };

const AuthCtx = createContext<Ctx>({ auth: null, refresh: () => undefined });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(null);
  const refresh = () => (IS_PREVIEW ? setAuth({ kind: 'unavailable' }) : void loadAuth().then(setAuth));

  useEffect(() => {
    refresh();
    window.addEventListener('online', refresh);
    return () => window.removeEventListener('online', refresh);
  }, []);

  return <AuthCtx.Provider value={{ auth, refresh }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): Ctx {
  return useContext(AuthCtx);
}
