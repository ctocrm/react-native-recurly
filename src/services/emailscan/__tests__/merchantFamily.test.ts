/**
 * R36: merchant families — one card per family (Amazon shape). The recurring
 * member fronts the card; the family's sparse actuals stack under it; spend
 * math per row is unchanged.
 */
import {
  familyForName,
  familyMemberSlugs,
  groupByFamily,
} from "@/services/merchantFamily";
import { sparseSecondaryLine } from "../chargeDisplay";
import { projectionSparseSecondaryLine } from "../projectionDisplay";
import type { MerchantDayActual } from "../projectionCore";
import type { ClassifiedMessage } from "../types";

const prime: Subscription = {
  id: "pv",
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

describe("family map", () => {
  it("maps amazon family members", () => {
    expect(familyForName("Primevideo")).toBe("amazon");
    expect(familyForName("Amazon")).toBe("amazon");
    expect(familyForName("Elite Ti")).toBeNull();
  });

  it("member slugs include the whole family (flat [own] for ungrouped)", () => {
    expect(familyMemberSlugs("Primevideo")).toEqual(["amazon", "primevideo"]);
    expect(familyMemberSlugs("Elite Ti")).toEqual(["elite-ti"]);
  });
});

describe("groupByFamily", () => {
  const amazonRow: Subscription = {
    ...prime,
    id: "am",
    name: "Amazon",
    category: "sparse",
    price: 0,
  };
  const other: Subscription = { ...prime, id: "x", name: "XAI" };

  it("one group per family, recurring member fronts the card", () => {
    const groups = groupByFamily([amazonRow, prime, other]);
    expect(groups).toHaveLength(2);
    const fam = groups.find((g) => g.members.length > 1)!;
    expect(fam.primary.id).toBe("pv");
    expect(fam.members.map((m) => m.id).sort()).toEqual(["am", "pv"]);
  });

  it("ungrouped rows stay singletons in stable order", () => {
    const groups = groupByFamily([other, amazonRow, prime]);
    expect(groups.map((g) => g.primary.id)).toEqual(["x", "pv"]);
  });
});

describe("family sparse line", () => {
  const NOW = new Date("2026-09-18T12:00:00.000Z");

  function hit(
    merchant: string,
    amount: number,
    date: string,
  ): ClassifiedMessage {
    return {
      message: {
        mailboxId: "workspace:mail",
        messageId: `${merchant}-${date}`,
        from: `${merchant}@example.com`,
        subject: "order",
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

  it("stacks the family's store purchases on the recurring card", () => {
    const messages = [
      hit("Amazon", 100.0, "2026-09-10T12:00:00.000Z"),
      hit("Amazon", 154.95, "2026-09-15T12:00:00.000Z"),
      hit("Other", 9.99, "2026-09-16T12:00:00.000Z"),
    ];
    const line = sparseSecondaryLine(prime, messages, NOW);
    expect(line?.label).toBe("Sparse");
    expect(line?.amount).toBeCloseTo(254.95);
  });

  it("projection parity: bucket stacks match the legacy walker", () => {
    const messages = [
      hit("Amazon", 100.0, "2026-09-10T12:00:00.000Z"),
      hit("Amazon", 154.95, "2026-09-15T12:00:00.000Z"),
    ];
    const actuals: MerchantDayActual[] = [
      {
        bucketType: "slug",
        bucketKey: "amazon",
        mailboxId: "workspace:mail",
        kind: "sparse",
        day: "2026-09-10",
        total: 100,
        count: 1,
        unknownCount: 0,
      },
      {
        bucketType: "slug",
        bucketKey: "amazon",
        mailboxId: "workspace:mail",
        kind: "sparse",
        day: "2026-09-15",
        total: 154.95,
        count: 1,
        unknownCount: 0,
      },
    ];
    expect(projectionSparseSecondaryLine(prime, actuals, NOW)).toEqual(
      sparseSecondaryLine(prime, messages, NOW),
    );
  });

  it("no family sparse activity this month → no line", () => {
    const messages = [hit("Amazon", 25, "2026-08-20T12:00:00.000Z")];
    expect(sparseSecondaryLine(prime, messages, NOW)).toBeNull();
  });
});
