/**
 * R13 / Phase H: per-leg scan progress lines.
 *
 * A healthy long leg (Proton 475-message staging, Gmail paced listing) can run
 * for minutes with nothing user-readable in logcat between "fetcherFor" and the
 * leg summary. The pacer emits one progress line per leg every interval
 * (default 30s) plus a terminal line, so a live scan reads as progress instead
 * of silence — and a stalled leg is visible as an ABSENCE of these lines.
 *
 * Pure gating logic (injectable clock) is exported for unit tests; the logger
 * itself only touches console.log.
 */

export const LEG_PROGRESS_INTERVAL_MS = 30_000;

/** True when a progress line is due (first tick always logs). */
export function shouldLogProgress(
  lastLogMs: number | null,
  nowMs: number,
  intervalMs: number = LEG_PROGRESS_INTERVAL_MS,
): boolean {
  if (lastLogMs === null) return true;
  return nowMs - lastLogMs >= intervalMs;
}

/** Stable, greppable line format: `[MailScan] <mailboxId> progress: N staged`. */
export function formatLegProgress(mailboxId: string, staged: number): string {
  return `[MailScan] ${mailboxId} progress: ${staged} staged`;
}

/** Terminal line for a leg (always emitted once, regardless of interval). */
export function formatLegDone(
  mailboxId: string,
  staged: number,
  candidates: number,
): string {
  return `[MailScan] ${mailboxId} leg done: ${staged} staged, ${candidates} candidate(s)`;
}

export interface LegPacer {
  /** Call once per fetched chunk with the cumulative staged count. */
  tick(staged: number): void;
  /** Call exactly once when the leg completes. */
  done(staged: number, candidates: number): void;
}

export function createLegProgressLogger(
  mailboxId: string,
  opts: {
    intervalMs?: number;
    now?: () => number;
    log?: (line: string) => void;
  } = {},
): LegPacer {
  const intervalMs = opts.intervalMs ?? LEG_PROGRESS_INTERVAL_MS;
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((line: string) => console.log(line));
  let lastLogMs: number | null = null;
  let finished = false;
  return {
    tick(staged: number) {
      if (finished) return;
      const t = now();
      if (!shouldLogProgress(lastLogMs, t, intervalMs)) return;
      lastLogMs = t;
      log(formatLegProgress(mailboxId, staged));
    },
    done(staged: number, candidates: number) {
      if (finished) return;
      finished = true;
      log(formatLegDone(mailboxId, staged, candidates));
    },
  };
}
