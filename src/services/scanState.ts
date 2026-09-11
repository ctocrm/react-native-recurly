/**
 * Scan/crawl mutual exclusion (agreed 2026-09-11): while an email scan runs,
 * icon crawl work must not compete with the mail legs for the network.
 * Crawls started during a scan park until the scan ends, and the shared
 * queue drain pauses between items. Nothing is dropped: parked work resumes
 * on scan end (importFromConnectedMailboxes' finally re-fires the drain).
 *
 * Depth-counted so overlapping scan sessions (if any ever exist) nest
 * safely; the endScan that reaches depth 0 unblocks everything waiting.
 */

let scanDepth = 0;
let idlePromise: Promise<void> | null = null;
let idleResolve: (() => void) | null = null;

function ensureIdlePromise(): Promise<void> {
  if (!idlePromise) {
    idlePromise = new Promise<void>((resolve) => {
      idleResolve = resolve;
    });
  }
  return idlePromise;
}

export function beginScan(): void {
  scanDepth += 1;
  if (scanDepth === 1) ensureIdlePromise();
  console.log(`[SCAN_STATE] scan active (depth=${scanDepth})`);
}

export function endScan(): void {
  if (scanDepth === 0) return;
  scanDepth -= 1;
  console.log(`[SCAN_STATE] scan ended (depth=${scanDepth})`);
  if (scanDepth === 0 && idleResolve) {
    const resolve = idleResolve;
    idleResolve = null;
    idlePromise = null;
    resolve();
  }
}

export function isScanActive(): boolean {
  return scanDepth > 0;
}

/** Resolves immediately when no scan is running, else when the scan ends. */
export function waitIfScanActive(): Promise<void> {
  return scanDepth > 0 ? ensureIdlePromise() : Promise.resolve();
}
