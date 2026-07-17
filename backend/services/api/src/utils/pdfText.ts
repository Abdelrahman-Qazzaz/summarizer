import { extractText } from "unpdf";

/**
 * PDF text extraction for the text-upload path.
 *
 * PDFs ride the same `/upload/text` route as plain text; the controller
 * branches on `isPdfUpload` and stores only the extracted text, so the
 * summarize worker never sees PDF bytes. Text-based PDFs only — scanned
 * (image-only) documents yield no text and are rejected, not OCR'd.
 */

export const PDF_MIME = "application/pdf";

/** Extraction failures the client should see (4xx), as opposed to bugs. */
export class PdfExtractionError extends Error {}

/**
 * Detect PDFs by MIME *or* extension — browsers set the type reliably, but
 * drag-and-drop from some sources and curl uploads may leave it empty.
 */
export function isPdfUpload(file: File): boolean {
  return (
    file.type.toLowerCase() === PDF_MIME ||
    file.name.toLowerCase().endsWith(".pdf")
  );
}

/**
 * Extract the full text of a PDF.
 *
 * Throws `PdfExtractionError` for anything user-actionable: encrypted
 * documents, unparseable bytes, or PDFs with no text layer.
 */
export async function extractPdfText(file: File): Promise<string> {
  let text: string;
  try {
    ({ text } = await extractText(
      new Uint8Array(await file.arrayBuffer()),
      { mergePages: true },
    ));
  } catch (err) {
    if (err instanceof Error && err.name === "PasswordException") {
      throw new PdfExtractionError(
        "PDF is password-protected; please remove the password and retry.",
      );
    }
    throw new PdfExtractionError("Could not parse PDF file.");
  }

  if (!text.trim()) {
    throw new PdfExtractionError(
      "No extractable text found — the PDF may be scanned images (OCR is not supported).",
    );
  }
  return text;
}
