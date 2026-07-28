// Access token lives in memory only (never localStorage) — persistence across
// reloads comes from the httpOnly REFRESH_TOKEN cookie via silent refresh on
// boot. This is the standard SPA-with-refresh-cookie pattern.
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import * as api from "@/lib/api";
import type { User } from "@/lib/api";
import { setNtAccessToken, setNtReauthorize } from "@/lib/mtApi";
import { setCacheScope } from "@/lib/cache";

interface AuthState {
  user: User | null;
  accessToken: string | null;
  booting: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (input: {
    username: string;
    nickname: string;
    password: string;
    email: string;
    emailCode: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);

  // Keep the nt API client's in-memory token in lockstep with our state, so
  // components can just call the typed API functions without threading a token.
  useEffect(() => {
    setNtAccessToken(accessToken);
  }, [accessToken]);

  // Point the read-cache at the signed-in user. A different user (or sign-out)
  // clears the cache so no account ever paints another's data; the same user
  // across a reload keeps it. `undefined` during boot (before restore) leaves the
  // disk cache in place, which is what lets a reload paint from it.
  useEffect(() => {
    if (user) setCacheScope(user.id);
  }, [user]);

  // On a 401 from the nt backend, silently refresh through the httpOnly cookie
  // and hand the fresh token back for a one-shot retry.
  useEffect(() => {
    setNtReauthorize(async () => {
      try {
        const { user, accessToken } = await api.refreshToken();
        setUser(user);
        setAccessToken(accessToken);
        return accessToken;
      } catch {
        setUser(null);
        setAccessToken(null);
        setCacheScope(null);
        return null;
      }
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Restore the session from the refresh cookie on boot. A 401 means there is
    // genuinely no valid cookie (not signed in) — accept it. But a *transient*
    // failure (network blip, 5xx from the proxy) must NOT drop a signed-in user
    // to the login screen, so retry those a couple times before giving up. This
    // is what made a plain reload occasionally bounce you to /login.
    const boot = async () => {
      for (let attempt = 0; !cancelled; attempt++) {
        try {
          const { user, accessToken } = await api.refreshToken();
          if (!cancelled) {
            setUser(user);
            setAccessToken(accessToken);
          }
          return;
        } catch (err) {
          const status = err instanceof api.ApiError ? err.status : 0;
          const transient = status === 0 || status >= 500;
          if (!transient || attempt >= 2) return; // real "not signed in"
          await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        }
      }
    };
    void boot().finally(() => {
      if (!cancelled) setBooting(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const { user, accessToken } = await api.login(username, password);
    setUser(user);
    setAccessToken(accessToken);
  }, []);

  const register = useCallback(
    async (input: {
      username: string;
      nickname: string;
      password: string;
      email: string;
      emailCode: string;
    }) => {
      const { user, accessToken } = await api.register(input);
      setUser(user);
      setAccessToken(accessToken);
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setAccessToken(null);
    setCacheScope(null); // drop this user's cached reads
  }, []);

  const refreshMe = useCallback(async () => {
    if (!accessToken) return;
    const { user } = await api.getMe(accessToken);
    setUser(user);
  }, [accessToken]);

  return (
    <AuthContext
      value={{ user, accessToken, booting, login, register, logout, refreshMe }}
    >
      {children}
    </AuthContext>
  );
}

export function useAuth(): AuthState {
  const ctx = use(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
