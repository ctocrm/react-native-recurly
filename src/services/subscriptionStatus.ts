/**
 * Phase N: subscription status buckets (user-approved 2026-09-15).
 *
 * "May have expired" = the renewal date passed more than the grace period
 * ago while the row is still active-status. Deliberately a CHIP + FILTER,
 * never a destructive status change: the renewal may simply not be
 * confirmed yet (link-only invoices, unsynced app state).
 */

export const DEFAULT_EXPIRED_GRACE_DAYS = 7;

export const EXPIRED_GRACE_OPTIONS = [3, 7, 14] as const;

export type SubscriptionBucket = "active" | "upcoming" | "sparse" | "expired";

export type BucketInput = {
  renewalDate?: string;
  status?: string;
  category?: string;
};

/** True when `now` is past the renewal date plus the grace period. */
export function isMayHaveExpired(
  renewalDate: string | undefined,
  graceDays: number,
  now: Date = new Date(),
): boolean {
  if (!renewalDate) return false;
  const t = new Date(renewalDate).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() > t + graceDays * 86_400_000;
}

/**
 * The display bucket for the Subscriptions filters:
 *  - expired outranks everything (a lapsed renewal is the actionable state),
 *  - sparse (one-off purchases) is its own bucket,
 *  - everything else — including paused/cancelled — is "active".
 */
export function subscriptionBucket(
  sub: BucketInput,
  graceDays: number,
  now: Date = new Date(),
): "expired" | "sparse" | "active" {
  const stopped =
    sub.status === "paused" ||
    sub.status === "cancelled" ||
    sub.status === "archived";
  if (!stopped && isMayHaveExpired(sub.renewalDate, graceDays, now)) {
    return "expired";
  }
  if (sub.category === "sparse") return "sparse";
  return "active";
}
