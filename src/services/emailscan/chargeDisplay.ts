/**
 * Display-only period math for Home/Subscriptions cards.
 * Stored billing/frequency is never rewritten here.
 */
import { nameToSlug } from "@/services/iconScraper";
import type { ClassifiedMessage } from "./types";

export type RecurringDisplayPeriod = "monthly" | "yearly";
export type SparseDisplayPeriod = "week" | "month" | "year";
export type DisplayPeriod = RecurringDisplayPeriod | SparseDisplayPeriod;

export function isSparseSubscription(sub: Subscription): boolean {
  return sub.category === "sparse";
}

export function defaultDisplayPeriod(sub: Subscription): DisplayPeriod {
  if (isSparseSubscription(sub)) return "month";
  if (sub.billing === "Yearly" || sub.frequency === "Yearly") return "yearly";
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
  return current === "yearly" ? "monthly" : "yearly";
}

export function displayPeriodLabel(period: DisplayPeriod): string {
  if (period === "week") return "This week";
  if (period === "month") return "This month";
  if (period === "year") return "This year";
  if (period === "yearly") return "Yearly";
  return "Monthly";
}

export function convertStoredPrice(
  price: number,
  stored: RecurringDisplayPeriod,
  target: RecurringDisplayPeriod,
): number {
  if (stored === target) return price;
  if (stored === "monthly" && target === "yearly") return price * 12;
  return price / 12;
}

export function storedCadence(sub: Subscription): RecurringDisplayPeriod {
  return sub.billing === "Yearly" || sub.frequency === "Yearly"
    ? "yearly"
    : "monthly";
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
  const mailbox = sub.paymentMethod;
  if (mailbox && hit.message.mailboxId !== mailbox) return false;
  const key = nameToSlug(sub.name);
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
  for (const hit of messages) {
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
  if (isSparseSubscription(sub) && sub.paymentMethod) {
    if (period !== "week" && period !== "month" && period !== "year") {
      return displayedAmount(sub, "month", messages, now);
    }
    const amount = sparseActuals(sub, messages, period, now);
    const unknown = amount === 0 && Boolean(sub.priceUnknown);
    return { amount, unknown, label };
  }
  if (sub.priceUnknown) {
    return { amount: 0, unknown: true, label };
  }
  const target: RecurringDisplayPeriod =
    period === "yearly" ? "yearly" : "monthly";
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