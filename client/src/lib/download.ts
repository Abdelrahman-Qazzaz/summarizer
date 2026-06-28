/** Triggers a client-side download of text content as a file. */
export function downloadTextFile(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Builds a safe, descriptive download filename from a source name + suffix. */
export function resultFileName(sourceName: string, suffix: string): string {
  const base = sourceName.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "result";
  return `${base}-${suffix}.txt`;
}
