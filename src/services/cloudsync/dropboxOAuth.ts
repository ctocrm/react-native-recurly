/**
 * R17: Dropbox OAuth done correctly — authorization-code + PKCE + offline
 * refresh tokens. The previous flow (response_type=token, implicit) never
 * issues a refresh token, so Dropbox sync was dead-by-design after every
 * token expiry (~4h). Dropbox requires the code flow with a PKCE
 * code_challenge for installed apps without a client secret.
 */
import * as Crypto from "expo-crypto";
import type { CloudTokenBlob } from "./authedRequest";

const DROPBOX_AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize";
const DROPBOX_TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";

export interface DropboxVerifier {
  verifier: string;
  challenge: string;
}

/** RFC 7636 §4: 32 random bytes hex (64 chars, within Dropbox's 43-128) +
 * the S256 challenge = base64url(SHA256(verifier)). */
export async function createDropboxVerifier(): Promise<DropboxVerifier> {
  const bytes = new Uint8Array(32);
  Crypto.getRandomValues(bytes);
  const verifier = Array.from(bytes, (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
  const digest = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    verifier,
    { encoding: Crypto.CryptoEncoding.BASE64 },
  );
  const challenge = digest
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { verifier, challenge };
}

export function buildDropboxAuthUrl(opts: {
  appKey: string;
  redirectUri: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: opts.appKey,
    response_type: "code",
    // offline => Dropbox issues a refresh token alongside the 4h access token
    token_access_type: "offline",
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
    redirect_uri: opts.redirectUri,
  });
  return `${DROPBOX_AUTHORIZE_URL}?${params.toString()}`;
}

export async function exchangeDropboxCode(opts: {
  appKey: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
  fetchImpl?: typeof fetch;
}): Promise<CloudTokenBlob> {
  const res = await (opts.fetchImpl ?? fetch)(DROPBOX_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: opts.code,
      redirect_uri: opts.redirectUri,
      client_id: opts.appKey,
      code_verifier: opts.codeVerifier,
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`Dropbox token exchange failed (${res.status})`);
  }
  const json = (await res.json().catch(() => null)) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number | string;
  } | null;
  if (!json?.access_token) {
    throw new Error("Dropbox token exchange returned no access token");
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: json.expires_in
      ? Date.now() + Number(json.expires_in) * 1000
      : undefined,
  };
}
