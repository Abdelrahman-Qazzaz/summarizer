import { WorkOS } from "@workos-inc/node";
import { decode } from "hono/jwt";
import { getApiEnv } from "../../../shared/env";

export const WORKOS_REDIRECT_URI = new URL(
  "/auth/callback",
  getApiEnv().API_BASE_URL,
).toString();

const workos = new WorkOS(getApiEnv().WORKOS_API_KEY, {
  clientId: getApiEnv().WORKOS_CLIENT_ID,
});

/** Startup health check: fails if WorkOS is unreachable or rejects the API key. */
export async function pingWorkos(): Promise<void> {
  await workos.userManagement.listUsers({ limit: 1 });
}

export function getRiderctUrl() {
  return workos.userManagement.getAuthorizationUrl({
    // Specify that we'd like AuthKit to handle the authentication flow
    provider: "authkit",

    // The callback endpoint that WorkOS will redirect to after a user authenticates
    redirectUri: WORKOS_REDIRECT_URI,
    clientId: getApiEnv().WORKOS_CLIENT_ID,
  });
}

export async function getAuthSessionFromCode(code: string) {
  const { user, accessToken } =
    await workos.userManagement.authenticateWithCode({
      code,
      clientId: getApiEnv().WORKOS_CLIENT_ID,
    });
  const { payload } = decode(accessToken);
  if (typeof payload.sid !== "string") {
    throw new Error("WorkOS authentication response is missing a session ID");
  }
  return { userId: user.id, sessionId: payload.sid };
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  await workos.userManagement.revokeSession({
    sessionId,
  });
}
