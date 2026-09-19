/**
 * R35: lapsed-recurring expiry. A recurring row whose last corpus charge is
 * older than one period (+3d slack + grace) is lapsed: chip on the card,
 * excluded from Monthly Spend, out of the Active filter. Prime Video class —
 * cadence correctly monthly, uncharged for months.
 */
import { isLapsedRecurring } from "../lapse";
import {
  lastRecurringChargeDate,
  monthlySpendContribution,
} from "../chargeDisplay";
import {
  projectionLastRecurringChargeDate,
  projectionMonthlySpendContribution,
} from "../projectionDisplay";
import type { MerchantDayActual } from "../projectionCore";
import type { ClassifiedMessage } from "../types";

const prime: Subscription = {
  id: "prime",
  icon: 0 as never,
  name: "Primevideo",
  category: "recurring",
  status: "active",
  price: 11.99,
  currency: "USD",
  billing: "Monthly",
  frequency: "Monthly",
  paymentMethod: "workspace:mail",
};

function hit(
  merchant: string,
  amount: number,
  date: string,
  kind: "sparse" | "recurring" = "recurring",
): ClassifiedMessage {
  return {
    message: {
      mailboxId: "workspace:mail",
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

function bucket(
  day: string,
  kind: "recurring" | "sparse" = "recurring",
  total = 11.99,
): MerchantDayActual {
  return {
    bucketType: "slug",
    bucketKey: "primevideo",
    mailboxId: "workspace:mail",
    kind,
    day,
    total,
    count: 1,
    unknownCount: 0,
  };
}

const NOW = new Date("2026-09-18T12:00:00.000Z");

describe("isLapsedRecurring", () => {
  it("lapses a monthly row uncharged past 30d + slack + grace", () => {
    const last = new Date("2026-07-01T12:00:00.000Z");
    expect(isLapsedRecurring(prime, last, 7, NOW)).toBe(true);
  });

  it("keeps a recently-charged monthly row active", () => {
    const last = new Date("2026-09-05T12:00:00.000Z");
    expect(isLapsedRecurring(prime, last, 7, NOW)).toBe(false);
  });

  it("unjudgeable without corpus evidence", () => {
    expect(isLapsedRecurring(prime, null, 7, NOW)).toBe(false);
  });

  it("rows with a stored renewalDate keep the legacy path", () => {
    const last = new Date("2026-01-01T12:00:00.000Z");
    expect(
      isLapsedRecurring({ ...prime, renewalDate: "2026-09-01" }, last, 7, NOW),
    ).toBe(false);
  });

  it("sparse and free rows are never lapsed", () => {
    const last = new Date("2026-01-01T12:00:00.000Z");
    expect(
      isLapsedRecurring({ ...prime, category: "sparse" }, last, 7, NOW),
    ).toBe(false);
    expect(
      isLapsedRecurring({ ...prime, category: "free" }, last, 7, NOW),
    ).toBe(false);
  });

  it("yearly cadence gets the full year + slack + grace", () => {
    const last = new Date("2025-09-01T12:00:00.000Z"); // 382d before NOW
    expect(
      isLapsedRecurring(
        { ...prime, billing: "Yearly", frequency: "Yearly" },
        last,
        7,
        NOW,
      ),
    ).toBe(true);
    const recentYearly = new Date("2025-09-10T12:00:00.000Z"); // 373d
    expect(
      isLapsedRecurring(
        { ...prime, billing: "Yearly", frequency: "Yearly" },
        recentYearly,
        7,
        NOW,
      ),
    ).toBe(false);
  });
});

describe("lapse excludes lapsed recurring rows from spend (legacy)", () => {
  it("a months-uncharged Prime row contributes 0", () => {
    const messages = [hit("Primevideo", 11.99, "2026-07-01T12:00:00.000Z")];
    expect(monthlySpendContribution(prime, messages, NOW)).toBe(0);
  });

  it("a recently-charged Prime row keeps contributing", () => {
    const messages = [hit("Primevideo", 11.99, "2026-09-05T12:00:00.000Z")];
    expect(monthlySpendContribution(prime, messages, NOW)).toBeCloseTo(11.99);
  });

  it("walker finds the latest recurring charge, ignoring sparse hits", () => {
    const messages = [
      hit("Primevideo", 11.99, "2026-07-01T12:00:00.000Z"),
      hit("Primevideo", 24.10, "2026-08-02T12:00:00.000Z", "sparse"),
    ];
    const last = lastRecurringChargeDate(prime, messages);
    expect(last?.toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});

describe("projection parity", () => {
  it("bucket walker matches the legacy walker and the spend drops to 0", () => {
    const actuals = [
      bucket("2026-07-01"),
      { ...bucket("2026-08-02", "sparse"), total: 24.1 },
    ];
    const messages = [
      hit("Primevideo", 11.99, "2026-07-01T12:00:00.000Z"),
      hit("Primevideo", 24.1, "2026-08-02T12:00:00.000Z", "sparse"),
    ];
    const legacyLast = lastRecurringChargeDate(prime, messages);
    const projLast = projectionLastRecurringChargeDate(prime, actuals);
    expect(projLast?.toISOString().slice(0, 10)).toBe(
      legacyLast?.toISOString().slice(0, 10),
    );
    expect(projectionMonthlySpendContribution(prime, actuals, NOW)).toBe(0);
  });

  it("recently-charged bucket keeps contributing", () => {
    const actuals = [bucket("2026-09-05")];
    expect(
      projectionMonthlySpendContribution(prime, actuals, NOW),
    ).toBeCloseTo(11.99);
  });
});
