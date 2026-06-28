import { NavLink, Outlet } from "react-router-dom";
import { Container } from "./Container";
import { Logo } from "./Logo";
import { ThemeToggle } from "./ThemeToggle";
import { UserMenu } from "../auth/UserMenu";
import { useAuth } from "../../hooks/auth/useAuth";
import { useJobUpdatesBridge } from "../../hooks/socket/useJobUpdatesBridge";
import { UploadQueueProvider } from "../../hooks/upload/UploadQueueProvider";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? "bg-primary-100 dark:bg-primary-900/50 text-primary-700 dark:text-primary-300"
      : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-800"
  }`;

export function AppLayout() {
  const { user } = useAuth();
  // Single global subscription: keep all query caches fresh + surface toasts.
  useJobUpdatesBridge(!!user);

  return (
    <UploadQueueProvider>
      <div className="flex-1 flex flex-col bg-gradient-to-br from-gray-50 via-white to-primary-50/30 dark:from-gray-950 dark:via-gray-900 dark:to-primary-950/30">
        <header className="border-b border-gray-200 dark:border-gray-800 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm sticky top-0 z-40">
          <Container className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <NavLink to="/app" className="flex items-center gap-3">
                <Logo />
                <span className="hidden sm:inline text-lg font-semibold text-gray-900 dark:text-white">
                  Summarizer
                </span>
              </NavLink>
              <nav className="flex items-center gap-1">
                <NavLink to="/app" className={navLinkClass}>
                  New
                </NavLink>
                <NavLink to="/history" className={navLinkClass}>
                  History
                </NavLink>
              </nav>
            </div>
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu />
            </div>
          </Container>
        </header>

        <main className="flex-1 py-8 sm:py-12">
          <Container>
            <Outlet />
          </Container>
        </main>
      </div>
    </UploadQueueProvider>
  );
}
