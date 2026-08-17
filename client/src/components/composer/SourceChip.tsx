import {
  isSourceInFlight,
  sourceStatusLabel,
  type StagedSource,
} from "../../sources/types";
import { Icon, type IconName } from "../ui/Icon";
import { Meter } from "../ui/Meter";

const kindIcons: Record<StagedSource["kind"], IconName> = {
  image: "image",
  audio: "waveform",
  video: "video",
  youtube: "youtube",
};

/**
 * A staged source, live. The meter carries the state; the words underneath
 * carry the detail, so a glance is enough and a read is available.
 */
export function SourceChip({
  source,
  onRemove,
  onRetry,
}: {
  source: StagedSource;
  onRemove: () => void;
  onRetry: () => void;
}) {
  const failed = source.status === "failed";

  return (
    <li
      className={`flex max-w-[16rem] items-center gap-2.5 rounded-lg border px-2.5 py-2 ${
        failed ? "border-live/40 bg-live-tint" : "border-line bg-surface"
      }`}
    >
      {source.kind === "image" && source.previewUrl ? (
        <img
          src={source.previewUrl}
          alt=""
          className={`h-8 w-8 shrink-0 rounded object-cover ${
            isSourceInFlight(source) ? "opacity-50" : ""
          }`}
        />
      ) : (
        <Meter
          state={failed ? "failed" : isSourceInFlight(source) ? "live" : "ready"}
          className="shrink-0"
        />
      )}

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <Icon
            name={kindIcons[source.kind]}
            className="h-3.5 w-3.5 shrink-0 text-faint"
          />
          <span className="truncate font-mono text-[11px] text-ink">
            {source.name}
          </span>
        </span>
        <span
          className={`mt-0.5 block truncate text-[11px] ${failed ? "text-live" : "text-faint"}`}
        >
          {failed ? (source.error ?? "failed") : sourceStatusLabel(source)}
        </span>
      </span>

      {failed && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={`Retry ${source.name}`}
          className="shrink-0 rounded-md p-1 text-live transition-colors hover:bg-live/10"
        >
          <Icon name="refresh" className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${source.name}`}
        className="shrink-0 rounded-md p-1 text-faint transition-colors hover:bg-sunk hover:text-ink"
      >
        <Icon name="close" className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}
