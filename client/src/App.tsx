import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./hooks/auth/useAuth";
import { RequireAuth } from "./components/auth/RequireAuth";
import { LandingPage } from "./components/auth/LandingPage";
import { LoadingScreen } from "./components/ui/LoadingScreen";
import { AppShell } from "./components/app/AppShell";
import { ChatView } from "./components/chat/ChatView";

/** Landing route: send authenticated users straight to the app. */
function LandingRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen />;
  if (user) return <Navigate to="/chat" replace />;
  return <LandingPage />;
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<LandingRoute />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route path="/chat/:conversationId?" element={<ChatView />} />
        </Route>
      </Route>
      {/* Where the upload, history and job pages used to live. */}
      <Route path="/app" element={<Navigate to="/chat" replace />} />
      <Route path="/history" element={<Navigate to="/chat" replace />} />
      <Route path="/jobs/:uploadId" element={<Navigate to="/chat" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default App;
