import {
  convertStoredPrice,
  defaultDisplayPeriod,
  displayedAmount,
  displayPeriodLabel,
  matchesSubscription,
  monthlySpendContribution,
  nextDisplayPeriod,
  sparseSecondaryLine,
  thisMonthInsights,
  monthlyChartFromMail,
} from "../chargeDisplay";
import type { ClassifiedMessage } from "../types";

const porkbun: Subscription = {
  id: "porkbun",
  icon: 0 as never,
  name: "Porkbun",
  category: "sparse",
  status: "active",
  price: 47.74,
  currency: "USD",
  billing: "Yearly",
  frequency: "Yearly",
  paymentMethod: "tuta:picksandshovels@tutamail.com",
};

const proton: Subscription = {
  id: "proton",
  icon: 0 as never,
  name: "Proton",
  category: "recurring",
  status: "active",
  price: 29.98,
  currency: "USD",
  billing: "Monthly",
  frequency: "Monthly",
  paymentMethod: "proton:david@picksandshovels.app",
};

// Sparse merchant with NO known cadence — keeps the actuals-window behavior.
const sparseNoCadence: Subscription = {
  id: "xai",
  icon: 0 as never,
  name: "XAI",
  category: "sparse",
  status: "active",
  price: 0,
  currency: "USD",
  billing: "",
  frequency: "",
  priceUnknown: true,
  paymentMethod: "tuta:picksandshovels@tutamail.com",
};

function hit(
  merchant: string,
  amount: number,
  date: string,
  mailboxId: string,
  kind: "sparse" | "recurring" = "sparse",
): ClassifiedMessage {
  return {
    message: {
      mailboxId,
      messageId: `${merchant}-${date}`,
      from: `${merchant}@example.com`,
      subject: "invoice",
      date,
    },
    subjectClass: "sparse",
    merchantKey: merchant.toLowerCase(),
    merchantName: merchant,
    kind,
    amount,
    amountUnknown: false,
    needsBody: false,
    evidence: [],
    confidence: "high",
  };
}

