/**
 * R26 / DEC-001: projection-backed display readers. Each function mirrors a
 * legacy chargeDisplay function charge-for-charge (same matcher via bucket
 * lookups: slug + name − both, same mailbox filter, same windows) so the two
 * paths can be audited side by side at runtime.
 */
import { nameToSlug } from "@/services/iconScraper";
import { bothBucketKey, type MerchantDayActual } from "./projectionCore";
import {
  convertStoredPrice,
  displayPeriodLabel,
  spendKind,
  storedCadence,
  windowForPeriod,
  type DisplayPeriod,
  type SpendKind,
} from "./chargeDisplay";

function sumBuckets(
  subscription: Subscription,
  actuals: MerchantDayActual[],
  kind: "recurring" | "sparse",
  start: Date,
  end: Date,
  withCounts: boolean,
): number | { total: number; count: number; unknown: number } {
  const S = nameToSlug(subscription.name);
  const L = subscription.name.toLowerCase();
  let total = 0;
  let count = 0;
  let unknown = 0;
  for (const a of actuals) {
    if (a.kind !== kind) continue;
    if (
      subscription.paymentMethod &&
      a.mailboxId !== subscription.paymentMethod
    ) {
      continue;
    }
    const [y, m, d] = a.day.split("-").map(Number);
    const dayStart = new Date(y, m - 1, d);
    const dayEnd = new Date(y, m - 1, d, 23, 59, 59, 999);
    if (dayEnd < start || dayStart > end) continue;
    if (a.bucketType === "slug" && a.bucketKey === S) {
      total += a.total;
      count += a.count;
      unknown += a.unknownCount ?? 0;
    } else if (a.bucketType === "name" && a.bucketKey === L) {
      total += a.total;
      count += a.count;
      unknown += a.unknownCount ?? 0;
    } else if (a.bucketType === "both" && a.bucketKey === bothBucketKey(S, L)) {
      total -= a.total;
      count -= a.count;
      unknown -= a.unknownCount ?? 0;
    }
  }
  return withCounts ? { total, count, unknown } : total;
}

function explicitCadence(sub: Subscription): string | null {
  const allowed = new Set(["Yearly", "Monthly", "Weekly"]);
  if (sub.billing && allowed.has(sub.billing)) return sub.billing;
  if (sub.frequency && allowed.has(sub.frequency)) return sub.frequency;
  return null;
}

/** `matchesSubscription` ∩ window, summed from buckets. */
export function projectionSumChargesInWindow(
  sub: Subscription,
  actuals: MerchantDayActual[],
  start: Date,
  end: Date,
): number {
  const kind = sub.category === "sparse" ? "sparse" : "recurring";
  return sumBuckets(sub, actuals, kind, start, end, false) as number;
}

export function projectionSparseActuals(
  sub: Subscription,
  actuals: MerchantDayActual[],
  period: "week" | "month" | "year",
  now = new Date(),
): number {
  const { start, end } = windowForPeriod(period, now);
  return projectionSumChargesInWindow(sub, actuals, start, end);
}

export function projectionSparseSecondaryLine(
  sub: Subscription,
  actuals: MerchantDayActual[],
  now = new Date(),
): { amount: number; label: string } | null {
  if (sub.category === "sparse" || sub.category === "free") return null;
  const { start, end } = windowForPeriod("month", now);
  const { total, count } = sumBuckets(
    sub,
    actuals,
    "sparse",
    start,
    end,
    true,
  ) as { total: number; count: number; unknown: number };
  if (count === 0) return null;
  return { amount: total, label: "Sparse" };
}

export function projectionMonthlySpendContribution(
  sub: Subscription,
  actuals: MerchantDayActual[],
  now = new Date(),
): number {
  if (sub.status === "cancelled" ||
    sub.status === "paused" || sub.status === "archived") return 0;
  if (sub.category === "sparse" && sub.paymentMethod) {
    return projectionSparseActuals(sub, actuals, "month", now);
  }
  if (sub.priceUnknown || sub.category === "free") return 0;
  return convertStoredPrice(sub.price, storedCadence(sub), "monthly");
}

