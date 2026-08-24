import {
  convertStoredPrice,
  defaultDisplayPeriod,
  displayedAmount,
  monthlySpendContribution,
  nextDisplayPeriod,
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

function hit(
  merchant: string,
  amount: number,
  date: string,
  mailboxId: string,
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
    kind: "sparse",
    amount,
    amountUnknown: false,
    needsBody: false,
    evidence: [],
    confidence: "high",
  };
}

describe("charge display periods", () => {
  it("defaults sparse to this month and recurring to stored cadence", () => {
    expect(defaultDisplayPeriod(porkbun)).toBe("month");
    expect(defaultDisplayPeriod(proton)).toBe("monthly");
    expect(
      defaultDisplayPeriod({ ...proton, billing: "Yearly", frequency: "Yearly" }),
    ).toBe("yearly");
  });

  it("cycles recurring Monthly↔Yearly and sparse week/month/year", () => {
    expect(nextDisplayPeriod(proton, "monthly")).toBe("yearly");
    expect(nextDisplayPeriod(proton, "yearly")).toBe("monthly");
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
    expect(porkbun.billing).toBe("Yearly");
  });

  it("sums only this-month sparse mail charges", () => {
    const now = new Date("2026-08-24T12:00:00.000Z");
    const messages = [
      hit(
        "Porkbun",
        47.74,
        "2026-08-10T00:00:00.000Z",
        porkbun.paymentMethod!,
      ),
      hit(
        "Porkbun",
        8.75,
        "2025-12-01T00:00:00.000Z",
        porkbun.paymentMethod!,
      ),
    ];
    const month = displayedAmount(porkbun, "month", messages, now);
    expect(month.amount).toBeCloseTo(47.74);
    expect(month.label).toBe("This month");
    const year = displayedAmount(porkbun, "year", messages, now);
    expect(year.amount).toBeCloseTo(47.74);
    const week = displayedAmount(porkbun, "week", messages, now);
    expect(week.amount).toBe(0);
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