describe("charge display periods", () => {
  it("defaults to the subscription's OWN cadence (R18)", () => {
    // sparse + explicit Yearly cadence → as-billed yearly view (Porkbun)
    expect(defaultDisplayPeriod(porkbun)).toBe("year");
    expect(defaultDisplayPeriod(proton)).toBe("monthly");
    expect(
      defaultDisplayPeriod({ ...proton, billing: "Yearly", frequency: "Yearly" }),
    ).toBe("yearly");
    expect(
      defaultDisplayPeriod({ ...proton, billing: "Weekly", frequency: "Weekly" }),
    ).toBe("weekly");
    // sparse without any explicit cadence keeps the actuals default
    expect(defaultDisplayPeriod(sparseNoCadence)).toBe("month");
  });

  it("cycles recurring Monthly→Yearly→Weekly and sparse week/month/year", () => {
    expect(nextDisplayPeriod(proton, "monthly")).toBe("yearly");
    expect(nextDisplayPeriod(proton, "yearly")).toBe("weekly");
    expect(nextDisplayPeriod(proton, "weekly")).toBe("monthly");
    expect(nextDisplayPeriod(porkbun, "week")).toBe("month");
    expect(nextDisplayPeriod(porkbun, "month")).toBe("year");
    expect(nextDisplayPeriod(porkbun, "year")).toBe("week");
  });

  it("converts stored yearly without rewriting cadence", () => {
    expect(convertStoredPrice(47.74, "yearly", "monthly")).toBeCloseTo(
      47.74 / 12,
    );
    expect(convertStoredPrice(29.98, "monthly", "yearly")).toBeCloseTo(
      29.98 * 12,
    );
    expect(convertStoredPrice(10, "weekly", "monthly")).toBeCloseTo(
      10 * (52 / 12),
    );
    expect(convertStoredPrice(120, "yearly", "weekly")).toBeCloseTo(120 / 52);
    expect(displayPeriodLabel("weekly")).toBe("Weekly");
    expect(porkbun.billing).toBe("Yearly");
  });

  it("shows cadence-carrying sparse rows AS BILLED (R18 Porkbun fix)", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const messages = [
      hit("Porkbun", 47.74, "2026-08-10T00:00:00.000Z", porkbun.paymentMethod!),
    ];
    for (const period of ["week", "month", "year"] as const) {
      const view = displayedAmount(porkbun, period, messages, now);
      expect(view.amount).toBeCloseTo(47.74);
      expect(view.label).toBe("Yearly");
      expect(view.unknown).toBe(false);
    }
  });

  it("sums only this-month sparse mail charges when no cadence is known", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const messages = [
      hit(
        "XAI",
        8.75,
        "2026-08-10T00:00:00.000Z",
        sparseNoCadence.paymentMethod!,
      ),
      hit("XAI", 40.0, "2026-02-10T00:00:00.000Z", sparseNoCadence.paymentMethod!),
    ];
    const month = displayedAmount(sparseNoCadence, "month", messages, now);
    expect(month.amount).toBeCloseTo(8.75);
    expect(month.label).toBe("This month");
    const year = displayedAmount(sparseNoCadence, "year", messages, now);
    expect(year.amount).toBeCloseTo(48.75);
    const week = displayedAmount(sparseNoCadence, "week", messages, now);
    expect(week.amount).toBe(0);
  });

  it("renders $0.00 (never ?) for a priceUnknown sparse row with an empty window", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const month = displayedAmount(sparseNoCadence, "month", [], now);
    expect(month.amount).toBe(0);
    expect(month.unknown).toBe(false);
    expect(month.label).toBe("This month");
  });

  it("anchors ? to the window that contains the paid-unknown charge (Tuta rule)", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const messages = [
      // Proven payment, unreadable amount (Tuta-invoice class), THIS month.
      {
        ...hit(
          "XAI",
          0,
          "2026-08-10T00:00:00.000Z",
          sparseNoCadence.paymentMethod!,
        ),
        amount: undefined,
      },
    ];
    const month = displayedAmount(sparseNoCadence, "month", messages, now);
    expect(month.amount).toBe(0);
    expect(month.unknown).toBe(true);
    expect(month.label).toBe("This month");
    // The same payment does not anchor ? to a window that excludes it.
    const week = displayedAmount(sparseNoCadence, "week", messages, now);
    expect(week.amount).toBe(0);
    expect(week.unknown).toBe(false);
  });

  it("keeps the billing label for a billed sparse row with an unreadable price (Yearly ?)", () => {
    const tutaBilledUnknown = { ...porkbun, price: 0, priceUnknown: true };
    const now = new Date("2026-08-24T12:00:00.000Z");
    for (const period of [
      "week",
      "month",
      "year",
      "yearly",
      "weekly",
      "monthly",
    ] as const) {
      const view = displayedAmount(tutaBilledUnknown, period, [], now);
      expect(view.label).toBe("Yearly");
      expect(view.unknown).toBe(true);
    }
  });

  it("renders a recurring priceUnknown row as Monthly ? (billed cadence, not This month)", () => {
    const view = displayedAmount(
      { ...proton, priceUnknown: true },
      "month",
      [],
      new Date("2026-08-24T12:00:00.000Z"),
    );
    expect(view.label).toBe("Monthly");
    expect(view.unknown).toBe(true);
  });

  it("adds recurring amortized + sparse this-month into Monthly Spend", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const messages = [
      hit(
        "Porkbun",
        47.74,
        "2026-08-10T00:00:00.000Z",
        porkbun.paymentMethod!,
      ),
    ];
    const total =
      monthlySpendContribution(proton, messages, now) +
      monthlySpendContribution(porkbun, messages, now);
    expect(total).toBeCloseTo(29.98 + 47.74);
  });

  it("matches only the row's own stream (R18)", () => {
    const sparse = hit(
      "Porkbun",
      47.74,
      "2026-08-10T00:00:00.000Z",
      porkbun.paymentMethod!,
    );
    const recurring = hit(
      "Proton",
      29.98,
      "2026-08-10T00:00:00.000Z",
      proton.paymentMethod!,
      "recurring",
    );
    expect(matchesSubscription(sparse, porkbun)).toBe(true);
    expect(matchesSubscription(sparse, proton)).toBe(false);
    expect(matchesSubscription(recurring, proton)).toBe(true);
    expect(matchesSubscription(recurring, porkbun)).toBe(false);
  });

  it("stacks this month's sparse purchases under a recurring card (R18)", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const messages = [
      hit("Proton", 5.0, "2026-08-02T00:00:00.000Z", proton.paymentMethod!),
      hit("Proton", 3.4, "2026-08-15T00:00:00.000Z", proton.paymentMethod!),
      hit("Proton", 9.99, "2026-07-15T00:00:00.000Z", proton.paymentMethod!),
      hit("Other", 1.0, "2026-08-03T00:00:00.000Z", proton.paymentMethod!),
    ];
    const line = sparseSecondaryLine(proton, messages, now);
    expect(line?.label).toBe("Sparse");
    expect(line?.amount).toBeCloseTo(8.4);
    // last month's purchase only → no sparse line at all
    expect(sparseSecondaryLine(proton, [messages[2]], now)).toBeNull();
    // a pure-sparse card IS the sparse line — never stacked on itself
    expect(sparseSecondaryLine(porkbun, messages, now)).toBeNull();
  });

  it("ranks this-month merchants and kind totals", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const linode: Subscription = {
      ...porkbun,
      id: "linode",
      name: "Linode",
      price: 17,
      billing: "Monthly",
      frequency: "Monthly",
      paymentMethod: "proton:david@picksandshovels.app",
    };
    const messages = [
      hit("Linode", 93, "2026-08-05T00:00:00.000Z", linode.paymentMethod!),
      hit(
        "Porkbun",
        47.74,
        "2026-01-10T00:00:00.000Z",
        porkbun.paymentMethod!,
      ),
    ];
    const insights = thisMonthInsights([proton, linode, porkbun], messages, now);
    expect(insights.total).toBeCloseTo(29.98 + 93);
    expect(insights.kinds.recurring).toBeCloseTo(29.98);
    expect(insights.kinds.sparse).toBeCloseTo(93);
    expect(insights.merchants[0].name).toBe("Linode");
    expect(insights.merchants[0].amount).toBeCloseTo(93);
  });

  it("builds 12-month bars from mail dates plus recurring run-rate", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const messages = [
      hit(
        "Porkbun",
        47.74,
        "2026-01-10T00:00:00.000Z",
        porkbun.paymentMethod!,
      ),
      hit("Linode", 17, "2026-07-05T00:00:00.000Z", "proton:david@picksandshovels.app"),
      hit("Linode", 93, "2026-08-05T00:00:00.000Z", "proton:david@picksandshovels.app"),
    ];
    const linode: Subscription = {
      ...porkbun,
      id: "linode",
      name: "Linode",
      price: 17,
      billing: "Monthly",
      frequency: "Monthly",
      paymentMethod: "proton:david@picksandshovels.app",
    };
    const bars = monthlyChartFromMail(
      [proton, linode, porkbun],
      messages,
      12,
      now,
    );
    expect(bars).toHaveLength(12);
    expect(bars[0].label).toBe("Sep");
    expect(bars[bars.length - 1].label).toBe("Aug");
    const jan = bars.find((b) => b.label === "Jan");
    const jul = bars.find((b) => b.label === "Jul");
    const aug = bars.find((b) => b.label === "Aug");
    expect(jan?.amount).toBeCloseTo(29.98 + 47.74);
    expect(jul?.amount).toBeCloseTo(29.98 + 17);
    expect(aug?.amount).toBeCloseTo(29.98 + 93);
  });
});