import { createContext, useContext } from "react";

export type ShellContextValue = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sourcesOpen: boolean;
  setSourcesOpen: (open: boolean) => void;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

/** Chrome the composer also drives — it opens the sources drawer from `+`. */
export function useShell(): ShellContextValue {
  const context = useContext(ShellContext);
  if (context === null) {
    throw new Error("useShell must be used within AppShell");
  }
  return context;
}
