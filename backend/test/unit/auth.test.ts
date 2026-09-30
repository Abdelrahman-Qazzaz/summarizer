import { beforeEach, describe, expect, it, vi } from "vitest";

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
  it("returns the user and the tokens WorkOS issued", async () => {
    mockAuthenticateWithCode.mockResolvedValueOnce({
      user: { id: userId },
      accessToken: "workos-access-token",
      refreshToken: "workos-refresh-token",
    });

    await expect(getAuthSessionFromCode("oauth-code")).resolves.toEqual({
      userId,
      accessToken: "workos-access-token",
      refreshToken: "workos-refresh-token",
    });
  });

  it("revokes the selected WorkOS session", async () => {
    mockRevokeSession.mockResolvedValueOnce(undefined);

    await revokeAuthSession(sessionId);

    expect(mockRevokeSession).toHaveBeenCalledWith({ sessionId });
  });
});
