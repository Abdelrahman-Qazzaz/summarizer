import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/auth/useAuth";
import { RequireAuth } from "./components/auth/RequireAuth";
import { AppLayout } from "./components/layout/AppLayout";
import { LoadingScreen } from "./components/layout/LoadingScreen";
import { LandingPage } from "./components/pages/LandingPage";
import { NewUploadPage } from "./components/pages/NewUploadPage";
import { HistoryPage } from "./components/pages/HistoryPage";
import { JobDetailPage } from "./components/pages/JobDetailPage";

/** Landing route: send authenticated users straight to the app. */
function LandingRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/app" replace />;
  return <LandingPage />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route path="/app" element={<NewUploadPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/jobs/:uploadId" element={<JobDetailPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
