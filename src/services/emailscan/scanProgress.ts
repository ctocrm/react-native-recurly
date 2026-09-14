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
export function scanProgressStart(legTotal: number): void {
  set({ ...initialState(), active: true, legTotal });
}

export function scanProgressLegStart(
  legIndex: number,
  mailboxId: string,
): void {
  set({ legIndex, mailboxId, staged: 0 });
}

/** Per staged chunk — wired alongside the logcat pacer tick. */
export function scanProgressStaged(staged: number): void {
  set({ staged });
}

/** The leg's scan phase completed (imports may still follow). */
export function scanProgressLegDone(): void {
  set({ legsDone: state.legsDone + 1, mailboxId: null, staged: 0 });
}

/** The leg's scan phase failed — still counts as finished for k/N. */
export function scanProgressLegError(message: string): void {
  set({
    legsDone: state.legsDone + 1,
    errors: [...state.errors, message],
    mailboxId: null,
    staged: 0,
  });
}

export function scanProgressFinish(imported: number, errors: string[]): void {
  set({ active: false, imported, errors, mailboxId: null, staged: 0 });
}
