import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { sign } from "hono/jwt";
import { ensureUser } from "../api/src/data/users.data";
import { getApiEnv } from "../shared/env";
import { COOKIE_KEYS } from "../shared/keys";

const userId = process.env.PLAYWRIGHT_USER_ID?.trim() || "playwright-e2e";
const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7;
const outputPath = resolve(
  import.meta.dirname,
  "../../output/playwright/auth-state.json",
);

await ensureUser(userId);
const token = await sign(
  { sub: userId, exp: expires },
  getApiEnv().SESSION_SECRET,
  "HS256",
);
const storageState = {
  cookies: [
    {
      name: COOKIE_KEYS.session,
      value: token,
      domain: "localhost",
      path: "/",
      expires,
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
