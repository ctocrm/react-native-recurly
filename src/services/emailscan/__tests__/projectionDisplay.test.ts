/**
 * R26/DEC-001 reader gates: every projection-backed display function must
 * return exactly what its legacy full-scan counterpart returns over the same
 * fixtures — spend contributions, displayed amounts (all periods), sparse
 * second lines, insights, and the 6-month chart.
 */

import {
  displayedAmount,
  monthlyChartFromMail,
  monthlySpendContribution,
  sparseSecondaryLine,
  thisMonthInsights,
} from "../chargeDisplay";
import {
  projectionDisplayedAmount,
  projectionMonthlyChartFromMail,
  projectionMonthlySpendContribution,
  projectionSparseSecondaryLine,
  projectionThisMonthInsights,
} from "../projectionDisplay";
import { foldActuals } from "../projectionCore";
import type { ClassifiedMessage } from "../types";

let seq = 0;
function charge(
  over: Partial<ClassifiedMessage> & {
    date: string;
    merchantKey: string;
    merchantName: string;
    kind: "recurring" | "sparse";
    amount: number;
  },
): ClassifiedMessage {
  seq += 1;
  return {
    message: {
      mailboxId:
        (over.message as ClassifiedMessage["message"])?.mailboxId ?? "mb1",
      messageId: `m${seq}`,
      from: "no-reply@example.com",
      subject: "Your receipt",
      date: over.date,
    },
    subjectClass: "account",
    merchantKey: over.merchantKey,
    merchantName: over.merchantName,
    kind: over.kind,
    amount: over.amount,
  } as ClassifiedMessage;
}

function sub(name: string, over: Partial<Subscription> = {}): Subscription {
  return {
    id: `sub-${name}`,
    name,
    category: "recurring",
    paymentMethod: "",
    status: "active",
    price: 0,
    priceUnknown: false,
    currency: "USD",
    billing: "Monthly",
    ...over,
  } as unknown as Subscription;
}

const NOW = new Date(2026, 2, 15, 10, 0, 0);

const messages: ClassifiedMessage[] = [
  charge({ date: "2026-01-10T09:00:00", merchantKey: "netflix", merchantName: "Netflix", kind: "recurring", amount: 15.49 }),
  charge({ date: "2026-02-10T09:00:00", merchantKey: "netflix", merchantName: "Netflix", kind: "recurring", amount: 15.49 }),
  charge({ date: "2026-03-10T09:00:00", merchantKey: "netflix", merchantName: "Netflix", kind: "recurring", amount: 15.49 }),
  charge({ date: "2026-03-12T09:00:00", merchantKey: "mcdonalds", merchantName: "McDonald's", kind: "sparse", amount: 9.4 }),
  charge({ date: "2026-03-13T09:00:00", merchantKey: "mcdonalds", merchantName: "McDonald's", kind: "sparse", amount: 12.1, message: { mailboxId: "mb2" } as ClassifiedMessage["message"] }),
  charge({ date: "2026-01-20T09:00:00", merchantKey: "steam", merchantName: "Steam", kind: "sparse", amount: 59.99 }),
  charge({ date: "2025-12-25T09:00:00", merchantKey: "steam", merchantName: "Steam", kind: "sparse", amount: 29.99 }),
];

const actuals = foldActuals(
  messages.map((m) => ({
    merchantKey: m.merchantKey,
    merchantName: m.merchantName,
    mailboxId: m.message.mailboxId,
    kind: m.kind as string,
    amount: m.amount as number,
    date: m.message.date,
  })),
);

const subs: Subscription[] = [
  sub("Netflix", { price: 15.49 }),
  sub("McDonald's", { category: "sparse", paymentMethod: "mb1" }),
  sub("Steam", { category: "sparse", paymentMethod: "mb1", price: 39.99 }),
  sub("Porkbun", { category: "sparse", paymentMethod: "mb1", price: 47.74, billing: "Yearly" }),
  sub("UnknownPrice", { name: "Netflix", priceUnknown: true }),
  sub("FreeTier", { name: "Steam", category: "free" }),
  sub("CancelledNetflix", { name: "Netflix", price: 15.49, status: "cancelled" }),
];

describe("projection readers ≡ legacy over identical fixtures", () => {
  it("monthlySpendContribution matches per sub", () => {
    for (const s of subs) {
      expect(projectionMonthlySpendContribution(s, actuals, NOW)).toBe(
        monthlySpendContribution(s, messages, NOW),
      );
    }
  });

  it("displayedAmount matches per sub across all periods", () => {
    const periods = ["weekly", "monthly", "yearly", "week", "month", "year"] as const;
    for (const s of subs) {
      for (const period of periods) {
        expect(projectionDisplayedAmount(s, period, actuals, NOW)).toEqual(
          displayedAmount(s, period, messages, NOW),
        );
      }
    }
  });

  it("sparseSecondaryLine matches per sub", () => {
    for (const s of subs) {
      expect(projectionSparseSecondaryLine(s, actuals, NOW)).toEqual(
        sparseSecondaryLine(s, messages, NOW),
      );
    }
  });

  it("thisMonthInsights matches", () => {
    expect(projectionThisMonthInsights(subs, actuals, NOW)).toEqual(
      thisMonthInsights(subs, messages, NOW),
    );
  });

  it("monthly chart matches at 1/3/6/12 months", () => {
    for (const monthsToShow of [1, 3, 6, 12]) {
      expect(
        projectionMonthlyChartFromMail(subs, actuals, monthsToShow, NOW),
      ).toEqual(monthlyChartFromMail(subs, messages, monthsToShow, NOW));
    }
  });
});