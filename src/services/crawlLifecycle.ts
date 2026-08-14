/**
 * Tranche E — truthful terminal semantics + explicit cache ownership.
 * Pure, unit-testable rules used by the crawler so that:
 *  - a transient provider failure can never be reported as a long-lived
 *    "complete", and
 *  - crawler auto-promotion can never overwrite a user/AI-chosen icon.
 */

export type TerminalStatus = "complete" | "partial" | "failed";

/**
 * Decide the crawl's terminal status.
 * - "failed": nothing was saved AND at least one provider failed (a transient
 *   provider outage must not look like a successful empty search).
 * - "partial": some work remains retryable OR a provider failed (truthful even
 *   when a few icons were saved).
 * - "complete": everything discovered was saved and no provider failed.
 */
export function terminalStatusFor(
  saved: number,
  remaining: number,
  providerFailures: number,
): TerminalStatus {
  if (saved === 0 && providerFailures > 0) return "failed";
  if (remaining > 0 || providerFailures > 0) return "partial";
  return "complete";
}

/**
 * Whether the crawler may auto-assign the icon_cache for a key.
 * Auto-promotion is only allowed to FILL an empty cache or HEAL an invalid one.
 * A cache that already holds a valid image is, by definition, a chosen
 * (manual/AI/earlier-valid) icon and must never be overwritten by the crawler.
 */
export function canAutoAssignCache(
  hasImageData: boolean,
  isValid: boolean,
): boolean {
  if (!hasImageData) return true; // empty cache: safe to fill
  return !isValid; // invalid cache: safe to heal
  // valid cache => user/AI-chosen => crawler must not overwrite
}

/**
 * Per-key crawl generation registry for stale-cancellation. A detached crawl
 * captures its generation at start and must not publish (save/promote/report)
 * once a newer crawl for the same key has begun.
 */
export class CrawlGenerationRegistry {
  private gens = new Map<string, number>();

  /** Begin a new crawl for key; returns its generation token. */
  begin(key: string): number {
    const next = (this.gens.get(key) ?? 0) + 1;
    this.gens.set(key, next);
    return next;
  }

  /** Current generation for key (0 if none). */
  current(key: string): number {
    return this.gens.get(key) ?? 0;
  }

  /** True when the given token is still the latest crawl for key. */
  isCurrent(key: string, token: number): boolean {
    return this.current(key) === token;
  }
}
