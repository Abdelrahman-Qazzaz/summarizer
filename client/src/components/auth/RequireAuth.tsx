import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../hooks/auth/useAuth";
import { LoadingScreen } from "../layout/LoadingScreen";

/** Route guard for authenticated pages. Redirects to the landing page when logged out. */
export function RequireAuth() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;
  if (!user) return <Navigate to="/" replace />;
  return <Outlet />;
}
