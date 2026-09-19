/**
 * R40-A: evidence-derived list ordering.
 *
 * The user's directive (2026-09-19): "most recent" means the most recent
 * RECEIVED EMAIL, never the scan/import wall-clock. Every date here traces
 * to row evidence: lastReceivedAt (max corpus message date, written at
 * scan/mint/repair time), start_date (earliest corpus message date),
 * renewal_date (user- or provider-derived). No Date.now() enters a row.
 */

export const SUBS_SORT_OPTIONS = [
  "recent",
  "oldest",
  "sparse",
  "recurring",
  "next",
] as const;

export type SubsSort = (typeof SUBS_SORT_OPTIONS)[number];

export const SUBS_SORT_LABELS: Record<SubsSort, string> = {
  recent: "Recent",
  oldest: "Oldest",
  sparse: "Sparse",
  recurring: "Recurring",
  next: "Next charge",
};

/** The row's received-evidence date (max → min fallback). Null = none. */
export function receivedEvidenceDate(sub: {
  lastReceivedAt?: string | null;
  startDate?: string;
}): string | null {
  return sub.lastReceivedAt ?? sub.startDate ?? null;
}

type SortableSub = Pick<
  Subscription,
  "category" | "billing" | "frequency" | "status" | "renewalDate" | "startDate"
> & { lastReceivedAt?: string | null };

const CADENCE_MS: Record<string, number> = {
  Weekly: 7 * 24 * 3600 * 1000,
  Monthly: 30 * 24 * 3600 * 1000,
  Yearly: 365 * 24 * 3600 * 1000,
};

/** The row's explicit cadence label, or null when none was evidenced. */
function explicitCadence(sub: SortableSub): string | null {
  const allowed = new Set(["Weekly", "Monthly", "Yearly"]);
  if (sub.billing && allowed.has(sub.billing)) return sub.billing;
  if (sub.frequency && allowed.has(sub.frequency)) return sub.frequency;
  return null;
}

/**
 * The next expected charge date, derived from row evidence only:
 * - renewalDate (projected forward when past — a lapsed row still charges
 *   again on its cadence),
 * - else startDate + k×cadence for recurring rows with an explicit cadence,
 * - null for sparse/free/unknown-cadence rows (no charge is "expected").
 * Never mutates rows; display-only (mirrors chargeDisplay's contract).
 */
export function nextExpectedChargeFor(
  sub: SortableSub,
  now: Date = new Date(),
): Date | null {
  if (sub.status === "cancelled" || sub.status === "paused") return null;
  const cadence = explicitCadence(sub);
  const step = cadence ? CADENCE_MS[cadence] : null;
  if (!step) return null;
  const anchorIso = sub.renewalDate ?? sub.startDate;
  if (!anchorIso) return null;
  let t = new Date(anchorIso).getTime();
  if (Number.isNaN(t)) return null;
  // Project forward in whole periods until strictly after `now` (bounded).
  for (let i = 0; i < 1000 && t <= now.getTime(); i++) t += step;
  return new Date(t);
}

/**
 * Sort rows for the subscriptions list. Stable: rows with equal (or null)
 * keys keep their DB order (which is already received-evidence DESC).
 */
export function sortSubscriptions<T extends SortableSub>(
  rows: T[],
  sort: SubsSort,
  now: Date = new Date(),
): T[] {
  const evidence = (sub: T): number => {
    const iso = receivedEvidenceDate(sub);
    const t = iso ? new Date(iso).getTime() : NaN;
    return Number.isNaN(t) ? Number.NEGATIVE_INFINITY : t;
  };
  const nextCharge = (sub: T): number => {
    const d = nextExpectedChargeFor(sub, now);
    return d ? d.getTime() : Number.POSITIVE_INFINITY;
  };
  const byEvidenceDesc = (a: T, b: T) => evidence(b) - evidence(a);

  const sorted = [...rows];
  switch (sort) {
    case "oldest":
      // Undated rows are "unknown recency", not "oldest known" — they sit
      // last in both directions.
      sorted.sort(
        (a, b) =>
          (Number.isFinite(evidence(a)) ? 0 : 1) -
            (Number.isFinite(evidence(b)) ? 0 : 1) || evidence(a) - evidence(b),
      );
      break;
    case "sparse":
      sorted.sort(
        (a, b) =>
          (a.category === "sparse" ? 0 : 1) - (b.category === "sparse" ? 0 : 1) ||
          byEvidenceDesc(a, b),
      );
      break;
    case "recurring":
      sorted.sort(
        (a, b) =>
          (a.category === "recurring" ? 0 : 1) -
            (b.category === "recurring" ? 0 : 1) || byEvidenceDesc(a, b),
      );
      break;
    case "next":
      sorted.sort((a, b) => nextCharge(a) - nextCharge(b));
      break;
    case "recent":
    default:
      sorted.sort(byEvidenceDesc);
      break;
  }
  return sorted;
}
