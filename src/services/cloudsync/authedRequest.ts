/**
 * R17: expiry-aware request path for cloud-sync storages — the same
 * token-lifetime contract as emailscan/oauthSession, applied to every
 * Bearer-sending storage (Drive, OneDrive, Dropbox, ownCloud/Nextcloud).
 *
 * Audit 2026-09-06 (why this module exists):
 * - the storages sent `Bearer ${tokens.accessToken}` blindly, with no expiry
 *   awareness and no 401 recovery — every sync after token expiry failed;
 * - CloudSyncContext stored the AUTHORIZE response params as tokens
 *   (accessToken/refreshToken were always undefined in the code flow);
 * - Dropbox used the implicit flow, which never issues a refresh token.
 * This module + the context fixes close that class for cloud sync.
 */
import * as SecureStore from "expo-secure-store";
import {
  createTokenSession,
  type TokenSession,
} from "@/services/emailscan/oauthSession";

export interface CloudTokenBlob {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export type CloudTokenRefresher = (
  blob: CloudTokenBlob,
) => Promise<CloudTokenBlob | null>;

/** OAuth2 refresh (RFC 6749 §6) against `tokenEndpoint`. Returns null on any
 * failure so callers keep their stored token and the API call itself reports
 * the real error — a transient refresh failure must not be invented into an
 * auth failure. */
export function makeOAuthTokenRefresher(opts: {
  tokenEndpoint: string;
  clientId: string;
  fetchImpl?: typeof fetch;
}): CloudTokenRefresher {
  return async (blob) => {
    if (!blob.refreshToken || !opts.clientId) return null;
    const doFetch = opts.fetchImpl ?? fetch;
    const res = await doFetch(opts.tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: blob.refreshToken,
        client_id: opts.clientId,
      }).toString(),
    });
    if (!res.ok) return null;
    const json = (await res.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number | string;
    } | null;
    if (!json?.access_token) return null;
    return {
      accessToken: json.access_token,
      refreshToken: json.refresh_token ?? blob.refreshToken,
      expiresAt: json.expires_in
        ? Date.now() + Number(json.expires_in) * 1000
        : undefined,
    };
  };
}

/** Session bound to a SecureStore key: refreshed tokens persist so the next
 * app launch (and the storages' `authenticate()`) pick them up. */
export function createCloudSession(opts: {
  tokens: CloudTokenBlob;
  storageKey: string;
  refresher: CloudTokenRefresher | null;
}): TokenSession {
  let latest = opts.tokens;
  const refresh = opts.refresher
    ? async () => {
        const next = await opts.refresher!(latest);
        if (next?.accessToken) {
          latest = next;
          await SecureStore.setItemAsync(opts.storageKey, JSON.stringify(next));
        }
        return next;
      }
    : undefined;
  return createTokenSession(opts.tokens, refresh);
}

/** One authed request: proactive refresh BEFORE the call (a token within the
 * request margin never reaches the provider), plus one 401 backstop retry
 * after a forced refresh for early server-side revocation. Any Authorization
 * header already in `init` is replaced with the session's current token. */
export async function authedRequest(
  session: TokenSession,
  url: string,
  init?: RequestInit,
  label = "CloudSync",
): Promise<Response> {
  const token = await session.valid();
  const res = await fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  });
  if (res.status !== 401) return res;
  console.log(
    `[${label}] 401 — access token rejected; refreshing and retrying once`,
  );
  const next = await session.force();
  if (!next || next === token) return res;
  return fetch(url, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${next}` },
  });
}
