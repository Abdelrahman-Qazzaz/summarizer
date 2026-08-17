import type { MessageTranscript } from "../../api/messages";
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
  return (
    <div className="flex flex-col items-end">
      <TurnSources transcripts={transcripts} />

      <div className="max-w-[85%] rounded-2xl rounded-br-md border border-line bg-surface px-4 py-3">
        {images.length > 0 && (
          <div
            className={`mb-3 grid gap-2 ${images.length > 1 ? "grid-cols-2" : "grid-cols-1"}`}
          >
            {images.map((image) => (
              <a
                key={image.uploadId}
                href={image.url}
                target="_blank"
                rel="noreferrer noopener"
                className="block overflow-hidden rounded-lg border border-line"
              >
                <img
                  src={image.url}
                  alt={image.fileName}
                  className="h-28 w-full object-cover"
                />
              </a>
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
