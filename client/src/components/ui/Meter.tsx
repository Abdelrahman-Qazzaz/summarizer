import type { CSSProperties } from "react";

const BARS = [0, 1, 2, 3, 4];

export type MeterState = "live" | "ready" | "failed";

/**
 * Reads a source's state the way studio gear does. Bars run while the
 * transcript is being made and drop to one flat line the moment it lands, so a
 * chip needs neither a spinner nor a word to say which it is.
 */
export function Meter({
  state,
  /** "current" inherits the text colour — for meters sitting on a filled button. */
  tone = "signal",
  className = "",
}: {
  state: MeterState;
  tone?: "signal" | "current";
  className?: string;
}) {
  const barColor =
    tone === "current"
      ? "bg-current"
      : state === "failed"
        ? "bg-live"
        : "bg-signal";

  return (
    <span
      className={`inline-flex h-4 items-end gap-[2px] ${
        state === "live" ? "vu-live" : ""
      } ${className}`}
    >
      {BARS.map((bar) => (
        <span
          key={bar}
          className={`vu-bar h-4 w-[2px] rounded-full ${barColor}`}
          style={{ "--bar-delay": `${bar * 110}ms` } as CSSProperties}
        />
      ))}
    </span>
  );
}
