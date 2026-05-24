import { useCallback, useEffect, useState, type ReactNode } from "react";
import { authLogoutEndpoint, authMeEndpoint } from "../../config";
import { AuthContext, type AuthUser } from "./context";

async function fetchSession(): Promise<AuthUser | null> {
  const res = await fetch(authMeEndpoint(), { credentials: "include" });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error("Failed to load session");
  const data: unknown = await res.json();
  if (
    data &&
    typeof data === "object" &&
    "userId" in data &&
    typeof (data as { userId: unknown }).userId === "string"
  ) {
    return { userId: (data as { userId: string }).userId };
  }
  throw new Error("Invalid session response");
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setUser(await fetchSession());
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const signOut = useCallback(async () => {
    await fetch(authLogoutEndpoint(), {
      method: "POST",
      credentials: "include",
    });
    setUser(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <AuthContext.Provider value={{ user, loading, refresh, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}
