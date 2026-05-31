// test/helpers/session.ts
import { sign } from "hono/jwt";
import { COOKIE_KEYS } from "../../services/api/src/cookies/keys";

export async function sessionCookieHeader(userId: string): Promise<string> {
  const token = await sign(
    { sub: userId, exp: Math.floor(Date.now() / 1000) + 3600 },
    process.env.SESSION_SECRET!,
  );
  return `${COOKIE_KEYS.session}=${token}`;
}
