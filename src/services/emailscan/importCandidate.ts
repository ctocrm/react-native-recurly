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
  return {
    id: Date.now().toString(),
    icon: require("@assets/icons/plus.png"),
    icon_key: iconKey,
    name: candidate.merchant,
    category: free ? "free" : candidate.kind,
    status: "active",
    startDate: new Date().toISOString(),
    price: known ? candidate.amount! : 0,
    priceUnknown,
    currency: candidate.currency ?? "USD",
    billing: cadence,
    frequency: cadence,
    paymentMethod: candidate.mailboxId,
    // R18 paper-trail: first candidate email + best-effort bill number
    sourceMessageId: candidate.messageIds[0] ?? null,
    billNumber: candidate.billNumber ?? null,
  };
}
