/**
 * Display-only period math for Home/Subscriptions cards.
 * Stored billing/frequency is never rewritten here.
 */
import { nameToSlug } from "@/services/iconScraper";
import type { ClassifiedMessage } from "./types";

/** R23: nameToSlug is 5+ regex passes; matchesSubscription runs it once per
 * (subscription, cached hit) pair — 125 subs × 2209 hits re-slugged the same
 * names ~276k times and the post-load recompute took ~14.5s on cold boot.
 * Merchant names are few and stable: memoize. */
const slugCache = new Map<string, string>();
function cachedSlug(name: string): string {
  let slug = slugCache.get(name);
  if (slug === undefined) {
    slug = nameToSlug(name);
    slugCache.set(name, slug);
  }
  return slug;
}

/**
 * R25: every display computation (monthly spend, per-card sparse lines,
 * insights, the 6-month chart) used to scan ALL messages per subscription —
 * 125 × 2209 pair checks (6× that for the chart) ≈ millions of
 * matchesSubscription calls, ~8.5s of JS-thread freeze when messages land
 * at boot. Merchant names are few and stable: index messages by
 * (merchantKey, kind) + lowercase name once per messages array (WeakMap on
 * identity — the loader replaces the array rather than mutating it), so
 * each subscription only visits its own merchant's hits.
 */
interface MerchantBuckets {
  recurring: ClassifiedMessage[];
  sparse: ClassifiedMessage[];
}
interface MerchantIndex {
  bySlug: Map<string, MerchantBuckets>;
  byLowerName: Map<string, MerchantBuckets>;
}
const merchantIndexCache = new WeakMap<ClassifiedMessage[], MerchantIndex>();

function merchantIndex(messages: ClassifiedMessage[]): MerchantIndex {
  const existing = merchantIndexCache.get(messages);
  if (existing) return existing;
  const index: MerchantIndex = {
    bySlug: new Map(),
    byLowerName: new Map(),
  };
  for (const hit of messages) {
    if (hit.kind !== "recurring" && hit.kind !== "sparse") continue;
    // Paid-unknown hits (amount undefined, 2026-09-16) stay indexed: the
    // window anchoring reader must see them. Sum paths are unaffected —
    // matchesSubscription and the secondary-line walker skip them.
    let slugBuckets = index.bySlug.get(hit.merchantKey);
    if (!slugBuckets) {
      slugBuckets = { recurring: [], sparse: [] };
      index.bySlug.set(hit.merchantKey, slugBuckets);
    }
    slugBuckets[hit.kind].push(hit);
    const lowerName = hit.merchantName.toLowerCase();
    if (lowerName !== hit.merchantKey) {
      let nameBuckets = index.byLowerName.get(lowerName);
      if (!nameBuckets) {
        nameBuckets = { recurring: [], sparse: [] };
        index.byLowerName.set(lowerName, nameBuckets);
      }
      nameBuckets[hit.kind].push(hit);
    }
  }
  merchantIndexCache.set(messages, index);
  return index;
}

/** The only hits that could possibly match `sub` (its merchant's messages
 * of `wantKind` — default: the stream kind the row consumes), in stable
 * order. Callers still run the full per-hit checks — this only removes the
 * other ~2190 misses. */
function matchCandidates(
  sub: Subscription,
  messages: ClassifiedMessage[],
  wantKind?: "recurring" | "sparse",
): ClassifiedMessage[] {
  const kind = wantKind ?? (isSparseSubscription(sub) ? "sparse" : "recurring");
  const index = merchantIndex(messages);
  const key = cachedSlug(sub.name);
  const primary = index.bySlug.get(key)?.[kind] ?? [];
  const lowerName = sub.name.toLowerCase();
  const secondary =
    lowerName === key
      ? []
      : (index.byLowerName.get(lowerName)?.[kind] ?? []);
  if (secondary.length === 0) return primary;
  if (primary.length === 0) return secondary;
  const seen = new Set(primary);
  return [...primary, ...secondary.filter((hit) => !seen.has(hit))];
}

