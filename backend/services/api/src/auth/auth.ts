import { WorkOS } from "@workos-inc/node";
import { getApiEnv } from "../../../../shared/env";

export const WORKOS_REDIRECT_URI = `http://localhost:${getApiEnv().PORT}/auth/callback`;

const workos = new WorkOS(getApiEnv().WORKOS_API_KEY, {
  clientId: getApiEnv().WORKOS_CLIENT_ID,
});

export function getRiderctUrl() {
  return workos.userManagement.getAuthorizationUrl({
    // Specify that we'd like AuthKit to handle the authentication flow
    provider: "authkit",

    // The callback endpoint that WorkOS will redirect to after a user authenticates
    redirectUri: WORKOS_REDIRECT_URI,
    clientId: getApiEnv().WORKOS_CLIENT_ID,
  });
}

export async function getUserIdFromCode(code: string) {
  const { user } = await workos.userManagement.authenticateWithCode({
    code,
    clientId: getApiEnv().WORKOS_CLIENT_ID,
  });
  return user.id;
}
