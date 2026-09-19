/**
 * R40-A: evidence-derived ordering. The user's directive: "most recent"
 * means the most recent RECEIVED EMAIL — never the scan wall-clock. These
 * tests lock the five sort modes, the null-date fallbacks, and the
 * next-expected-charge projection that un-empties the Upcoming filter.
 */
import {
  nextExpectedChargeFor,
  sortSubscriptions,
  SUBS_SORT_OPTIONS,
} from "../subscriptionOrder";

const NOW = new Date("2026-09-19T12:00:00.000Z");

function sub(overrides: Partial<Subscription> & { name: string }): Subscription {
  return {
    id: overrides.name,
    icon: ({} as any),
    price: 10,
    billing: "",
    ...overrides,
  } as Subscription;
}

describe("nextExpectedChargeFor", () => {
  it("returns a future renewalDate as-is", () => {
    const s = sub({
      name: "a",
      renewalDate: "2026-09-25T00:00:00.000Z",
      billing: "Monthly",
    });
    expect(nextExpectedChargeFor(s, NOW)!.toISOString()).toBe(
      "2026-09-25T00:00:00.000Z",
    );
  });

  it("projects a past renewalDate forward on the cadence (lapsed rows still charge)", () => {
    const s = sub({
      name: "a",
      renewalDate: "2026-07-01T00:00:00.000Z",
      billing: "Monthly",
    });
    const next = nextExpectedChargeFor(s, NOW)!;
    expect(next.getTime()).toBeGreaterThan(NOW.getTime());
    expect(next.getTime()).toBeLessThanOrEqual(
      new Date("2026-10-01T00:00:00.000Z").getTime(),
    );
  });

  it("projects start + k×period for a recurring row without renewalDate", () => {
    const s = sub({
      name: "a",
      startDate: "2026-01-10T00:00:00.000Z",
      billing: "Yearly",
      category: "recurring",
    });
    // 2026-01-10 + 1 year = 2027-01-10 (first occurrence after NOW).
    expect(nextExpectedChargeFor(s, NOW)!.getUTCFullYear()).toBe(2027);
  });

  it("is null for sparse rows without an explicit cadence", () => {
    const s = sub({ name: "a", category: "sparse", startDate: "2026-01-01" });
    expect(nextExpectedChargeFor(s, NOW)).toBeNull();
  });

  it("is null for recurring rows with no evidenced cadence (never invent one)", () => {
    const s = sub({
      name: "a",
      category: "recurring",
      startDate: "2026-01-01",
      billing: "",
    });
    expect(nextExpectedChargeFor(s, NOW)).toBeNull();
  });

  it("is null for paused/cancelled rows", () => {
    const s = sub({
      name: "a",
      renewalDate: "2026-09-25T00:00:00.000Z",
      status: "cancelled",
      billing: "Monthly",
    });
    expect(nextExpectedChargeFor(s, NOW)).toBeNull();
  });
});

describe("sortSubscriptions", () => {
  const rows: Subscription[] = [
    sub({ name: "old-money", lastReceivedAt: "2026-01-05", category: "recurring", billing: "Yearly", startDate: "2025-06-01" }),
    sub({ name: "fresh-sparse", lastReceivedAt: "2026-09-18", category: "sparse", startDate: "2026-09-18" }),
    sub({ name: "mid-recurring", lastReceivedAt: "2026-06-01", category: "recurring", billing: "Yearly", startDate: "2024-06-01" }),
    sub({ name: "hand-entered", category: "recurring", billing: "Monthly" }),
  ];

  it("recent: by received evidence DESC, rows without dates last", () => {
    const names = sortSubscriptions(rows, "recent", NOW).map((r) => r.name);
    expect(names).toEqual(["fresh-sparse", "mid-recurring", "old-money", "hand-entered"]);
  });

  it("oldest: by received evidence ASC, undated rows still last", () => {
    const names = sortSubscriptions(rows, "oldest", NOW).map((r) => r.name);
    expect(names[0]).toBe("old-money");
    expect(names[names.length - 1]).toBe("hand-entered");
  });

  it("sparse: sparse rows first, then recent order", () => {
    const names = sortSubscriptions(rows, "sparse", NOW).map((r) => r.name);
    expect(names[0]).toBe("fresh-sparse");
    expect(names[1]).toBe("mid-recurring");
  });

  it("recurring: recurring rows first, then recent order", () => {
    const names = sortSubscriptions(rows, "recurring", NOW).map((r) => r.name);
    expect(names).toEqual(["mid-recurring", "old-money", "hand-entered", "fresh-sparse"]);
  });

  it("next: soonest expected charge first, no-date rows last", () => {
    const withCharges = [
      ...rows,
      sub({ name: "charges-soon", category: "recurring", billing: "Monthly", startDate: "2026-08-25" }),
    ];
    const names = sortSubscriptions(withCharges, "next", NOW).map(
      (r) => r.name,
    );
    expect(names[0]).toBe("charges-soon");
    // Both charge-less rows share the trailing group; stable sort keeps
    // their input order, so assert the set, not the exact sequence.
    expect(names.slice(-2).sort()).toEqual(["fresh-sparse", "hand-entered"]);
  });

  it("never mutates the input array", () => {
    const copy = [...rows];
    sortSubscriptions(rows, "oldest", NOW);
    expect(rows).toEqual(copy);
  });

  it("exposes exactly the five approved sort options", () => {
    expect([...SUBS_SORT_OPTIONS]).toEqual([
      "recent",
      "oldest",
      "sparse",
      "recurring",
      "next",
    ]);
  });
});
