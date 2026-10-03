import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type JWTPayload,
} from "jose";

/**
 * Tests stand in for WorkOS: they sign access tokens with a key pair of their
 * own, and test/setup.ts makes the API verify against its public half.
 */
const KEY_ID = "test-key";
const { publicKey, privateKey } = await generateKeyPair("RS256");

export const testKeys = createLocalJWKSet({
  keys: [{ ...(await exportJWK(publicKey)), kid: KEY_ID, alg: "RS256" }],
});

/** Signs any claims, for tests of malformed tokens. */
export function signTestToken(claims: JWTPayload): Promise<string> {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid: KEY_ID })
    .sign(privateKey);
}

/** An access token shaped like the ones WorkOS issues. */
export function signAccessToken({
  userId,
  sessionId,
  expiresAtEpochSeconds,
}: {
  userId: string;
  sessionId: string;
  expiresAtEpochSeconds: number;
}): Promise<string> {
  return signTestToken({
    sub: userId,
    sid: sessionId,
    exp: expiresAtEpochSeconds,
  });
}
