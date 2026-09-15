/**
 * Phase K: the scanProgress store's deep re-list totals — cumulative ids
 * listed and provider-reported totals rolled up across legs. Legs that
 * report no total (Zoho/Proton/Tuta/IMAP) contribute count only; listedTotal
 * stays null until ANY provider reports one.
 */

import {
  getScanProgress,
  scanProgressFinish,
  scanProgressLegDone,
  scanProgressLegError,
  scanProgressLegStart,
  scanProgressListed,
  scanProgressStart,
} from "../scanProgress";

describe("scanProgress deep totals (Phase K)", () => {
  test("rolls listed + totals across legs; unknown totals stay null until one arrives", () => {
    scanProgressStart(3, true);
    expect(getScanProgress()).toMatchObject({
      active: true,
      deep: true,
      listed: 0,
      listedTotal: null,
      legTotal: 3,
    });

    // Leg 1: no total reported (Zoho/Proton-style) — count only.
    scanProgressLegStart(0, "zoho:acct");
    scanProgressListed(47, null);
    expect(getScanProgress()).toMatchObject({ listed: 47, listedTotal: null });
    scanProgressLegDone();
    expect(getScanProgress()).toMatchObject({
      listed: 47,
      listedTotal: null,
      legsDone: 1,
    });

    // Leg 2: Gmail-style total; within-leg updates are cumulative.
    scanProgressLegStart(1, "workspace:x");
    scanProgressListed(100, 500);
    expect(getScanProgress()).toMatchObject({ listed: 147, listedTotal: 500 });
    scanProgressListed(220, 500);
    expect(getScanProgress()).toMatchObject({ listed: 267, listedTotal: 500 });
    scanProgressLegDone();
    expect(getScanProgress()).toMatchObject({
      listed: 267,
      listedTotal: 500,
      legsDone: 2,
    });

    // Leg 3: Graph-style total — sums with leg 2's.
    scanProgressLegStart(2, "outlook:x");
    scanProgressListed(30, 30);
    scanProgressLegDone();
    expect(getScanProgress()).toMatchObject({
      listed: 297,
      listedTotal: 530,
      legsDone: 3,
    });

    scanProgressFinish(2, []);
    expect(getScanProgress()).toMatchObject({
      active: false,
      imported: 2,
      listed: 297,
      listedTotal: 530,
    });
  });

  test("a failed leg still rolls its counters and records the error", () => {
    scanProgressStart(1, true);
    scanProgressLegStart(0, "proton:u");
    scanProgressListed(12, null);
    scanProgressLegError("proton:u: boom");

    expect(getScanProgress()).toMatchObject({
      listed: 12,
      legsDone: 1,
      errors: ["proton:u: boom"],
    });
    expect(getScanProgress().listedTotal).toBeNull();
  });

  test("non-deep scans leave deep=false (Home pill path unchanged)", () => {
    scanProgressStart(4);
    expect(getScanProgress()).toMatchObject({ deep: false, active: true });
  });
});