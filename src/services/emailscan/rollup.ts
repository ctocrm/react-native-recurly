/**
 * Merchant rollup: welcome + later invoice → one row, upgraded.
 * Recurring without amount stays recurring/unknown, not free.
 * Amazon Prime renewal and Amazon order stay two kinds.
 */
import type {
  CandidateKind,
  ClassifiedMessage,
  DisplayFilters,
  ScanCandidate,
} from "./types";
import { DEFAULT_DISPLAY_FILTERS } from "./types";

function kindRank(kind: CandidateKind): number {
  if (kind === "recurring") return 2;
  if (kind === "sparse") return 1;
  return 0;
}

function confidenceRank(c: ScanCandidate["confidence"]): number {
  if (c === "high") return 2;
  if (c === "medium") return 1;
  return 0;
}

function rollupKey(hit: ClassifiedMessage): string {
  return `${hit.message.mailboxId}\0${hit.merchantKey}\0${hit.kind}`;
}

export function rollupCandidates(hits: ClassifiedMessage[]): ScanCandidate[] {
  const map = new Map<string, ScanCandidate>();

  for (const hit of hits) {
    if (!hit.kind) continue;

    const key = rollupKey(hit);
    const existing = map.get(key);
    const evidence = [...hit.evidence];
    const messageId = hit.message.messageId;

    if (!existing) {
      map.set(key, {
        mailboxId: hit.message.mailboxId,
        merchantKey: hit.merchantKey,
        merchant: hit.merchantName,
        kind: hit.kind,
        amount: hit.amount,
        currency: hit.currency,
        cadence: hit.cadence,
        nextDate: undefined,
        amountUnknown: hit.amountUnknown || hit.amount === undefined,
        evidence,
        messageIds: [messageId],
        confidence: hit.confidence,
      });
      continue;
    }

    if (!existing.messageIds.includes(messageId)) {
      existing.messageIds.push(messageId);
    }
    existing.evidence = [...existing.evidence, ...evidence];

    if (hit.amount !== undefined) {
      existing.amount = hit.amount;
      existing.currency = hit.currency ?? existing.currency;
      existing.amountUnknown = false;
    } else if (existing.amount === undefined) {
      existing.amountUnknown = true;
    }

    if (hit.cadence && hit.cadence !== "unknown") {
      existing.cadence = hit.cadence;
    } else if (!existing.cadence && hit.cadence) {
      existing.cadence = hit.cadence;
    }

    if (confidenceRank(hit.confidence) > confidenceRank(existing.confidence)) {
      existing.confidence = hit.confidence;
    }
  }

  return [...map.values()].sort((a, b) => {
    const kind = kindRank(b.kind) - kindRank(a.kind);
    if (kind !== 0) return kind;
    return a.merchant.localeCompare(b.merchant);
  });
}

/**
 * Display-only. Does not refetch or reclassify.
 * Default: recurring on, sparse/free off.
 */
export function filterCandidates(
  candidates: ScanCandidate[],
  filters: DisplayFilters = DEFAULT_DISPLAY_FILTERS,
): ScanCandidate[] {
  return candidates.filter((c) => {
    if (c.kind === "recurring") return filters.recurring;
    if (c.kind === "sparse") return filters.sparse;
    return filters.free;
  });
}

/**
 * Upgrade path: account/security (free) + later money on the same
 * merchant+mailbox collapses to the money kind. Callers pass classified
 * hits in any order; money wins over free for the same merchant.
 *
 * Recurring and sparse of the same merchant stay separate rows.
 */
export function collapseFreeIntoMoney(
  candidates: ScanCandidate[],
): ScanCandidate[] {
  const freeByMerchant = new Map<string, ScanCandidate>();
  for (const c of candidates) {
    if (c.kind !== "free") continue;
    freeByMerchant.set(`${c.mailboxId}\0${c.merchantKey}`, c);
  }

  const moneyKeys = new Set<string>();
  const merged = candidates
    .filter((c) => c.kind !== "free")
    .map((c) => {
      if (c.kind !== "recurring" && c.kind !== "sparse") return c;
      const key = `${c.mailboxId}\0${c.merchantKey}`;
      moneyKeys.add(key);
      const free = freeByMerchant.get(key);
      if (!free) return c;
      const messageIds = [...c.messageIds];
      for (const id of free.messageIds) {
        if (!messageIds.includes(id)) messageIds.push(id);
      }
      return {
        ...c,
        evidence: [...c.evidence, ...free.evidence],
        messageIds,
      };
    });

  const leftoverFree = candidates.filter((c) => {
    if (c.kind !== "free") return false;
    return !moneyKeys.has(`${c.mailboxId}\0${c.merchantKey}`);
  });

  return [...merged, ...leftoverFree];
}

export function buildCandidateMap(hits: ClassifiedMessage[]): ScanCandidate[] {
  return collapseFreeIntoMoney(rollupCandidates(hits));
}