export type RecurringDisplayPeriod = "weekly" | "monthly" | "yearly";
export type SparseDisplayPeriod = "week" | "month" | "year";
export type DisplayPeriod = RecurringDisplayPeriod | SparseDisplayPeriod;

export function isSparseSubscription(sub: Subscription): boolean {
  return sub.category === "sparse";
}

/** "Yearly" | "Monthly" | "Weekly" when the row carries an explicit cadence
 * (scan-detected or user-set); null when unknown/missing. */
function explicitCadenceLabel(sub: Subscription): string | null {
  const allowed = new Set(["Yearly", "Monthly", "Weekly"]);
  if (sub.billing && allowed.has(sub.billing)) return sub.billing;
  if (sub.frequency && allowed.has(sub.frequency)) return sub.frequency;
  return null;
}

/** R18: the card defaults to the subscription's OWN cadence. A sparse row
 * with an explicit cadence (Porkbun: Yearly) is shown as-billed instead of
 * being forced into a this-month actuals window. */
export function defaultDisplayPeriod(sub: Subscription): DisplayPeriod {
  const explicit = explicitCadenceLabel(sub);
  if (explicit === "Yearly") return isSparseSubscription(sub) ? "year" : "yearly";
  if (explicit === "Weekly") return isSparseSubscription(sub) ? "week" : "weekly";
  if (explicit === "Monthly") {
    return isSparseSubscription(sub) ? "month" : "monthly";
  }
  if (isSparseSubscription(sub)) return "month";
  return "monthly";
}

export function nextDisplayPeriod(
  sub: Subscription,
  current: DisplayPeriod,
): DisplayPeriod {
  if (isSparseSubscription(sub)) {
    if (current === "week") return "month";
    if (current === "month") return "year";
    return "week";
  }
  if (current === "monthly") return "yearly";
  if (current === "yearly") return "weekly";
  return "monthly";
}

export function displayPeriodLabel(period: DisplayPeriod): string {
  if (period === "week") return "This week";
  if (period === "month") return "This month";
  if (period === "year") return "This year";
  if (period === "yearly") return "Yearly";
  if (period === "weekly") return "Weekly";
  return "Monthly";
}

export function convertStoredPrice(
  price: number,
  stored: RecurringDisplayPeriod,
  target: RecurringDisplayPeriod,
): number {
  if (stored === target) return price;
  // Pivot through a monthly rate; weekly↔monthly uses 52/12 weeks per month.
  const WPM = 52 / 12;
  const monthlyRate =
    stored === "weekly" ? price * WPM : stored === "yearly" ? price / 12 : price;
  if (target === "weekly") return monthlyRate / WPM;
  if (target === "yearly") return monthlyRate * 12;
  return monthlyRate;
}

export function storedCadence(sub: Subscription): RecurringDisplayPeriod {
  if (sub.billing === "Yearly" || sub.frequency === "Yearly") return "yearly";
  if (sub.billing === "Weekly" || sub.frequency === "Weekly") return "weekly";
  return "monthly";
}

