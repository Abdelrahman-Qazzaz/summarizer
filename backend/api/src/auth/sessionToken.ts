import { sign, verify } from "hono/jwt";

import { getApiEnv } from "../../../shared/env";

const SESSION_TOKEN_ALGORITHM = "HS256";

type CreateSessionTokenOptions = {
  userId: string;
  sessionId?: string;
  expiresAtEpochSeconds: number;
};

export async function createSessionToken({
  userId,
  sessionId,
  expiresAtEpochSeconds,
}: CreateSessionTokenOptions): Promise<string> {
  return sign(
    {
      sub: userId,
      ...(sessionId === undefined ? {} : { sid: sessionId }),
      exp: expiresAtEpochSeconds,
    },
    getApiEnv().SESSION_SECRET,
    SESSION_TOKEN_ALGORITHM,
  );
}

export async function verifySessionToken(token: string): Promise<{
  userId: string;
  sessionId?: string;
}> {
  const payload = await verify(
    token,
    getApiEnv().SESSION_SECRET,
    SESSION_TOKEN_ALGORITHM,
  );

  if (typeof payload.sub !== "string") {
    throw new Error("Session token is missing a user ID");
  }
  if (payload.sid !== undefined && typeof payload.sid !== "string") {
    throw new Error("Session token contains an invalid session ID");
  }

  return {
    userId: payload.sub,
    sessionId: payload.sid,
  };
}
