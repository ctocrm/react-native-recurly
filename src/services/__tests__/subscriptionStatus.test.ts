import {
  DEFAULT_EXPIRED_GRACE_DAYS,
  isMayHaveExpired,
  subscriptionBucket,
} from "../subscriptionStatus";

const NOW = new Date("2026-09-16T12:00:00.000Z");

describe("subscriptionStatus (Phase N buckets)", () => {
  it("defaults the grace period to 7 days", () => {
    expect(DEFAULT_EXPIRED_GRACE_DAYS).toBe(7);
  });

  it("flags a row whose renewal lapsed past the grace window", () => {
    // Renewal Sept 1 + 7 days grace = Sept 8 → now Sept 16 is past it.
    expect(isMayHaveExpired("2026-09-01T00:00:00.000Z", 7, NOW)).toBe(true);
  });

  it("does not flag within the grace window", () => {
    // Renewal Sept 12 + 7 days = Sept 19 → still inside.
    expect(isMayHaveExpired("2026-09-12T00:00:00.000Z", 7, NOW)).toBe(false);
  });

  it("is false exactly at the grace boundary (strictly after only)", () => {
    // Renewal Sept 9 + 7 days = Sept 16 00:00 — noon is 12h past → expired.
    expect(isMayHaveExpired("2026-09-09T00:00:00.000Z", 7, NOW)).toBe(true);
  });

  it("is false without a renewal date or with a garbage date", () => {
    expect(isMayHaveExpired(undefined, 7, NOW)).toBe(false);
    expect(isMayHaveExpired("not-a-date", 7, NOW)).toBe(false);
  });

  it("buckets a lapsed active row as expired, outranking sparse", () => {
    expect(
      subscriptionBucket(
        { renewalDate: "2026-09-01T00:00:00.000Z", category: "sparse" },
        7,
        NOW,
      ),
    ).toBe("expired");
  });

  it("buckets sparse rows without a lapse as sparse", () => {
    expect(
      subscriptionBucket({ category: "sparse" }, 7, NOW),
    ).toBe("sparse");
  });

  it("stopped (paused/cancelled) rows are never expired", () => {
    expect(
      subscriptionBucket(
        {
          renewalDate: "2026-09-01T00:00:00.000Z",
          status: "cancelled",
        },
        7,
        NOW,
      ),
    ).toBe("active");
  });

  it("buckets rows without a lapse as active", () => {
    expect(
      subscriptionBucket(
        { renewalDate: "2026-10-01T00:00:00.000Z", status: "active" },
        7,
        NOW,
      ),
    ).toBe("active");
  });
});