export function projectionDisplayedAmount(
  sub: Subscription,
  period: DisplayPeriod,
  actuals: MerchantDayActual[],
  now = new Date(),
): { amount: number; unknown: boolean; label: string } {
  const label = displayPeriodLabel(period);
  if (sub.category === "free") {
    return { amount: 0, unknown: false, label };
  }
  if (sub.category === "sparse") {
    const explicit = explicitCadence(sub);
    // Mirror of chargeDisplay.displayedAmount (paid-unknown rule, 2026-09-16):
    // billed sparse rows render their own cadence ("Monthly ?" when the price
    // is unreadable); actuals windows render the known sum and "?" only when
    // the window contains a paid-unknown charge.
    if (explicit) {
      return {
        amount: sub.priceUnknown ? 0 : sub.price,
        unknown: Boolean(sub.priceUnknown),
        label: explicit,
      };
    }
    if (period !== "week" && period !== "month" && period !== "year") {
      return projectionDisplayedAmount(sub, "month", actuals, now);
    }
    const { start, end } = windowForPeriod(period, now);
    const { total: amount, unknown } = sumBuckets(
      sub,
      actuals,
      "sparse",
      start,
      end,
      true,
    ) as { total: number; unknown: number };
    return { amount, unknown: unknown > 0, label };
  }
  if (sub.priceUnknown) {
    return { amount: 0, unknown: true, label: explicitCadence(sub) ?? label };
  }
  const target: "yearly" | "weekly" | "monthly" =
    period === "yearly" ? "yearly" : period === "weekly" ? "weekly" : "monthly";
  return {
    amount: convertStoredPrice(sub.price, storedCadence(sub), target),
    unknown: false,
    label,
  };
}

export function projectionThisMonthInsights(
  subscriptions: Subscription[],
  actuals: MerchantDayActual[],
  now = new Date(),
): {
  total: number;
  count: number;
  kinds: Record<SpendKind, number>;
  merchants: { name: string; amount: number; kind: SpendKind }[];
} {
  const kinds: Record<SpendKind, number> = {
    recurring: 0,
    sparse: 0,
    free: 0,
  };
  const merchants: { name: string; amount: number; kind: SpendKind }[] = [];
  let count = 0;
  for (const sub of subscriptions) {
    if (sub.status === "cancelled" ||
    sub.status === "paused" || sub.status === "archived") continue;
    count += 1;
    const kind = spendKind(sub);
    const amount = projectionMonthlySpendContribution(sub, actuals, now);
    kinds[kind] += amount;
    merchants.push({ name: sub.name, amount, kind });
  }
  merchants.sort((a, b) => b.amount - a.amount);
  return {
    total: kinds.recurring + kinds.sparse + kinds.free,
    count,
    kinds,
    merchants,
  };
}

const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function monthWindow(year: number, monthIndex: number): {
  start: Date;
  end: Date;
} {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function projectionMonthlyChartFromMail(
  subscriptions: Subscription[],
  actuals: MerchantDayActual[],
  monthsToShow: number,
  now = new Date(),
): { label: string; amount: number; estimated: boolean }[] {
  const bars: { label: string; amount: number; estimated: boolean }[] = [];
  for (let i = monthsToShow - 1; i >= 0; i -= 1) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const { start, end } = monthWindow(cursor.getFullYear(), cursor.getMonth());
    let amount = 0;
    for (const sub of subscriptions) {
      if (sub.status === "cancelled" ||
    sub.status === "paused" || sub.status === "archived") continue;
      if (sub.category === "sparse" && sub.paymentMethod) {
        amount += projectionSumChargesInWindow(sub, actuals, start, end);
        continue;
      }
      if (sub.priceUnknown || sub.category === "free") continue;
      const mailTotal = projectionSumChargesInWindow(sub, actuals, start, end);
      amount +=
        mailTotal > 0
          ? mailTotal
          : convertStoredPrice(sub.price, storedCadence(sub), "monthly");
    }
    bars.push({
      label: MONTH_LABELS[cursor.getMonth()],
      amount,
      estimated: i > 0,
    });
  }
  return bars;
}
