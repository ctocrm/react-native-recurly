import {
  acquireEmailIconCollection,
  processIconQueue,
  startIconCrawl,
  tryApplyEmailIconDirect,
} from "@/services/iconBackgroundCrawler";
import {
  beginScan,
  endScan,
  waitIfScanActive,
} from "@/services/scanState";
import { createLegProgressLogger } from "./legProgress";
import {
  scanProgressFinish,
  scanProgressLegDone,
  scanProgressLegError,
  scanProgressLegStart,
  scanProgressListed,
  scanProgressStaged,
  scanProgressStart,
} from "./scanProgress";
import {
  DEEP_SCAN_BUDGET_MS,
  formatScanBudgetLine,
  shouldSkipRemainingLegs,
} from "./scanTotalBudget";
import { candidateToSubscription } from "./importCandidate";
import { nameToSlug } from "@/services/iconScraper";
import { listMailboxesAsync } from "./persist";
import {
  createMailProvider,
  MailConnectError,
  MailScanUnverifiedError,
} from "./providers";

// OOM guard (2026-09-05 crash, FATAL mqt_v_native at 192MB): the import used
// to fire startIconCrawl for EVERY new/updated subscription at once — eight
// concurrent discovery flows (search + scrape) running on top of the shared
// icon queue exhausted the Java heap mid-scan. Icon discovery is background
// work, so chain the scan-fired crawls: at most one discovery flow runs at a
// time while downloads inside the crawler stay bounded by DOWNLOAD_CONCURRENCY.
// Gate A (2026-09-11): each chained step additionally PARKS on waitIfScanActive
// so no crawl network competes with the mail legs; the chain stays serialized
// and the parked steps all resume, in enqueue order, when the scan ends.
let scanCrawlChain: Promise<void> = Promise.resolve();

/**
 * L2 residual (user-approved design): brand-sent email seeds for an
 * already-icon'd subscription are ACQUIRED into the crawl collection. The
 * quality scorer + report filter inside the promote path decide display —
 * the cache is never force-replaced here, and no web-crawl fallback runs
 * (an already-icon'd brand never triggers discovery).
 */
function enqueueEmailIconAcquisition(
  iconKey: string,
  emailIconUrls: string[],
): Promise<void> {
  scanCrawlChain = scanCrawlChain
    .then(() => waitIfScanActive())
    .then(async () => {
      await acquireEmailIconCollection(iconKey, emailIconUrls);
    })
    .catch((error) => {
      console.warn(
        `[MailScan] email icon acquisition failed for ${iconKey}:`,
        error,
      );
    });
  return scanCrawlChain;
}

function enqueueScanIconCrawl(
  iconKey: string,
  subscriptionId: string | undefined,
  officialDomain: string | null | undefined,
  emailIconUrls?: string[],
): Promise<void> {
  scanCrawlChain = scanCrawlChain
    .then(() => waitIfScanActive())
    .then(async () => {
      // Phase L: the brand's own email carries ranked logo URLs — try a
      // direct apply here at drain BEFORE any web discovery. Success skips
      // the crawl entirely; anything else falls back to the seeded crawl
      // (the previous behavior). The park above keeps this off the mail legs.
      if (await tryApplyEmailIconDirect(iconKey, emailIconUrls)) {
        console.log(
          `[MailScan] ${iconKey}: icon applied directly from email — web crawl skipped`,
        );
        return;
      }
      await startIconCrawl(iconKey, subscriptionId, {
        officialDomain: officialDomain ?? undefined,
        seedUrls: emailIconUrls,
      });
    })
    .catch((error) => {
      console.warn(`[MailScan] icon crawl failed for ${iconKey}:`, error);
    });
  return scanCrawlChain;
}

export async function importFromConnectedMailboxes(opts: {
  userId: string;
  existing: Subscription[];
  addSubscription: (subscription: Subscription) => Promise<void>;
  updateSubscription?: (
    id: string,
    data: Partial<Subscription>,
  ) => Promise<void>;
  /** Phase K: deep re-list — list entire history (user opted in). */
  deep?: boolean;
}): Promise<{ imported: number; errors: string[] }> {
  beginScan();
  try {
    return await runScan(opts);
  } finally {
    // Unpark the scan-fired crawls (still serialized by scanCrawlChain) and
    // resume the shared queue drain that Gate A paused mid-scan. Fired before
    // this function's own return-value continuation so the drain starts ASAP.
    endScan();
    void processIconQueue().catch(console.error);
  }
}

