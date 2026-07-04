import { describe, it, expect } from "vitest";
import { createApp } from "../../services/api/app";
import { mq } from "../../shared/message-queue/messageQueue";
import { BUCKET } from "../../shared/bucket";

describe("GET /contract", () => {
  it("serves the non-sensitive contract the youtube-fetcher reads at boot", async () => {
    const res = await (await createApp()).request("http://localhost/contract");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ queues: mq.queues, bucket: BUCKET });
  });

  it("includes the cross-service queues + bucket the fetcher depends on", async () => {
    const res = await (await createApp()).request("http://localhost/contract");
    const body = (await res.json()) as {
      queues: Record<string, string>;
      bucket: string;
    };
    // These keys + values are the contract queues.py consumes.
    expect(body.queues.YT_FETCH).toBe("yt_fetch");
    expect(body.queues.TRANSCRIBE).toBe("transcribe");
    expect(body.queues.YT_FETCH_FAILED).toBe("yt_fetch_failed");
    expect(body.bucket).toBe("Audio & Text files");
  });
});
