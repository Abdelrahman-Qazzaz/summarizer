import { createSessionToken } from "../../api/src/auth/sessionToken";
import { COOKIE_KEYS } from "../../shared/keys";

export async function sessionCookieHeader(
  userId: string,
  sessionId?: string,
): Promise<string> {
  const token = await createSessionToken({
    userId,
    sessionId,
    expiresAtEpochSeconds: Math.floor(Date.now() / 1000) + 3600,
  });
  return `${COOKIE_KEYS.session}=${token}`;
}

/**
 * Browsers always send Origin on unsafe methods, and csrf() in app.ts rejects
 * form-style requests that arrive without one. Tests have to model that, or
 * every POST and DELETE comes back 403 for reasons unrelated to what they
 * are asserting.
 */
export async function authedHeaders(
  userId: string,
  sessionId?: string,
): Promise<Record<string, string>> {
  return {
    Origin: process.env.CLIENT_URL!,
    Cookie: await sessionCookieHeader(userId, sessionId),
  };
}
