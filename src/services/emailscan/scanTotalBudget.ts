/**
 * R13 / Phase H: scan-wide budget.
 *
 * The per-leg watchdog (scanWatchdog.ts) bounds SILENCE inside one leg, but a
 * scan whose legs are merely slow-but-alive (staging hundreds of messages,
 * chunks flushing every few seconds) keeps feeding the watchdog and can
 * legally run for a very long time — nothing bounds TOTAL scan duration.
 * This budget catches that case: once the scan has consumed its budget, stop
 * STARTING new legs. Semantics are deliberately conservative so the F-4/F-5
 * invariants hold:
 *
 * - checked BETWEEN legs only — an in-flight leg is never killed mid-chunk
 *   (the watchdog remains the authority on a dead leg; worst-case overshoot
 *   is one leg)
 * - completed legs keep their results; endScan() still always runs (the
 *   finally in importFromConnectedMailboxes is untouched)
 * - the expiry line only ever appears on an over-budget scan — its ABSENCE on
 *   a healthy scan (the Phase H gate wants total <5 min vs this 10 min
 *   budget) is itself a receipt
 */

export const SCAN_TOTAL_BUDGET_MS = 10 * 60_000;

/** True once the scan has consumed its budget and remaining legs must be skipped. */
export function shouldSkipRemainingLegs(
  elapsedMs: number,
  budgetMs: number = SCAN_TOTAL_BUDGET_MS,
): boolean {
  return elapsedMs >= budgetMs;
}

/** Stable, greppable line for the expiry event. */
export function formatScanBudgetLine(
  elapsedMs: number,
  remainingLegs: number,
): string {
  return `[MailScan] scan-wide budget (${Math.round(elapsedMs / 1000)}s elapsed) — skipping remaining ${remainingLegs} leg(s)`;
}
