/**
 * OAuth refresh-before-list primitives (pure; no expo imports so it stays
 * unit-testable). providers.ts supplies the SecureStore/persistence glue.
 *
 * Regression this fixes: `fetcherFor` used to pass the stored access token
 * straight into the Gmail/Graph fetchers. Google/Microsoft access tokens live
 * ~1h, so every scan run later than that failed with 401
 * "invalid authentication credentials" (Workspace) / IDX14100 (Outlook)
 * even though connect had succeeded and a refresh token was stored.
 */

export const TOKEN_EXPIRY_SKEW_MS = 60_000;

export interface RefreshableTokenBlob {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

/** True when the stored access token is expired or within the skew margin
 * of expiring. Missing `expiresAt` is treated as usable — the list call
 * itself will surface an auth error if it is stale. */
export function tokenNeedsRefresh(
  tokens: RefreshableTokenBlob,
  now: number = Date.now(),
): boolean {
  if (!tokens.accessToken) return false;
  if (!tokens.expiresAt) return false;
  return now + TOKEN_EXPIRY_SKEW_MS >= tokens.expiresAt;
}

/** The provider's verdict on our refresh token. Only a rejection means the
 * session is dead; anything else (network, 5xx, rate limit) is retryable and
 * should fall back to the stored token. */
export function classifyTokenRefreshFailure(
  status: number,
  body: { error?: string } | null,
): "reconnect" | "transient" {
  const code = (body?.error ?? "").toLowerCase();
  if (
    status === 400 ||
    status === 401 ||
    code === "invalid_grant" ||
    code === "invalid_client" ||
    code === "unauthorized_client"
  ) {
    return "reconnect";
  }
  return "transient";
}

/** Raised when the provider rejected the refresh token (invalid_grant and
 * friends). Only a fresh interactive sign-in fixes this. */
export class TokenRefreshRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TokenRefreshRejectedError";
  }
}

export interface RefreshedTokens {
  accessToken: string;
  refreshToken?: string;
  /** Absolute epoch-ms expiry computed by the caller. */
  expiresAt?: number;
}

/** Exchange a refresh token for a fresh access token at `tokenEndpoint`
 * (RFC 6749 §6). Resolves with the new tokens; throws
 * `TokenRefreshRejectedError` when the provider rejects the grant. Other
 * errors (network, 5xx) propagate to the caller, which should fall back to
 * the stored token. `fetchImpl` is injectable for tests. */
export async function refreshAccessToken(opts: {
  tokenEndpoint: string;
  clientId: string;
  refreshToken: string;
  fetchImpl?: typeof fetch;
}): Promise<RefreshedTokens> {
  const doFetch = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: opts.refreshToken,
    client_id: opts.clientId,
  });
  const res = await doFetch(opts.tokenEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  const json = (await res
    .json()
    .catch(() => null)) as {
    access_token?: string;
    expires_in?: number | string;
    refresh_token?: string;
    error?: string;
  } | null;
  if (!res.ok || !json?.access_token) {
    if (classifyTokenRefreshFailure(res.status, json) === "reconnect") {
      throw new TokenRefreshRejectedError(
        `Token refresh rejected (${res.status}${json?.error ? ` ${json.error}` : ""})`,
      );
    }
    throw new Error(
      `Token refresh failed (${res.status}${json?.error ? ` ${json.error}` : ""})`,
    );
  }
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token || opts.refreshToken,
    expiresAt: json.expires_in
      ? Date.now() + Number(json.expires_in) * 1000
      : undefined,
  };
}
