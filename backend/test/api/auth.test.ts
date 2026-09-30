import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_WORKOS_URL = "https://workos.example/authorize";
const userId = "user_01CALLBACK";
const sessionId = "session_01CALLBACK";

const {
  mockGetRiderctUrl,
  mockGetAuthSessionFromCode,
  mockRevokeAuthSession,
  mockInsert,
} = vi.hoisted(() => ({
  mockGetRiderctUrl: vi.fn(),
  mockGetAuthSessionFromCode: vi.fn(),
  mockRevokeAuthSession: vi.fn(),
  mockInsert: vi.fn(),
}));

vi.mock("../../api/src/auth/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../api/src/auth/auth")>();
  return {
    ...actual,
    getRiderctUrl: mockGetRiderctUrl,
    getAuthSessionFromCode: mockGetAuthSessionFromCode,
    revokeAuthSession: mockRevokeAuthSession,
  };
});

vi.mock("../../shared/db", async () => ({
  db: { insert: mockInsert },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

import { createApp } from "../../api/app";
import { authedHeaders } from "../helpers/session";
import { signAccessToken } from "../helpers/accessTokens";
import { WORKOS_REDIRECT_URI } from "../../api/src/auth/auth";
import { COOKIE_KEYS } from "../../shared/keys";

describe("GET /auth/me", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await (await createApp()).request("http://localhost/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/auth/me", {
      headers: { Cookie: `${COOKIE_KEYS.session}=not.a.valid.jwt` },
    });
    expect(res.status).toBe(401);
  });

  it("returns userId for a valid session", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/auth/me", {
      headers: await authedHeaders("user_01TEST"),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: "user_01TEST" });
  });
});

const EXPECTED_CALLBACK_PATH = "/auth/callback";

describe("OAuth callback URL", () => {
  it("WorkOS redirectUri path matches auth router callback", () => {
    const { pathname } = new URL(WORKOS_REDIRECT_URI);
    expect(pathname).toBe(EXPECTED_CALLBACK_PATH);
  });
});

describe("GET /auth/login", () => {
  beforeEach(() => {
    mockGetRiderctUrl.mockReturnValue(MOCK_WORKOS_URL);
  });

  it("redirects to the WorkOS authorization URL", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/auth/login", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe(MOCK_WORKOS_URL);
    expect(mockGetRiderctUrl).toHaveBeenCalledTimes(1);
  });
});

describe("GET /auth/callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAuthSessionFromCode.mockResolvedValue({
      userId,
      accessToken: "workos-access-token",
      refreshToken: "workos-refresh-token",
    });
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns 400 when code is missing (route exists)", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/auth/callback");
    expect(res.status).toBe(400);
  });

  it("exchanges code, sets session cookie, and redirects to client", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/auth/callback?code=oauth_code_123", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://localhost:5173");
    expect(mockGetAuthSessionFromCode).toHaveBeenCalledWith("oauth_code_123");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toContainEqual(
      expect.stringMatching(
        new RegExp(`^${COOKIE_KEYS.session}=workos-access-token;.*Path=/;`),
      ),
    );
    // Sent only to the endpoint that spends it.
    expect(cookies).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^${COOKIE_KEYS.refresh}=workos-refresh-token;.*Path=/auth/refresh;`,
        ),
      ),
    );
  });
});

describe("POST /auth/logout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRevokeAuthSession.mockResolvedValue(undefined);
  });

  it("revokes the WorkOS session and clears both cookies", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/auth/logout", {
      method: "POST",
      headers: await authedHeaders("user_01TEST", sessionId),
    });
    expect(res.status).toBe(200);
    expect(mockRevokeAuthSession).toHaveBeenCalledWith(sessionId);
    const cookies = res.headers.getSetCookie();
    expect(cookies).toContainEqual(
      expect.stringMatching(
        new RegExp(`^${COOKIE_KEYS.session}=;.*Max-Age=0;.*Path=/;`),
      ),
    );
    expect(cookies).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^${COOKIE_KEYS.refresh}=;.*Max-Age=0;.*Path=/auth/refresh;`,
        ),
      ),
    );
  });

  it("ends the session of an access token that has already expired", async () => {
    const token = await signAccessToken({
      userId: "user_01TEST",
      sessionId,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) - 600,
    });

    const res = await (
      await createApp()
    ).request("http://localhost/auth/logout", {
      method: "POST",
      headers: {
        Origin: process.env.CLIENT_URL!,
        Cookie: `${COOKIE_KEYS.session}=${token}`,
      },
    });

    expect(res.status).toBe(200);
    expect(mockRevokeAuthSession).toHaveBeenCalledWith(sessionId);
  });

  it("remains successful without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/auth/logout", {
      method: "POST",
      headers: { Origin: process.env.CLIENT_URL! },
    });

    expect(res.status).toBe(200);
    expect(mockRevokeAuthSession).not.toHaveBeenCalled();
    expect(res.headers.get("Set-Cookie")?.toLowerCase()).toMatch(
      /max-age=0|expires=/,
    );
  });

  it("still clears the local session when WorkOS revocation fails", async () => {
    mockRevokeAuthSession.mockRejectedValueOnce(
      new Error("WorkOS unavailable"),
    );

    const res = await (
      await createApp()
    ).request("http://localhost/auth/logout", {
      method: "POST",
      headers: await authedHeaders("user_01TEST", sessionId),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")?.toLowerCase()).toMatch(
      /max-age=0|expires=/,
    );
  });
});
