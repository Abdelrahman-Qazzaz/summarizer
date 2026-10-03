import { WorkOS } from "@workos-inc/node";
import { getApiEnv } from "../../../shared/env";

/** Exported so the auth tests can assert the URL WorkOS is handed. */
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

/** Where WorkOS publishes the keys it signs access tokens with. */
export function getJwksUrl() {
  return workos.userManagement.getJwksUrl(getApiEnv().WORKOS_CLIENT_ID);
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

/**
 * Exchanges the code WorkOS redirected back with for the user and their
 * tokens: the access token becomes the session cookie as it is, and the
 * refresh token is what gets a new one when it expires.
 */
export async function getAuthSessionFromCode(code: string) {
  const { user, accessToken, refreshToken } =
    await workos.userManagement.authenticateWithCode({
      code,
      clientId: getApiEnv().WORKOS_CLIENT_ID,
    });
  return { userId: user.id, accessToken, refreshToken };
}

/**
 * Trades a refresh token for a new access token and a new refresh token.
 * WorkOS rotates refresh tokens, so the one passed in stops working once
 * this succeeds.
 */
export async function refreshAuthSession(refreshToken: string) {
  const tokens = await workos.userManagement.authenticateWithRefreshToken({
    refreshToken,
    clientId: getApiEnv().WORKOS_CLIENT_ID,
  });
  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  };
}

export async function revokeAuthSession(sessionId: string): Promise<void> {
  await workos.userManagement.revokeSession({
    sessionId,
  });
}
