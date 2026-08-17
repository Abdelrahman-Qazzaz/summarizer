import { authLoginUrl } from "../../config";
import { useTheme } from "../../hooks/theme/useTheme";
import { Icon } from "../ui/Icon";
import { Meter } from "../ui/Meter";

/**
 * The hero is the thing this app actually does that others don't: one message
 * carrying several recordings. So the hero *is* the composer, mid-transcription.
 */
function ComposerPreview() {
  return (
    <div
      aria-hidden="true"
      className="w-full max-w-[34rem] rounded-2xl border border-line bg-surface p-3 shadow-sm"
    >
      <ul className="mb-3 flex flex-wrap gap-2">
        <li className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2">
          <Meter state="live" />
          <span>
            <span className="block font-mono text-[11px]">
              board-call-oct.m4a
            </span>
            <span className="block text-[11px] text-faint">transcribing</span>
          </span>
        </li>
        <li className="flex items-center gap-2.5 rounded-lg border border-line px-2.5 py-2">
          <Meter state="ready" />
          <span>
            <span className="block font-mono text-[11px]">
              youtube/q1-briefing
            </span>
            <span className="block text-[11px] text-faint">
              ready · 41,208 chars
            </span>
          </span>
        </li>
      </ul>

      <p className="px-1 pb-3 text-[15px] text-muted">
        Where do these two disagree?
      </p>

      <div className="flex items-center gap-2 px-1">
        <Icon name="plus" className="h-5 w-5 text-faint" />
        <span className="font-mono text-[11px] text-faint">
          anthropic/claude-sonnet-5
        </span>
        <span className="flex-1" />
        <span className="rounded-full bg-line p-2 text-faint">
          <Icon name="send" className="h-4 w-4" />
        </span>
      </div>
    </div>
  );
}

export function LandingPage() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex h-14 shrink-0 items-center justify-between px-5">
        <span className="eyebrow text-ink">Summarizer</span>
        <button
          type="button"
          onClick={toggleTheme}
          aria-label={
            theme === "dark" ? "Switch to light mode" : "Switch to dark mode"
          }
          className="rounded-lg p-2 text-muted transition-colors hover:bg-sunk hover:text-ink"
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} className="h-4 w-4" />
        </button>
      </header>

      <main className="flex flex-1 flex-col items-center justify-center gap-10 px-5 py-14 text-center">
        <div className="max-w-xl">
          <h1 className="text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
            Several recordings.
            <br />
            <span className="text-signal-strong dark:text-signal">
              One question.
            </span>
          </h1>
          <p className="mx-auto mt-5 max-w-md text-[15px] leading-relaxed text-muted">
            Drop audio, video or a YouTube link. Each becomes a transcript, and
            one message carries as many as the question needs.
          </p>
          <a
            href={authLoginUrl()}
            className="mt-8 inline-flex items-center rounded-lg bg-signal px-5 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Sign in
          </a>
        </div>

        <ComposerPreview />
      </main>
    </div>
  );
}
