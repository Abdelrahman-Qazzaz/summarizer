import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { data } from "../shared/data";
import { COOKIE_KEYS } from "../shared/keys";

const userId = process.env.PLAYWRIGHT_USER_ID?.trim() || "playwright-e2e";
const expiresAtEpochSeconds = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
const outputPath = resolve(
  import.meta.dirname,
  "../../output/playwright/auth-state.json",
);

/**
 * TODO: broken since the session cookie became the WorkOS access token. The
 * API used to sign its own session token with SESSION_SECRET, so this could
 * mint one for a made-up user. Session cookies are now verified against
 * WorkOS's signing keys, so only WorkOS can issue one. Fix by signing in a
 * real WorkOS test user (for instance with authenticateWithPassword) and
 * writing both the session and refresh cookies below.
 */
async function createSessionCookieValue(_userId: string): Promise<string> {
  throw new Error(
    "browser:auth can't create a session any more; see the TODO in scripts/createBrowserAuthState.ts",
  );
}

const token = await createSessionCookieValue(userId);
await data.users.ensureUser(userId);
const storageState = {
  cookies: [
    {
      name: COOKIE_KEYS.session,
      value: token,
      domain: "localhost",
      path: "/",
      expires: expiresAtEpochSeconds,
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    },
  ],
  origins: [],
};

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(storageState, null, 2)}\n`, {
  mode: 0o600,
});
console.log(`Created browser auth for ${userId}: ${outputPath}`);
