import { beforeEach, describe, expect, it, vi } from "vitest";
import { BUCKET, BUCKET_SETTINGS } from "../../shared/storage/schema";

const bucket = vi.hoisted(() => ({
  readSettings: vi.fn(),
  create: vi.fn(),
  updateSettings: vi.fn(),
}));

vi.mock("../../shared/storage/bucket", () => ({ bucket }));

/** The script does its work when imported, like scripts/migrate.ts. */
async function runScript() {
  vi.resetModules();
  await import("../../scripts/pushStorage");
}

describe("storage:push", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("creates the bucket when there is none", async () => {
    bucket.readSettings.mockResolvedValue(null);

    await runScript();

    expect(bucket.create).toHaveBeenCalledWith(BUCKET, BUCKET_SETTINGS);
    expect(bucket.updateSettings).not.toHaveBeenCalled();
  });

  it("updates a bucket whose settings differ", async () => {
    bucket.readSettings.mockResolvedValue({
      public: false,
      fileSizeLimit: null,
      allowedMimeTypes: null,
    });

    await runScript();

    expect(bucket.updateSettings).toHaveBeenCalledWith(BUCKET, BUCKET_SETTINGS);
    expect(bucket.create).not.toHaveBeenCalled();
  });

  it("leaves a matching bucket alone, whatever order its types are in", async () => {
    bucket.readSettings.mockResolvedValue({
      ...BUCKET_SETTINGS,
      allowedMimeTypes: [...BUCKET_SETTINGS.allowedMimeTypes].reverse(),
    });

    await runScript();

    expect(bucket.create).not.toHaveBeenCalled();
    expect(bucket.updateSettings).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith("  compared:", BUCKET_SETTINGS);
  });
});
