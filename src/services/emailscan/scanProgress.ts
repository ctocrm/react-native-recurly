/**
 * Phase I (J3/I1): in-app scan progress surface.
 *
 * The scan's progress lines (legProgress.ts) are developer-facing logcat; this
 * module is the user-facing twin: a tiny external store the leg loop updates
 * (leg k/N, staged counts, scan-phase errors) and React reads via
 * useSyncExternalStore. A module store — not component state — because the
 * scan outlives any single screen: the user navigates away mid-scan and the
 * indicator must survive remounts.
 *
 * Deliberately minimal: no scheduler, no immutability helpers. Mutators
 * replace the state object (stable snapshot reference for useSyncExternalStore)
 * and notify listeners; listener errors are logged, never fatal.
 *
 * Phase K (deep re-list): adds {deep, listed, listedTotal} — cumulative ids
 * listed and the provider-reported total where the API exposes one (Gmail
 * resultSizeEstimate, Graph @odata.count). listedTotal stays null until some
 * provider reports a total; legs that report none contribute their count but
 * not a total, so the UI must render "scanned N" honestly instead of a fake
 * percentage.
 */

export interface ScanProgress {
  active: boolean;
  /** 0-based index of the leg currently running (valid while active). */
  legIndex: number;
  legTotal: number;
  mailboxId: string | null;
  /** Staged count within the current leg (from the pacer tick path). */
  staged: number;
  legsDone: number;
  imported: number;
  /** Scan-phase errors (per mailbox); final summary errors ride the finish. */
  errors: string[];
  /** Phase K: true when this run is a deep re-list (drives the gauge bubble). */
  deep: boolean;
  /** Phase K: ids listed so far — completed legs + the current leg. */
  listed: number;
  /**
   * Phase K: sum of provider-reported totals (completed + current leg).
   * Null until ANY provider reports one; legs without a total contribute
   * count only.
   */
  listedTotal: number | null;
}

type Listener = () => void;

function initialState(): ScanProgress {
  return {
    active: false,
    legIndex: -1,
    legTotal: 0,
    mailboxId: null,
    staged: 0,
    legsDone: 0,
    imported: 0,
    errors: [],
    deep: false,
    listed: 0,
    listedTotal: null,
  };
}

let state: ScanProgress = initialState();
const listeners = new Set<Listener>();

function set(next: Partial<ScanProgress>): void {
  state = { ...state, ...next };
  for (const listener of listeners) {
    try {
      listener();
    } catch (err) {
      console.log(
        "[MailScan] scanProgress listener FAILED",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

// Phase K accumulators (module-level, deliberately outside the state object):
// the current leg's running numbers plus the completed-leg rollup.
let doneListed = 0;
let doneTotal: number | null = null;
let doneHasTotal = false;
let curListed = 0;
let curTotal: number | null = null;

function combinedTotal(): number | null {
  if (!doneHasTotal && curTotal == null) return null;
  return (doneTotal ?? 0) + (curTotal ?? 0);
}

export function getScanProgress(): ScanProgress {
  return state;
}

export function subscribeScanProgress(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Called once the mailbox list is known — resets any previous run. */
export function scanProgressStart(legTotal: number, deep = false): void {
  doneListed = 0;
  doneTotal = null;
  doneHasTotal = false;
  curListed = 0;
  curTotal = null;
  set({ ...initialState(), active: true, legTotal, deep });
}

export function scanProgressLegStart(
  legIndex: number,
  mailboxId: string,
): void {
  curListed = 0;
  curTotal = null;
  set({ legIndex, mailboxId, staged: 0 });
}

/** Per staged chunk — wired alongside the logcat pacer tick. */
export function scanProgressStaged(staged: number): void {
  set({ staged });
}

/**
 * Phase K: per-chunk listing progress from the fetcher (cumulative for the
 * leg). `total` is the provider-reported listing size, or null when the API
 * exposes none.
 */
export function scanProgressListed(
  listed: number,
  total: number | null,
): void {
  curListed = listed;
  if (total != null) curTotal = total;
  set({ listed: doneListed + curListed, listedTotal: combinedTotal() });
}

/** Roll the current leg's counters into the completed-leg accumulators. */
function rollUpLeg(): void {
  doneListed += curListed;
  if (curTotal != null) {
    doneTotal = (doneTotal ?? 0) + curTotal;
    doneHasTotal = true;
  }
  curListed = 0;
  curTotal = null;
}

/** The leg's scan phase completed (imports may still follow). */
export function scanProgressLegDone(): void {
  rollUpLeg();
  set({
    legsDone: state.legsDone + 1,
    mailboxId: null,
    staged: 0,
    listed: doneListed,
    listedTotal: combinedTotal(),
  });
}

/** The leg's scan phase failed — still counts as finished for k/N. */
export function scanProgressLegError(message: string): void {
  rollUpLeg();
  set({
    legsDone: state.legsDone + 1,
    errors: [...state.errors, message],
    mailboxId: null,
    staged: 0,
    listed: doneListed,
    listedTotal: combinedTotal(),
  });
}

export function scanProgressFinish(imported: number, errors: string[]): void {
  set({ active: false, imported, errors, mailboxId: null, staged: 0 });
}
