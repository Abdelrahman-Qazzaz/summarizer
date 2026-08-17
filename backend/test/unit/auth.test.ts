import { beforeEach, describe, expect, it, vi } from "vitest";
import { sign } from "hono/jwt";

const { mockAuthenticateWithCode, mockRevokeSession } = vi.hoisted(() => ({
  mockAuthenticateWithCode: vi.fn(),
  mockRevokeSession: vi.fn(),
}));

vi.mock("@workos-inc/node", () => ({
  WorkOS: class {
    userManagement = {
      authenticateWithCode: mockAuthenticateWithCode,
      getAuthorizationUrl: vi.fn(),
      listUsers: vi.fn(),
      revokeSession: mockRevokeSession,
    };
  },
}));

import {
  getAuthSessionFromCode,
  revokeAuthSession,
} from "../../api/src/auth/auth";

const userId = "user_01AUTH";
const sessionId = "session_01AUTH";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("WorkOS auth sessions", () => {
  it("keeps the WorkOS session ID returned during authentication", async () => {
    const accessToken = await sign({ sid: sessionId }, "workos-test-secret");
    mockAuthenticateWithCode.mockResolvedValueOnce({
      user: { id: userId },
      accessToken,
    });

    await expect(getAuthSessionFromCode("oauth-code")).resolves.toEqual({
      userId,
      sessionId,
    });
  });

  it("revokes the selected WorkOS session", async () => {
    mockRevokeSession.mockResolvedValueOnce(undefined);

    await revokeAuthSession(sessionId);

    expect(mockRevokeSession).toHaveBeenCalledWith({ sessionId });
  });
});
