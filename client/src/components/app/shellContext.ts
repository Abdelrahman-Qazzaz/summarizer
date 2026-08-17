import { createContext, useContext } from "react";

/**
 * A source opened for reading. Transcripts are fetched by id; images already
 * have a URL by the time they can be opened, so they carry it.
 */
export type OpenSource =
  | {
      kind: "transcript";
      uploadId: string;
      fileName: string;
      title?: string | null;
    }
  | { kind: "image"; url: string; fileName: string };

export type ShellContextValue = {
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  sourcesOpen: boolean;
  setSourcesOpen: (open: boolean) => void;
  /** Held here so a chip, a sent turn and the drawer all raise the same window. */
  openSource: OpenSource | null;
  setOpenSource: (source: OpenSource | null) => void;
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
