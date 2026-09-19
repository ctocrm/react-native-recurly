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
import { inferCadenceFromPayments } from "./classifier";

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
  const datesByKey = new Map<string, string[]>();
  const amountsByKey = new Map<string, number[]>();

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
        officialDomain: hit.officialDomain ?? null,
        kind: hit.kind,
        amount: hit.amount,
        currency: hit.currency,
        cadence: hit.cadence,
        billNumber: hit.billNumber ?? null,
        nextDate: undefined,
        amountUnknown: hit.amountUnknown || hit.amount === undefined,
        evidence,
        messageIds: [messageId],
        confidence: hit.confidence,
        ...(hit.emailIconUrls?.length
          ? { emailIconUrls: [...hit.emailIconUrls] }
          : {}),
      });
      datesByKey.set(key, [hit.message.date]);
      if (hit.amount !== undefined) {
        amountsByKey.set(key, [hit.amount]);
      }
      continue;
    }

    if (!existing.messageIds.includes(messageId)) {
      existing.messageIds.push(messageId);
    }
    datesByKey.set(key, [...(datesByKey.get(key) ?? []), hit.message.date]);
    if (hit.amount !== undefined) {
      amountsByKey.set(key, [...(amountsByKey.get(key) ?? []), hit.amount]);
    }
    existing.evidence = [...existing.evidence, ...evidence];

    if (hit.amount !== undefined) {
      // R38 P3 audit fix: a $0 receipt must not collapse a merchant that has
      // real charges (a comp/statement tail arriving last would otherwise
      // roll the candidate up as free and flip its paid row via the scan's
      // free-stream rules). Pure-$0 corpora (license mail) stay $0 -> free.
      const corpus = amountsByKey.get(key) ?? [];
      const hasNonzero = corpus.some((a) => a > 0);
      if (hit.amount === 0 && hasNonzero) {
        if (existing.amount === undefined || existing.amount === 0) {
          const lastNonzero = [...corpus].reverse().find((a) => a > 0);
          if (lastNonzero !== undefined) {
            existing.amount = lastNonzero;
            existing.amountUnknown = false;
          }
        }
      } else {
        existing.amount = hit.amount;
        existing.currency = hit.currency ?? existing.currency;
        existing.amountUnknown = false;
      }
    } else if (existing.amount === undefined) {
      existing.amountUnknown = true;
    }

    if (hit.cadence && hit.cadence !== "unknown") {
      existing.cadence = hit.cadence;
    } else if (!existing.cadence && hit.cadence) {
      existing.cadence = hit.cadence;
    }
    if (hit.billNumber) {
      existing.billNumber = hit.billNumber;
    }

    // Phase C: merge brand-sent icon seeds best-first; later emails only add
    // URLs the earlier ones missed. Capped like the extractor (5).
    if (hit.emailIconUrls?.length) {
      const merged = existing.emailIconUrls ?? [];
      for (const url of hit.emailIconUrls) {
        if (!merged.includes(url)) merged.push(url);
      }
      existing.emailIconUrls = merged.slice(0, 5);
    }

    if (confidenceRank(hit.confidence) > confidenceRank(existing.confidence)) {
      existing.confidence = hit.confidence;
    }
    if (!existing.officialDomain && hit.officialDomain) {
      existing.officialDomain = hit.officialDomain;
    }
  }

  // R18: clockwork inference — a RECURRING candidate whose emails never name
  // a cadence still gets one when the charge spacing is clockwork-regular.
  // Regex always wins (applied above); sparse is never inferred/promoted.
  for (const [key, candidate] of map) {
    if (
      candidate.kind === "recurring" &&
      (!candidate.cadence || candidate.cadence === "unknown")
    ) {
      const inferred = inferCadenceFromPayments(datesByKey.get(key) ?? []);
      if (inferred) {
        candidate.cadence = inferred;
        candidate.evidence = [
          ...candidate.evidence,
          `cadence:clockwork-${inferred}`,
        ];
        continue;
      }
    }
    // 2026-09-16 (user direction — supersedes the R18 "sparse never
    // promoted" line): a SPARSE group whose charges are clockwork-regular
    // AND amount-consistent is a subscription the emails never named. Same
    // strict spacing evidence as R18 (≥3 charges, every gap inside one
    // band), plus every amount within ±25% of the median (the "price
    // changes slightly" tolerance). Promoted candidates heal their stored
    // sparse rows via the scan's recurring-repairs-sparse rule.
    if (
      candidate.kind === "sparse" &&
      (!candidate.cadence || candidate.cadence === "unknown")
    ) {
      const dates = [...(datesByKey.get(key) ?? [])].sort();
      const amounts = amountsByKey.get(key) ?? [];
      const inferred = inferCadenceFromPayments(dates);
      if (!inferred || amounts.length < 3) continue;
      const sorted = [...amounts].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      const consistent = median > 0 && sorted[0] >= median * 0.75 && sorted[sorted.length - 1] <= median * 1.25;
      if (consistent) {
        candidate.kind = "recurring";
        candidate.cadence = inferred;
        candidate.amount = median;
        candidate.amountUnknown = false;
        candidate.evidence = [
          ...candidate.evidence,
          `cadence:clockwork-promoted-${inferred}`,
        ];
      }
    }
  }

  // Scan-date bug fix: the corpus's earliest email date rides the candidate
  // so the import mints the row's start from evidence, never from the scan
  // wall-clock. ISO dates sort lexicographically.
  for (const [key, candidate] of map) {
    const dates = datesByKey.get(key);
    if (dates?.length) {
      candidate.firstSeen = [...dates].sort()[0];
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
        // The account starts when its earliest mail arrived — an absorbed
        // free welcome email can pull the money row's start earlier, never
        // later.
        ...(free.firstSeen && (!c.firstSeen || free.firstSeen < c.firstSeen)
          ? { firstSeen: free.firstSeen }
          : {}),
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
