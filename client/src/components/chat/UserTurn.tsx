import type { MessageTranscript } from "../../api/messages";
import { useShell } from "../app/shellContext";
import { TurnSources } from "./TurnSources";
import type { TurnImage } from "./types";

export function UserTurn({
  content,
  images,
  transcripts,
}: {
  content: string;
  images: TurnImage[];
  transcripts: MessageTranscript[];
}) {
  const { setOpenSource } = useShell();

  return (
    <div className="flex flex-col items-end">
      <TurnSources transcripts={transcripts} />

      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-line bg-surface px-4 py-3">
        {images.length > 0 && (
          <div
            className={`mb-3 grid gap-2 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {images.map((image) => (
              <button
                key={image.imageUploadId}
                type="button"
                onClick={() =>
                  setOpenSource({
                    kind: "image",
                    url: image.url,
                    fileName: image.fileName,
                  })
                }
                aria-label={`View ${image.fileName}`}
                className="block overflow-hidden rounded-lg border border-line transition-colors hover:border-signal"
              >
                <img
                  src={image.url}
                  alt={image.fileName}
                  className="h-28 w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
        <p className="whitespace-pre-wrap text-[0.9375rem] leading-relaxed">
          {content}
        </p>
      </div>
    </div>
  );
}