async function runScan(opts: {
  userId: string;
  existing: Subscription[];
  addSubscription: (subscription: Subscription) => Promise<void>;
  updateSubscription?: (
    id: string,
    data: Partial<Subscription>,
  ) => Promise<void>;
  /** Phase K: deep re-list — list entire history (user opted in). */
  deep?: boolean;
}): Promise<{ imported: number; errors: string[] }> {
  const boxes = await listMailboxesAsync();
  scanProgressStart(boxes.length, !!opts.deep);
  if (opts.deep) {
    console.log(
      "[MailScan] deep re-list: listing entire mailbox history (recency cap off, 60-min budget)",
    );
  }
  let imported = 0;
  const errors: string[] = [];
  // R28: rows match by merchant IDENTITY (name slug + mailbox), never by
  // display name or icon_key — "YouTube" vs "Youtube" variants (product map
  // vs From-host mint, or restore-era names) used to defeat the match and
  // MINT a duplicate card instead of repairing the row. icon_key is NOT
  // identity: it may be the default "plus" or a user-picked icon.
  const rowIdentity = (s: Subscription) =>
    `${nameToSlug(s.name).toLowerCase()}::${s.paymentMethod ?? ""}`;
  const existingByKey = new Map(
    opts.existing.map((s) => [rowIdentity(s), s]),
  );

  // R13: scan-wide budget — bounds TOTAL scan duration, not just per-leg
  // silence. Checked between legs only: an in-flight leg is never killed
  // mid-chunk (its own watchdog bounds silence), completed legs keep their
  // results, and endScan() still always runs in the caller's finally.
  const scanStartedAt = Date.now();
  for (let legIndex = 0; legIndex < boxes.length; legIndex += 1) {
    const box = boxes[legIndex];
    const elapsedMs = Date.now() - scanStartedAt;
    if (
      shouldSkipRemainingLegs(
        elapsedMs,
        opts.deep ? DEEP_SCAN_BUDGET_MS : undefined,
      )
    ) {
      console.log(formatScanBudgetLine(elapsedMs, boxes.length - legIndex));
      break;
    }
    // J3/I1: surface the leg to the in-app progress store.
    scanProgressLegStart(legIndex, box.mailboxId);
    // R13: one progress pacer per leg — a line every 30s plus a terminal line,
    // so a live scan reads as progress and a stalled leg is visible as silence.
    const pacer = createLegProgressLogger(box.mailboxId);
    let legCounted = false;
    try {
      const provider = createMailProvider(box.providerId, opts.userId);
      const result = await provider.scan({
        mailboxId: box.mailboxId,
        deep: opts.deep,
        onLegProgress: (staged) => {
          pacer.tick(staged);
          scanProgressStaged(staged);
        },
        onListProgress: (listed, total) => {
          scanProgressListed(listed, total);
        },
      });
      pacer.done(result.fetched, result.candidates.length);
      scanProgressLegDone();
      legCounted = true;
      const keep = result.candidates.filter(
        (c) =>
          c.kind === "recurring" || c.kind === "sparse" || c.kind === "free",
      );
      for (const candidate of keep) {
        const key = `${candidate.merchantKey.toLowerCase()}::${candidate.mailboxId}`;
        const already = existingByKey.get(key);
        const next = candidateToSubscription(candidate);
        if (already) {
          // R18: a SPARSE candidate must never repair a RECURRING row —
          // one-off purchases (xAI tokens, domain orders) are not the
          // subscription's price. A recurring candidate MAY repair a sparse
          // row (e.g. Porkbun's yearly order receipt).
          const kindCompatible =
            next.category === "recurring" || already.category === "sparse";
          // cadenceRepair: the candidate carries a confident cadence
          // (Yearly/Weekly — unknown maps to "Monthly" and no-ops) that
          // differs from the stored one. Repairs billing even when the
          // price is unchanged, so stale wrong-cadence rows heal.
          // R34: an EMPTY candidate cadence is NOT a repair — the guarded
          // un-stamp (cadenceClear below) owns clearing.
          const cadenceRepair =
            kindCompatible &&
            next.billing !== "" &&
            next.billing !== "Monthly" &&
            (already.billing !== next.billing ||
              already.frequency !== next.frequency);
          const richer =
            kindCompatible &&
            ((already.priceUnknown && !next.priceUnknown) ||
              (candidate.amount !== undefined &&
                candidate.amount !== already.price));
          const paperTrailBackfill =
            kindCompatible &&
            ((!already.sourceMessageId && !!next.sourceMessageId) ||
              (!already.billNumber && !!next.billNumber));
          // 2026-09-16: a promoted (clockwork) candidate or a $0→free flip
          // changes the row's STREAM with nothing else necessarily differing.
          const streamFlip =
            kindCompatible &&
            next.category !== already.category &&
            (next.category === "free" || next.category === "recurring");
          // R34: cadence un-stamp. A sparse row carrying a stored cadence the
          // corpus no longer supports (legacy default-cadence stamps —
          // "Uber $47.25 Monthly", "Intuit $680.92 Monthly") heals when the
          // merchant's own corpus evidences NO cadence across ≥2 messages.
          // cadenceRepair alone can never clear: it only writes non-Monthly
          // cadences. Scan-born rows only — a hand-entered row keeps its
          // cadence — and never on a recurring row (its cadence is
          // load-bearing).
          const cadenceClear =
            already.category === "sparse" &&
            next.category === "sparse" &&
            next.billing === "" &&
            already.billing !== "" &&
            (candidate.messageIds?.length ?? 0) >= 2 &&
            !!already.sourceMessageId;
          if (
            (richer ||
              cadenceRepair ||
              paperTrailBackfill ||
              streamFlip ||
              cadenceClear) &&
            opts.updateSubscription
          ) {
            // 2026-09-16 (user rule): the stream CAN flip when the evidence
            // does — a $0 candidate is free by definition, and a promoted
            // clockwork-regular candidate upgrades its sparse row to
            // recurring (importCandidate/rollup decide the stream now).
            const category =
              next.category === "free" || next.category === "recurring"
                ? next.category
                : already.category;
            const patch: Partial<Subscription> = {
              category,
            };
            // R34: billing rides the patch only when the candidate carries a
            // cadence or the stamp is being cleared — a paper-trail backfill
            // alone must never rewrite (or wipe) a row's cadence.
            if (next.billing !== "" || cadenceRepair || cadenceClear) {
              patch.billing = next.billing;
              patch.frequency = next.frequency;
            }
            if (richer) {
              patch.price = next.price;
              patch.priceUnknown = next.priceUnknown;
              patch.currency = next.currency;
            }
            // R22: backfill the R18 paper-trail when the stored row predates
            // it or arrived through the rollup path that dropped messageIds
            // (Audible showed Source email "—" forever). Never overwrites.
            if (!already.sourceMessageId && next.sourceMessageId) {
              patch.sourceMessageId = next.sourceMessageId;
            }
            if (!already.billNumber && next.billNumber) {
              patch.billNumber = next.billNumber;
            }
            await opts.updateSubscription(already.id, patch);
            existingByKey.set(key, { ...already, ...patch, id: already.id });
            imported += 1;
          }
          const existingKey = already.icon_key;
          if (!existingKey || existingKey === "plus") {
            const crawlKey = next.icon_key;
            if (crawlKey && crawlKey !== "plus") {
              if (opts.updateSubscription && existingKey !== crawlKey) {
                await opts.updateSubscription(already.id, {
                  icon_key: crawlKey,
                });
                existingByKey.set(key, {
                  ...(existingByKey.get(key) ?? already),
                  icon_key: crawlKey,
                });
              }
              enqueueScanIconCrawl(
                crawlKey,
                already.id,
                candidate.officialDomain,
                candidate.emailIconUrls,
              );
            }
          } else if (candidate.emailIconUrls?.length) {
            // L2 residual: the brand already has an icon, but its own email
            // carried ranked logo seeds — acquire them into the collection
            // and let the quality scorer + report filter decide display.
            enqueueEmailIconAcquisition(existingKey, candidate.emailIconUrls);
          }
          continue;
        }
        await opts.addSubscription(next);
        existingByKey.set(key, next);
        imported += 1;
        if (next.icon_key && next.icon_key !== "plus") {
          enqueueScanIconCrawl(
            next.icon_key,
            next.id,
            candidate.officialDomain,
            candidate.emailIconUrls,
          );
        }
      }
    } catch (error) {
      const message =
        error instanceof MailScanUnverifiedError ||
        error instanceof MailConnectError
          ? error.message
          : error instanceof Error
            ? error.message
            : "scan failed";
      // LESSONS 26 (R20 gate): this catch used to swallow the error silently —
      // the workspace leg logged `fetcherFor` then vanished from the 66-min
      // log (no summary, no error). The leg failure must reach logcat.
      console.warn(
        `[MailScan] leg failed ${box.providerId} ${box.mailboxId}: ${message}`,
        error,
      );
      errors.push(`${box.mailboxId}: ${message}`);
      if (!legCounted) scanProgressLegError(message);
    }
  }

  scanProgressFinish(imported, errors);
  return { imported, errors };
}
