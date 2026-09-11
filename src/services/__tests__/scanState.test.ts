/**
 * scanState — the scan/crawl mutual-exclusion gate (agreed 2026-09-11):
 * while an email scan runs, crawl work parks and the queue drain pauses;
 * the endScan that reaches depth 0 releases everything. Nothing is dropped.
 */
import {
  beginScan,
  endScan,
  isScanActive,
  waitIfScanActive,
} from "../scanState";

describe("scanState (scan/crawl mutual exclusion)", () => {
  it("reports idle before any scan and resolves an idle wait immediately", async () => {
    expect(isScanActive()).toBe(false);
    let released = false;
    const gate = waitIfScanActive().then(() => {
      released = true;
    });
    await Promise.resolve();
    expect(released).toBe(true);
    await gate;
  });

  it("is active between beginScan and endScan; waiters park until the end", async () => {
    beginScan();
    try {
      expect(isScanActive()).toBe(true);
      let released = false;
      const gate = waitIfScanActive().then(() => {
        released = true;
      });
      await Promise.resolve();
      // still mid-scan: the wait must NOT have resolved
      expect(released).toBe(false);
      endScan();
      await gate;
      expect(released).toBe(true);
      expect(isScanActive()).toBe(false);
    } finally {
      // depth safety for later tests if an assertion above throws
      while (isScanActive()) endScan();
    }
  });

  it("nests: only the endScan that reaches depth 0 releases the waiters", async () => {
    beginScan();
    beginScan();
    try {
      let released = false;
      const gate = waitIfScanActive().then(() => {
        released = true;
      });
      endScan();
      await Promise.resolve();
      expect(isScanActive()).toBe(true);
      expect(released).toBe(false);
      endScan();
      await gate;
      expect(released).toBe(true);
    } finally {
      while (isScanActive()) endScan();
    }
  });

  it("ignores an unbalanced endScan", () => {
    expect(() => endScan()).not.toThrow();
    expect(isScanActive()).toBe(false);
  });
});
