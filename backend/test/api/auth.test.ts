import { describe, it, expect, vi, beforeEach } from "vitest";

const MOCK_WORKOS_URL = "https://workos.example/authorize";
const userId = "user_01CALLBACK";

const { mockGetRiderctUrl, mockGetUserIdFromCode, mockInsert } = vi.hoisted(
  () => ({
    mockGetRiderctUrl: vi.fn(),
    mockGetUserIdFromCode: vi.fn(),
    mockInsert: vi.fn(),
  }),
);

vi.mock("../../services/api/src/auth/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/api/src/auth/auth")>();
  return {
    ...actual,
    getRiderctUrl: mockGetRiderctUrl,
    getUserIdFromCode: mockGetUserIdFromCode,
  };
});

vi.mock("../../shared/db", () => ({
  db: { insert: mockInsert },
  users: {},
  jobStatusEnum: { enumValues: ["queued", "processing", "completed", "failed"] },
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";
import { WORKOS_REDIRECT_URI } from "../../services/api/src/auth/auth";
import { COOKIE_KEYS } from "../../shared/keys";

describe("GET /auth/me", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await (await createApp()).request("http://localhost/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns 401 for an invalid session cookie", async () => {
    const res = await (await createApp()).request("http://localhost/auth/me", {
      headers: { Cookie: `${COOKIE_KEYS.session}=not.a.valid.jwt` },
    });
    expect(res.status).toBe(401);
  });

  it("returns userId for a valid session", async () => {
    const res = await (await createApp()).request("http://localhost/auth/me", {
      headers: { Cookie: await sessionCookieHeader("user_01TEST") },
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
    const res = await (await createApp()).request("http://localhost/auth/login", {
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
    mockGetUserIdFromCode.mockResolvedValue(userId);
    mockInsert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
      }),
    });
  });

  it("returns 400 when code is missing (route exists)", async () => {
    const res = await (await createApp()).request("http://localhost/auth/callback");
    expect(res.status).toBe(400);
  });

  it("exchanges code, sets session cookie, and redirects to client", async () => {
    const res = await (await createApp()).request(
      "http://localhost/auth/callback?code=oauth_code_123",
      { redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("Location")).toBe("http://localhost:5173");
    expect(mockGetUserIdFromCode).toHaveBeenCalledWith("oauth_code_123");
    expect(mockInsert).toHaveBeenCalledTimes(1);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain(`${COOKIE_KEYS.session}=`);
  });
});

describe("POST /auth/logout", () => {
  it("clears the session cookie", async () => {
    const res = await (await createApp()).request("http://localhost/auth/logout", {
      method: "POST",
      headers: { Cookie: await sessionCookieHeader("user_01TEST") },
    });
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie");
    expect(setCookie).toContain(`${COOKIE_KEYS.session}=`);
    expect(setCookie?.toLowerCase()).toMatch(/max-age=0|expires=/);
  });
});