function startOfWeek(now: Date): Date {
  const start = new Date(now);
  const day = start.getDay();
  const diff = (day + 6) % 7;
  start.setDate(start.getDate() - diff);
  start.setHours(0, 0, 0, 0);
  return start;
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function startOfYear(now: Date): Date {
  return new Date(now.getFullYear(), 0, 1);
}

export function windowForPeriod(
  period: SparseDisplayPeriod,
  now = new Date(),
): { start: Date; end: Date } {
  if (period === "week") return { start: startOfWeek(now), end: now };
  if (period === "year") return { start: startOfYear(now), end: now };
  return { start: startOfMonth(now), end: now };
}

export function matchesSubscription(
  hit: ClassifiedMessage,
  sub: Subscription,
): boolean {
  if (hit.kind !== "recurring" && hit.kind !== "sparse") return false;
  if (hit.amount === undefined) return false;
  // R18: a row only ever matches hits of its OWN stream — a sparse row's
  // actuals must not swallow the merchant's subscription charges, and a
  // recurring row must not count the merchant's one-off purchases.
  if (isSparseSubscription(sub) && hit.kind !== "sparse") return false;
  if (!isSparseSubscription(sub) && hit.kind !== "recurring") return false;
  const mailbox = sub.paymentMethod;
  if (mailbox && hit.message.mailboxId !== mailbox) return false;
  const key = cachedSlug(sub.name);
  return (
    hit.merchantKey === key ||
    hit.merchantName.toLowerCase() === sub.name.toLowerCase()
  );
}

export function sumChargesInWindow(
  sub: Subscription,
  messages: ClassifiedMessage[],
  start: Date,
  end: Date,
): number {
  let total = 0;
  for (const hit of matchCandidates(sub, messages)) {
    if (!matchesSubscription(hit, sub)) continue;
    const charged = new Date(hit.message.date);
    if (Number.isNaN(charged.getTime())) continue;
    if (charged < start || charged > end) continue;
    total += hit.amount ?? 0;
  }
  return total;
}

export function sparseActuals(
  sub: Subscription,
  messages: ClassifiedMessage[],
  period: SparseDisplayPeriod,
  now = new Date(),
): number {
  const { start, end } = windowForPeriod(period, now);
  return sumChargesInWindow(sub, messages, start, end);
}

/** R18: the stacked second card line — this calendar month's sparse
 * purchases for a subscription's own merchant+mailbox. Null when the
 * merchant has no sparse activity at all ("only show sparse if it's sparse
 * at all"). Recurring rows only: a pure-sparse card IS the sparse line. */
export function sparseSecondaryLine(
  sub: Subscription,
  messages: ClassifiedMessage[],
  now = new Date(),
): { amount: number; label: string } | null {
  if (isSparseSubscription(sub) || sub.category === "free") return null;
  const { start, end } = windowForPeriod("month", now);
  const mailbox = sub.paymentMethod;
  const key = cachedSlug(sub.name);
  let total = 0;
  let any = false;
  for (const hit of matchCandidates(sub, messages, "sparse")) {
    if (hit.kind !== "sparse") continue;
    if (hit.amount === undefined) continue;
    if (mailbox && hit.message.mailboxId !== mailbox) continue;
    if (
      hit.merchantKey !== key &&
      hit.merchantName.toLowerCase() !== sub.name.toLowerCase()
    ) {
      continue;
    }
    const charged = new Date(hit.message.date);
    if (Number.isNaN(charged.getTime())) continue;
    if (charged < start || charged > end) continue;
    any = true;
    total += hit.amount ?? 0;
  }
  if (!any) return null;
  return { amount: total, label: "Sparse" };
}

/** Paid-unknown anchoring (2026-09-16): count the sparse charges in the
 * window whose merchant/mailbox evidence matches `sub` but whose amount is
 * unreadable — a proven payment we cannot price (Tuta-invoice class). These
 * hits are excluded from `matchesSubscription` sums, so this walks them
 * separately: their presence in a window is what makes "?" honest there. */
function sparseUnknownChargesInWindow(
  sub: Subscription,
  messages: ClassifiedMessage[],
  start: Date,
  end: Date,
): number {
  let unknown = 0;
  for (const hit of matchCandidates(sub, messages, "sparse")) {
    if (hit.kind !== "sparse") continue;
    if (hit.amount !== undefined) continue;
    const mailbox = sub.paymentMethod;
    if (mailbox && hit.message.mailboxId !== mailbox) continue;
    const key = cachedSlug(sub.name);
    if (
      hit.merchantKey !== key &&
      hit.merchantName.toLowerCase() !== sub.name.toLowerCase()
    ) {
      continue;
    }
    const charged = new Date(hit.message.date);
    if (Number.isNaN(charged.getTime())) continue;
    if (charged < start || charged > end) continue;
    unknown += 1;
  }
  return unknown;
}

export function displayedAmount(
  sub: Subscription,
  period: DisplayPeriod,
  messages: ClassifiedMessage[],
  now = new Date(),
): { amount: number; unknown: boolean; label: string } {
  const label = displayPeriodLabel(period);
  if (sub.category === "free") {
    return { amount: 0, unknown: false, label };
  }
  if (isSparseSubscription(sub)) {
    // R18: a sparse row with an explicit cadence is shown AS BILLED — its own
    // billing label, not a this-month actuals window that reads $0 / "?"
    // eleven months of the year. 2026-09-16: an unreadable price keeps the
    // billing label too ("Monthly ?" / "Yearly ?") — "?" rides the billing
    // cadence, never an actuals window.
    const explicit = explicitCadenceLabel(sub);
    if (explicit) {
      return {
        amount: sub.priceUnknown ? 0 : sub.price,
        unknown: Boolean(sub.priceUnknown),
        label: explicit,
      };
    }
    if (period !== "week" && period !== "month" && period !== "year") {
      return displayedAmount(sub, "month", messages, now);
    }
    const amount = sparseActuals(sub, messages, period, now);
    // Paid-unknown rule: "?" only when the window itself contains a proven
    // payment whose amount we could not read; an empty window is $0.00.
    const { start, end } = windowForPeriod(period, now);
    const unknown = sparseUnknownChargesInWindow(sub, messages, start, end) > 0;
    return { amount, unknown, label };
  }
  if (sub.priceUnknown) {
    // Recurring rows do pay every cycle — the honest "?" carries the billing
    // cadence ("Monthly ?"), not the actuals-window label.
    return { amount: 0, unknown: true, label: explicitCadenceLabel(sub) ?? label };
  }
  const target: RecurringDisplayPeriod =
    period === "yearly"
      ? "yearly"
      : period === "weekly"
        ? "weekly"
        : "monthly";
  return {
    amount: convertStoredPrice(sub.price, storedCadence(sub), target),
    unknown: false,
    label,
  };
}

/** Home Monthly Spend: recurring amortized + sparse this-month actuals. */
export function monthlySpendContribution(
  sub: Subscription,
  messages: ClassifiedMessage[],
  now = new Date(),
): number {
  if (sub.status === "cancelled" || sub.status === "paused") return 0;
  if (isSparseSubscription(sub) && sub.paymentMethod) {
    return sparseActuals(sub, messages, "month", now);
  }
  if (sub.priceUnknown || sub.category === "free") return 0;
  return convertStoredPrice(sub.price, storedCadence(sub), "monthly");
}

export type SpendKind = "recurring" | "sparse" | "free";

export function spendKind(sub: Subscription): SpendKind {
  if (sub.category === "sparse") return "sparse";
  if (sub.category === "free") return "free";
  return "recurring";
}

export function thisMonthInsights(
  subscriptions: Subscription[],
  messages: ClassifiedMessage[],
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
    if (sub.status === "cancelled" || sub.status === "paused") continue;
    count += 1;
    const kind = spendKind(sub);
    const amount = monthlySpendContribution(sub, messages, now);
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

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function monthWindow(year: number, monthIndex: number): {
  start: Date;
  end: Date;
} {
  const start = new Date(year, monthIndex, 1);
  const end = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
  return { start, end };
}

export function monthlyChartFromMail(
  subscriptions: Subscription[],
  messages: ClassifiedMessage[],
  monthsToShow: number,
  now = new Date(),
): { label: string; amount: number; estimated: boolean }[] {
  const bars: { label: string; amount: number; estimated: boolean }[] = [];
  for (let i = monthsToShow - 1; i >= 0; i--) {
    const cursor = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const { start, end } = monthWindow(cursor.getFullYear(), cursor.getMonth());
    let amount = 0;
    for (const sub of subscriptions) {
      if (sub.status === "cancelled" || sub.status === "paused") continue;
      if (isSparseSubscription(sub) && sub.paymentMethod) {
        amount += sumChargesInWindow(sub, messages, start, end);
        continue;
      }
      if (sub.priceUnknown || sub.category === "free") continue;
      const mailTotal = sumChargesInWindow(sub, messages, start, end);
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