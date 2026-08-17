import { memo, useRef, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Icon } from "../ui/Icon";

function CodeBlock({ children }: { children?: ReactNode }) {
  const codeRef = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(codeRef.current?.textContent ?? "");
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group/code relative">
      <pre ref={codeRef}>{children}</pre>
      <button
        type="button"
        onClick={() => void copy()}
        className="absolute right-2 top-2 rounded-md border border-line bg-surface p-1.5 text-muted opacity-0 transition-opacity hover:text-ink focus-visible:opacity-100 group-hover/code:opacity-100"
        aria-label={copied ? "Code copied" : "Copy code"}
      >
        <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/**
 * Replies are markdown. Memoized on the text because a streaming turn re-renders
 * this on every flush, and re-parsing a long answer is the expensive part.
 */
export const Markdown = memo(function Markdown({
  content,
}: {
  content: string;
}) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        pre: CodeBlock,
        a: ({ children, href }) => (
          <a href={href} target="_blank" rel="noreferrer noopener">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
});
