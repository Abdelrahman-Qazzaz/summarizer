import {
  isSourceInFlight,
  sourceStatusLabel,
  type StagedSource,
} from "../../sources/types";
import { useShell } from "../app/shellContext";
import { Icon, type IconName } from "../ui/Icon";
import { Meter } from "../ui/Meter";

const kindIcons: Record<StagedSource["kind"], IconName> = {
  image: "image",
  audio: "waveform",
  video: "video",
  youtube: "youtube",
};

/** What opening this chip would show — null while there's nothing to read yet. */
function readableSource(source: StagedSource) {
  if (source.kind === "image") {
    return source.previewUrl
      ? ({
          kind: "image",
          url: source.previewUrl,
          fileName: source.name,
        } as const)
      : null;
  }
  return source.uploadId
    ? ({
        kind: "transcript",
        uploadId: source.uploadId,
        fileName: source.name,
      } as const)
    : null;
}

/**
 * A staged source, live. The meter carries the state; the words underneath
 * carry the detail, so a glance is enough and a read is available. Once the
 * source exists server-side the chip opens it.
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
  const { setOpenSource } = useShell();
  const failed = source.status === "failed";
  const readable = failed ? null : readableSource(source);

  const detail = (
    <>
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
        className={`mt-0.5 block truncate text-left text-[11px] ${failed ? "text-live" : "text-faint"}`}
      >
        {failed ? (source.error ?? "failed") : sourceStatusLabel(source)}
      </span>
    </>
  );

  return (
    <li
      className={`flex max-w-[16rem] items-center gap-2.5 rounded-lg border px-2.5 py-2 transition-colors ${
        failed
          ? "border-live/40 bg-live-tint"
          : `border-line bg-surface ${readable ? "hover:border-signal" : ""}`
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

      {readable ? (
        <button
          type="button"
          onClick={() => setOpenSource(readable)}
          aria-label={
            readable.kind === "image"
              ? `View ${source.name}`
              : `View the transcript for ${source.name}`
          }
          className="min-w-0 flex-1 text-left"
        >
          {detail}
        </button>
      ) : (
        <span className="min-w-0 flex-1">{detail}</span>
      )}

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
