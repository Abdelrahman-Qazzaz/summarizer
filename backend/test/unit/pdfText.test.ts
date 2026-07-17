import { describe, it, expect, vi } from "vitest";
import {
  isPdfUpload,
  extractPdfText,
  PdfExtractionError,
  PDF_MIME,
} from "../../services/api/src/utils/pdfText";
import {
  loadSampleFile,
  SAMPLE_PDF_NAME,
  SAMPLE_EMPTY_PDF_NAME,
} from "../helpers/sampleFiles";

describe("isPdfUpload", () => {
  it("detects by MIME type alone", () => {
    expect(isPdfUpload(new File(["x"], "doc", { type: PDF_MIME }))).toBe(true);
  });

  it("detects by extension alone (missing MIME)", () => {
    expect(isPdfUpload(new File(["x"], "Doc.PDF", { type: "" }))).toBe(true);
  });

  it("rejects plain text files", () => {
    expect(
      isPdfUpload(new File(["x"], "notes.txt", { type: "text/plain" })),
    ).toBe(false);
  });
});

describe("extractPdfText", () => {
  it("extracts the text of a text-based PDF", async () => {
    const file = await loadSampleFile(SAMPLE_PDF_NAME, PDF_MIME);
    await expect(extractPdfText(file)).resolves.toContain("hi there pdf");
  });

  it("rejects unparseable bytes as PdfExtractionError", async () => {
    const garbage = new File([new Uint8Array([1, 2, 3])], "x.pdf", {
      type: PDF_MIME,
    });
    await expect(extractPdfText(garbage)).rejects.toThrow(PdfExtractionError);
    await expect(extractPdfText(garbage)).rejects.toThrow(
      "Could not parse PDF file.",
    );
  });

  it("rejects PDFs with no text layer (scanned)", async () => {
    const file = await loadSampleFile(SAMPLE_EMPTY_PDF_NAME, PDF_MIME);
    await expect(extractPdfText(file)).rejects.toThrow(/scanned/);
  });

  it("maps PasswordException to a password message", async () => {
    vi.resetModules();
    vi.doMock("unpdf", () => ({
      extractText: vi.fn().mockRejectedValue(
        Object.assign(new Error("locked"), { name: "PasswordException" }),
      ),
    }));
    const fresh = await import("../../services/api/src/utils/pdfText");
    const file = new File(["x"], "locked.pdf", { type: PDF_MIME });
    await expect(fresh.extractPdfText(file)).rejects.toThrow(
      /password-protected/,
    );
    vi.doUnmock("unpdf");
    vi.resetModules();
  });
});
