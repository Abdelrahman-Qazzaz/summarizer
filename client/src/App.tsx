import { useAuth } from "./hooks/auth/useAuth";
import { SummarizerUploadProvider } from "./hooks/useSummarizerUpload";
import { LandingPage } from "./components/pages/LandingPage";
import { Dashboard } from "./components/pages/Dashboard";

function AppContent() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-primary-50 via-white to-primary-100 dark:from-gray-950 dark:via-gray-900 dark:to-primary-950">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-4 border-primary-200 dark:border-primary-800 border-t-primary-600 dark:border-t-primary-400 animate-spin" />
          <p className="text-sm text-gray-500 dark:text-gray-400 font-medium">Loading...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <LandingPage />;
  }

  return (
    <SummarizerUploadProvider>
      <Dashboard />
    </SummarizerUploadProvider>
  );
}

function App() {
  return <AppContent />;
}

export default App;
