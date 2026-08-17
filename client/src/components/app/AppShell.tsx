import { useMemo, useState } from "react";
import { Outlet } from "react-router-dom";
import { useAuth } from "../../hooks/auth/useAuth";
import { useJobUpdatesBridge } from "../../hooks/socket/useJobUpdatesBridge";
import { SourcesProvider } from "../../sources/SourcesProvider";
import { SourcesDrawer } from "../sources/SourcesDrawer";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { ShellContext } from "./shellContext";

/**
 * The whole app is one screen: chats on the left, the conversation in the
 * middle, the sources library sliding in from the right. Nothing here scrolls
 * but the message list and the two panels.
 */
export function AppShell() {
  const { user } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sourcesOpen, setSourcesOpen] = useState(false);

  // One subscription for the whole app: transcript progress refreshes the job
  // caches the composer chips and the drawer both read.
  useJobUpdatesBridge(!!user);

  const shell = useMemo(
    () => ({ sidebarOpen, setSidebarOpen, sourcesOpen, setSourcesOpen }),
    [sidebarOpen, sourcesOpen],
  );

  return (
    <ShellContext.Provider value={shell}>
      <SourcesProvider>
        <div className="flex h-dvh overflow-hidden">
          <Sidebar />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            <Outlet />
          </div>
          {sourcesOpen && <SourcesDrawer />}
        </div>
      </SourcesProvider>
    </ShellContext.Provider>
  );
}
