import { useState } from "react";
import { Icon } from "../ui/Icon";
import { Markdown } from "./Markdown";

export function AssistantTurn({
  content,
  modelId,
  streaming,
}: {
  content: string;
  modelId?: string | null;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group/turn">
      {streaming && content.length === 0 ? (
        <p className="text-sm text-faint">
          Thinking
          <span className="caret" />
        </p>
      ) : (
        <div className="md">
          <Markdown content={content} />
        </div>
      )}

      {!streaming && content.length > 0 && (
        <div className="mt-2 flex h-7 items-center gap-3">
          <button
            type="button"
            onClick={() => void copy()}
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/turn:opacity-100"
          >
            <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
            <span className="text-xs">{copied ? "Copied" : "Copy"}</span>
          </button>
          {modelId && (
            <span className="font-mono text-[11px] text-faint opacity-0 transition-opacity group-hover/turn:opacity-100">
              {modelId}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
