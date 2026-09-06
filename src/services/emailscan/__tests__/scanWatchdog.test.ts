/**
 * R14 scan watchdog: the native-backed no-progress bound for mailbox legs.
 * Covers the no-module fallback, the arm/reject/cancel contract of
 * waitForScanStall, and runIncrementalScan racing a wedged leg to a bounded
 * per-mailbox failure.
 */
import {
  ensureOnline,
  feedScanWatchdog,
  waitForScanStall,
  type ScanStallHandle,
  type WatchdogNative,
} from "../scanWatchdog";
import {
  createMemoryScanStore,
  runIncrementalScan,
  type ScanWatchdogControl,
} from "../scan";
import type { MessageFetcher } from "../types";

describe("waitForScanStall", () => {
  it("is a settled no-op when the native module is absent (jest/iOS/web)", async () => {
    const handle = waitForScanStall(1_000, null);
    let rejected = false;
    handle.promise.catch(() => {
      rejected = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(rejected).toBe(false);
    expect(() => handle.cancel()).not.toThrow();
    expect(() => feedScanWatchdog()).not.toThrow();
  });

  it("arms the native module with the budget and rejects when it stalls", async () => {
    const armCalls: number[] = [];
    // Holder object: TS cannot closure-narrow a property across the call,
    // unlike a captured `let` (which it wrongly narrows to null).
    const arm: { reject?: (error: unknown) => void } = {};
    const fake: WatchdogNative = {
      arm(ms: number) {
        armCalls.push(ms);
        return new Promise<unknown>((_resolve, reject) => {
          arm.reject = reject;
        });
      },
      feed() {},
      cancel() {},
      isOnline: async () => true,
      waitForOnline: async () => true,
    };
    const handle = waitForScanStall(1234, fake);
    expect(armCalls).toEqual([1234]);
    arm.reject?.(new Error("Mail scan stalled: no network progress for 1s"));
    await expect(handle.promise).rejects.toThrow(/stalled/);
  });

  it("ignores a late native rejection after cancel()", async () => {
    let cancelCalled = false;
    const arm: { reject?: (error: unknown) => void } = {};
    const fake: WatchdogNative = {
      arm() {
        return new Promise<unknown>((_resolve, reject) => {
          arm.reject = reject;
        });
      },
      feed() {},
      cancel() {
        cancelCalled = true;
      },
      isOnline: async () => true,
      waitForOnline: async () => true,
    };
    const handle = waitForScanStall(500, fake);
    handle.cancel();
    expect(cancelCalled).toBe(true);
    let rejected = false;
    handle.promise.catch(() => {
      rejected = true;
    });
    arm.reject?.(new Error("late rejection"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(rejected).toBe(false);
  });
});

describe("ensureOnline (R15 offline gate)", () => {
  it("returns true immediately when online", async () => {
    const mod: WatchdogNative = {
      arm: () => Promise.resolve(null),
      feed: () => {},
      cancel: () => {},
      isOnline: async () => true,
      waitForOnline: async () => {
        throw new Error("must not be called when online");
      },
    };
    await expect(ensureOnline(5_000, mod)).resolves.toBe(true);
  });

  it("pauses on the native reconnect event and resumes", async () => {
    const waits: number[] = [];
    const mod: WatchdogNative = {
      arm: () => Promise.resolve(null),
      feed: () => {},
      cancel: () => {},
      isOnline: async () => false,
      waitForOnline: async (ms: number) => {
        waits.push(ms);
        return true;
      },
    };
    await expect(ensureOnline(123_456, mod)).resolves.toBe(true);
    expect(waits).toEqual([123_456]);
  });

  it("reports false when offline longer than the budget", async () => {
    const mod: WatchdogNative = {
      arm: () => Promise.resolve(null),
      feed: () => {},
      cancel: () => {},
      isOnline: async () => false,
      waitForOnline: async () => false,
    };
    await expect(ensureOnline(1_000, mod)).resolves.toBe(false);
  });

  it("never blocks when the native module is absent", async () => {
    await expect(ensureOnline(1_000, null)).resolves.toBe(true);
  });
});

describe("runIncrementalScan watchdog race (R14)", () => {
  it("turns a never-resolving leg into a bounded rejection and cancels the watchdog", async () => {
    const wedged: MessageFetcher = {
      fetchMessages: () => new Promise(() => {}),
    };
    let cancelled = false;
    const stallHandle: ScanStallHandle = {
      promise: Promise.reject(
        new Error("scan stalled — no network progress; connection dropped"),
      ),
      cancel() {
        cancelled = true;
      },
    };
    const watchdog: ScanWatchdogControl = {
      stall: () => stallHandle,
      feed: () => {},
      cancel: (handle) => handle.cancel(),
    };

    await expect(
      runIncrementalScan({
        mailboxId: "workspace:example@test",
        providerId: "workspace",
        fetcher: wedged,
        store: createMemoryScanStore(),
        watchdog,
      }),
    ).rejects.toThrow(/stalled/);
    expect(cancelled).toBe(true);
  });

  it("keeps the happy path intact when the watchdog stays silent", async () => {
    let stalledHandle: ScanStallHandle | null = null;
    const watchdog: ScanWatchdogControl = {
      stall: () => {
        stalledHandle = {
          promise: new Promise<never>(() => {}),
          cancel: () => {},
        };
        return stalledHandle;
      },
      feed: () => {},
      cancel: (handle) => handle.cancel(),
    };
    const fetcher: MessageFetcher = {
      fetchMessages: async () => [
        {
          mailboxId: "workspace:example@test",
          messageId: "m1",
          from: "billing@example.com",
          subject: "Your receipt",
          date: "2026-09-05T00:00:00.000Z",
          text: "receipt",
        },
      ],
    };

    const result = await runIncrementalScan({
      mailboxId: "workspace:example@test",
      providerId: "workspace",
      fetcher,
      store: createMemoryScanStore(),
      watchdog,
    });
    expect(result.fetched).toBe(1);
    expect(stalledHandle).not.toBeNull();
  });
});
