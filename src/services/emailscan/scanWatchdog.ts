/**
 * R14 scan watchdog: bounds a mailbox leg by NO-PROGRESS, natively.
 *
 * Why: the 2026-09-05 run-2 wedge parked the workspace Gmail leg forever
 * with zero in-flight sockets — R12's native callTimeout only bounds OkHttp
 * calls that exist, and the Gmail loop cannot take one step without a JS
 * setTimeout firing (gmailApi paces every call with a sleep). When RN timer
 * dispatch dies mid-scan, no JS-side race can ever fire. The native
 * MailWatchdog module runs its countdown on the Android main looper
 * (independent of RN's Timing module) and rejects the armed promise on
 * expiry — promise delivery is the path every Proton/Tuta/MSAL native call
 * already uses, so a wakeable JS thread receives the failure and
 * runIncrementalScan turns it into the per-mailbox error dialog.
 *
 * Falls back to a never-settling no-op on platforms without the module
 * (iOS/web/jest) — the R9/R12 JS wrappers remain the only bounds there.
 */
import { NativeModules } from "react-native";

/** No-progress budget per mailbox leg. Must exceed the longest legitimate
 * silent stretch: the 120s max Gmail quota backoff + a 20s wrapper window,
 * plus slack. Proton chunks land every ~30s; every HTTP call feeds. */
export const NO_PROGRESS_BUDGET_MS = 180_000;

export type WatchdogNative = {
  arm(budgetMs: number): Promise<unknown>;
  feed(): void;
  cancel(): void;
};

function native(): WatchdogNative | null {
  const mod = (NativeModules as unknown as Record<string, unknown> | undefined)
    ?.MailWatchdog as WatchdogNative | undefined;
  return mod ?? null;
}

export type ScanStallHandle = {
  /** Rejects with the stall error when the native budget expires. */
  promise: Promise<never>;
  /** Disarms the native timer and ignores any late rejection. */
  cancel(): void;
};

const neverSettles: ScanStallHandle = {
  promise: new Promise<never>(() => {}),
  cancel: () => {},
};

/**
 * Arms the native no-progress watchdog and returns its rejection as a
 * promise to race the mailbox leg against. `mod` is injectable for tests.
 */
export function waitForScanStall(
  budgetMs: number = NO_PROGRESS_BUDGET_MS,
  mod: WatchdogNative | null = native(),
): ScanStallHandle {
  if (!mod) return neverSettles;
  let cancelled = false;
  const promise = new Promise<never>((_resolve, reject) => {
    mod.arm(budgetMs).then(
      () => undefined, // resolved by cancel() — deliberate no-op
      (error: unknown) => {
        if (cancelled) return;
        reject(
          error instanceof Error
            ? error
            : new Error(
                "scan stalled — no network progress for " +
                  `${Math.round(budgetMs / 1000)}s. The connection may have ` +
                  "dropped mid-scan; try again.",
              ),
        );
      },
    );
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      try {
        mod.cancel();
      } catch {
        // Best-effort disarm — a dead module must not mask the leg result.
      }
    },
  };
}

/** Progress heartbeat: every completed HTTP call / native chunk is progress. */
export function feedScanWatchdog(): void {
  try {
    native()?.feed();
  } catch {
    // Best-effort — never let diagnostics kill a scan.
  }
}
