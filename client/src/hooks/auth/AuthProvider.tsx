import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { authLogoutEndpoint, authMeEndpoint } from "../../config";
import {
  onSessionChange,
  parseSession,
  refreshSession,
  type Session,
} from "../../api/session";
import { AuthContext } from "./context";

/**
 * How long before the access token expires it's refreshed, so requests don't
 * find it expired. A request that still does, after the tab slept through
 * the timer for instance, refreshes on its 401 instead.
 */
const REFRESH_AHEAD_MS = 60_000;

async function fetchSession(): Promise<Session | null> {
  const res = await fetch(authMeEndpoint(), { credentials: "include" });
  // The access token has usually expired since the last visit.
  if (res.status === 401) return refreshSession();
  if (!res.ok) throw new Error("Failed to load session");
  return parseSession(await res.json());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSession(await fetchSession());
    } catch {
      setSession(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch(authLogoutEndpoint(), {
      method: "POST",
      credentials: "include",
    });
    setSession(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // A refresh started anywhere, by a request's 401 or the timer below,
  // moves the session on, or ends it.
  useEffect(() => onSessionChange(setSession), []);

  useEffect(() => {
    if (!session) return;
    const timer = setTimeout(
      () => {
        // A failure leaves the next request's 401 to refresh.
        refreshSession().catch(() => undefined);
      },
      Math.max(0, session.expiresAt - Date.now() - REFRESH_AHEAD_MS),
    );
    return () => clearTimeout(timer);
  }, [session]);

  // Only a different user is a new user: a refresh keeps the same object.
  const userId = session?.userId;
  const user = useMemo(() => (userId ? { userId } : null), [userId]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
