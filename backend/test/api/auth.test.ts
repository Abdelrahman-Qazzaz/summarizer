import { describe, it, expect } from "vitest";
import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";
import { WORKOS_REDIRECT_URI } from "../../services/api/src/auth/auth";

describe("GET /auth/me", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await createApp().request("http://localhost/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns userId for a valid session", async () => {
    const userId = "user_01TEST";

    const res = await createApp().request("http://localhost/auth/me", {
      headers: { Cookie: await sessionCookieHeader(userId) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId });
  });
});

const EXPECTED_CALLBACK_PATH = "/auth/callback";

describe("OAuth callback URL", () => {
  it("WorkOS redirectUri path matches auth router callback", () => {
    const { pathname } = new URL(WORKOS_REDIRECT_URI);
    expect(pathname).toBe(EXPECTED_CALLBACK_PATH);
  });
});

describe("GET /auth/callback", () => {
  it("returns 400 when code is missing (route exists)", async () => {
    const res = await createApp().request("http://localhost/auth/callback");
    expect(res.status).toBe(400); // 404 = wrong path
  });
});
