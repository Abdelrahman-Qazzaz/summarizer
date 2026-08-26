import { sign, verify } from "hono/jwt";
import { describe, expect, it } from "vitest";

import {
  createSessionToken,
  verifySessionToken,
} from "../../api/src/auth/sessionToken";

const userId = "user_01SESSION";
const sessionId = "session_01SESSION";

describe("session tokens", () => {
  it("creates an HS256 token with the expected claims", async () => {
    const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + 3600;

    const token = await createSessionToken({
      userId,
      sessionId,
      expiresAtEpochSeconds,
    });

    await expect(
      verify(token, process.env.SESSION_SECRET!, "HS256"),
    ).resolves.toMatchObject({
      sub: userId,
      sid: sessionId,
      exp: expiresAtEpochSeconds,
    });
  });

  it("returns application-facing claim names", async () => {
    const token = await createSessionToken({
      userId,
      sessionId,
      expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
    });

    await expect(verifySessionToken(token)).resolves.toEqual({
      userId,
      sessionId,
    });
  });

  it("rejects a token without a user ID", async () => {
    const token = await sign(
      { sid: sessionId },
      process.env.SESSION_SECRET!,
      "HS256",
    );

    await expect(verifySessionToken(token)).rejects.toThrow(
      "Session token is missing a user ID",
    );
  });

  it("rejects a token with an invalid session ID", async () => {
    const token = await sign(
      { sub: userId, sid: 123 },
      process.env.SESSION_SECRET!,
      "HS256",
    );

    await expect(verifySessionToken(token)).rejects.toThrow(
      "Session token contains an invalid session ID",
    );
  });
});
