/**
 * Explicit import only. Scan never auto-creates subscriptions.
 */
import { nameToSlug } from "@/services/iconScraper";
import type { ScanCandidate } from "./types";

export function candidateToSubscription(
  candidate: ScanCandidate,
): Subscription {
  // 2026-09-16 (user rule): NO default cadence. A candidate whose emails
  // never evidenced a cadence mints without one — the old `"Monthly"`
  // fallback silently stamped the whole sparse corpus "Monthly sparse".
  const cadence =
    candidate.cadence === "yearly"
      ? "Yearly"
      : candidate.cadence === "weekly"
        ? "Weekly"
        : candidate.cadence === "monthly"
          ? "Monthly"
          : "";
  const known = candidate.amount !== undefined;
  // $0 is the very definition of free (user rule): a candidate with a known
  // zero amount imports as free regardless of the stream kind.
  const free = candidate.kind === "free" || (known && candidate.amount === 0);
  const priceUnknown = !known && candidate.kind !== "free";
  const iconKey = nameToSlug(candidate.merchant) || "plus";
  // Scan-date bug fix: the row starts when its earliest evidence email
  // arrived, not when the scan ran. Fallback (and unparseable-date guard)
  // keeps the wall-clock only for candidates with no usable date.
  const firstSeenMs = candidate.firstSeen
    ? new Date(candidate.firstSeen).getTime()
    : NaN;
  const startDate = Number.isNaN(firstSeenMs)
    ? new Date().toISOString()
    : new Date(firstSeenMs).toISOString();
  // R40-A: the row's latest received-evidence date rides the candidate too
  // (max corpus message date); falls back to the start when only one mail
  // exists (max == min), and to the start's own guarded fallback otherwise.
  const lastSeenMs = candidate.lastReceived
    ? new Date(candidate.lastReceived).getTime()
    : NaN;
  const lastReceivedAt = Number.isNaN(lastSeenMs)
    ? startDate
    : new Date(lastSeenMs).toISOString();
  return {
    id: Date.now().toString(),
    icon: require("@assets/icons/plus.png"),
    icon_key: iconKey,
    name: candidate.merchant,
    category: free ? "free" : candidate.kind,
    status: "active",
    startDate,
    price: known ? candidate.amount! : 0,
    priceUnknown,
    currency: candidate.currency ?? "USD",
    billing: cadence,
    frequency: cadence,
    paymentMethod: candidate.mailboxId,
    // R18 paper-trail: first candidate email + best-effort bill number
    sourceMessageId: candidate.messageIds[0] ?? null,
    billNumber: candidate.billNumber ?? null,
    lastReceivedAt,
  };
}
