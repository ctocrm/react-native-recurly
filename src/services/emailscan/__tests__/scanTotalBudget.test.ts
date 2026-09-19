import {
  SCAN_TOTAL_BUDGET_MS,
  formatScanBudgetLine,
  shouldSkipRemainingLegs,
} from "../scanTotalBudget";

describe("scanTotalBudget (R13 / Phase H)", () => {
  it("budget is 2x the healthy Phase H gate (<5 min)", () => {
    expect(SCAN_TOTAL_BUDGET_MS).toBe(600_000);
  });

  it("does not skip while inside the budget", () => {
    expect(shouldSkipRemainingLegs(0)).toBe(false);
    expect(shouldSkipRemainingLegs(299_999)).toBe(false);
  });

  it("skips exactly at and past the budget", () => {
    expect(shouldSkipRemainingLegs(600_000)).toBe(true);
    expect(shouldSkipRemainingLegs(601_000)).toBe(true);
  });

  it("honors a custom budget", () => {
    expect(shouldSkipRemainingLegs(4_999, 5_000)).toBe(false);
    expect(shouldSkipRemainingLegs(5_000, 5_000)).toBe(true);
  });

  it("formats a stable greppable expiry line", () => {
    expect(formatScanBudgetLine(600_000, 2)).toBe(
      "[MailScan] scan-wide budget (600s elapsed) — skipping remaining 2 leg(s)",
    );
    expect(formatScanBudgetLine(612_345, 1)).toBe(
      "[MailScan] scan-wide budget (612s elapsed) — skipping remaining 1 leg(s)",
    );
  });
});
