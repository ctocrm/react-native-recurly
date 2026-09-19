/**
 * R35: lapsed-recurring expiry, derived from the corpus — never stored.
 *
 * A recurring row whose last PROVEN charge is older than one full period
 * (+slack) plus the grace window has almost certainly lapsed (user:
 * "Prime Video is correctly monthly but I haven't paid in months"). The
 * renewalDate-based chip can never fire for scanned rows (imports set no
 * renewalDate), so the corpus is the only honest evidence source.
 *
 * Pure math only — the corpus walkers live beside their merchant matchers
 * (chargeDisplay.ts legacy / projectionDisplay.ts projection) to reuse the
 * indexes; importing back from those modules would create a cycle.
 *
 * Split by design: the chip honors the user's grace setting; the spend
 * paths (pure functions without preference access) use the default grace.
 */
import { DEFAULT_EXPIRED_GRACE_DAYS } from "@/services/subscriptionStatus";

type CadencePeriod = "weekly" | "monthly" | "yearly";

/** Period + 3d payment-timing slack (the clockwork bands run 26–34d). */
const PERIOD_MS: Record<CadencePeriod, number> = {
  weekly: 7 * 86_400_000,
  monthly: 30 * 86_400_000,
  yearly: 365 * 86_400_000,
};
const TIMING_SLACK_MS = 3 * 86_400_000;

function cadencePeriodOf(sub: Subscription): CadencePeriod {
  if (sub.billing === "Yearly" || sub.frequency === "Yearly") return "yearly";
  if (sub.billing === "Weekly" || sub.frequency === "Weekly") return "weekly";
  return "monthly";
}

/**
 * True when the row is an active recurring subscription with corpus evidence
 * whose last charge is older than one period + slack + grace. Rows with a
 * stored renewalDate keep the existing isMayHaveExpired path; rows without
 * any recurring charge in the corpus are unjudgeable (never lapsed).
 */
export function isLapsedRecurring(
  sub: Subscription,
  lastCharge: Date | null,
  graceDays: number = DEFAULT_EXPIRED_GRACE_DAYS,
  now: Date = new Date(),
): boolean {
  if (sub.status !== "active") return false;
  if (sub.category !== "recurring") return false;
  if (sub.renewalDate) return false;
  if (!lastCharge) return false;
  const expected =
    lastCharge.getTime() +
    PERIOD_MS[cadencePeriodOf(sub)] +
    TIMING_SLACK_MS +
    graceDays * 86_400_000;
  return now.getTime() > expected;
}

