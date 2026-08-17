import type { MessageTranscript } from "../../api/messages";
import { useShell } from "../app/shellContext";
import { Icon, type IconName } from "../ui/Icon";
import { Meter } from "../ui/Meter";

const sourceIcons: Record<string, IconName> = {
  youtube: "youtube",
  video: "video",
  audio: "waveform",
};

/**
 * The transcripts a turn was sent with, in the order the model received them.
 * A message can carry several, which is the whole reason this reads as a list
 * and not a single badge. Each one opens.
 */
export function TurnSources({
  transcripts,
}: {
  transcripts: MessageTranscript[];
}) {
  const { setOpenSource } = useShell();

  if (transcripts.length === 0) return null;

  return (
    <ul className="mb-2 flex flex-wrap justify-end gap-1.5">
      {transcripts.map((transcript) => (
        <li key={transcript.uploadId} className="max-w-full">
          <button
            type="button"
            onClick={() =>
              setOpenSource({
                kind: "transcript",
                uploadId: transcript.uploadId,
                fileName: transcript.fileName,
                title: transcript.title,
              })
            }
            aria-label={`View the transcript for ${transcript.title ?? transcript.fileName}`}
            className="flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 transition-colors hover:border-signal"
          >
            <Meter state="ready" className="h-3" />
            <Icon
              name={sourceIcons[transcript.source] ?? "waveform"}
              className="h-3.5 w-3.5 shrink-0 text-faint"
            />
            <span className="truncate font-mono text-[11px] text-muted">
              {transcript.title ?? transcript.fileName}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
