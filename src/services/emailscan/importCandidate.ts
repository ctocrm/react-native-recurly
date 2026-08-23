/**
 * Explicit import only. Scan never auto-creates subscriptions.
 */
import type { ScanCandidate } from "./types";

export function candidateToSubscription(
  candidate: ScanCandidate,
): Subscription {
  const cadence =
    candidate.cadence === "yearly"
      ? "Yearly"
      : candidate.cadence === "monthly"
        ? "Monthly"
        : "Monthly";
  const known = candidate.amount !== undefined;
  const priceUnknown = !known && candidate.kind !== "free";
  return {
    id: Date.now().toString(),
    icon: require("@assets/icons/plus.png"),
    icon_key: "plus",
    name: candidate.merchant,
    category: candidate.kind,
    status: "active",
    startDate: new Date().toISOString(),
    price: known ? candidate.amount! : 0,
    priceUnknown,
    currency: candidate.currency ?? "USD",
    billing: cadence,
    frequency: cadence,
    paymentMethod: candidate.mailboxId,
  };
}
