/**
 * R17: expiry-aware token session — the ONE place that owns OAuth token
 * lifetime for the scan fetchers.
 *
 * The bug class this closes (2026-09-06, and every provider patch before it):
 * fetchers held a bare access-token string and sent it blindly, so Google
 * could hand back a 401 for a token the app already KNEW was about to die
 * (minted 14:04, expiresAt stored, page-21 list sent at 15:04:45 anyway).
 * A client that knows `expiresAt` must never send a doomed request.
 *
 * Two entry points:
 * - `valid()` — call BEFORE every request. Refreshes (single-flight) when the
 *   remaining life is under the request margin, so the provider never has to
 *   reject us. Missing `expiresAt` (tokens without known lifetime, e.g.
 *   Fastmail) is a passthrough — handled by `tokenNeedsRefresh`.
 * - `force()` — reactive backstop for 401s that arrive anyway (early
 *   server-side revocation, clock drift). One forced refresh; null when no
 *   refresher is wired or it produced nothing.
 *
 * Persistence is owned by the `refresh` hook (providers.ts `refreshMidLeg` →
 * `ensureFreshOAuthTokens` → SecureStore), so a proactive refresh benefits
 * every later consumer of the stored blob, including the next scan run.
 */
import { tokenNeedsRefresh } from "./oauthRefresh";

/** Refresh the token when the next request could outlive it. A single
 * request is bounded by fetchWithTimeout (20s); 5 minutes also absorbs
 * multi-second pacing gaps between list and body calls on long legs. */
export const REQUEST_LIFETIME_MARGIN_MS = 5 * 60_000;

export interface LiveToken {
  accessToken: string;
  expiresAt?: number;
}

export interface TokenSession {
  /** Bearer for the next request; refreshes first when close to expiry. */
  valid: () => Promise<string>;
  /** Bearer after ONE forced refresh; null when no refresher / nothing new. */
  force: () => Promise<string | null>;
  /** Current bearer without refreshing (logging, tests). */
  peek: () => string;
}

export function createTokenSession(
  initial: LiveToken,
  refresh?: () => Promise<LiveToken | null>,
  opts?: { marginMs?: number },
): TokenSession {
  const marginMs = opts?.marginMs ?? REQUEST_LIFETIME_MARGIN_MS;
  let current: LiveToken = initial;
  let inFlight: Promise<LiveToken | null> | null = null;

  const runRefresh = async (): Promise<LiveToken | null> => {
    if (!refresh) return null;
    const next = await refresh();
    if (next?.accessToken) {
      current = next;
    }
    return next;
  };

  return {
    valid() {
      if (!refresh || !tokenNeedsRefresh(current, Date.now(), marginMs)) {
        return Promise.resolve(current.accessToken);
      }
      // Single-flight: concurrent list/body calls share one refresh.
      if (!inFlight) {
        console.log(
          "[MailOAuth] access token within request lifetime margin — refreshing before the next request",
        );
        inFlight = runRefresh().finally(() => {
          inFlight = null;
        });
      }
      return inFlight.then(() => current.accessToken);
    },
    async force() {
      const next = await runRefresh();
      return next?.accessToken ?? null;
    },
    peek: () => current.accessToken,
  };
}
