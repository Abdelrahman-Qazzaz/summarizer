import { describe, it, expect } from "vitest";
import { createApp } from "../../services/api/app";

describe("GET /health", () => {
  it("returns ok", async () => {
    const res = await createApp().request("http://localhost/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
