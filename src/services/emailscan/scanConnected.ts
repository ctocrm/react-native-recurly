import { processIconQueue, startIconCrawl } from "@/services/iconBackgroundCrawler";
import {
  beginScan,
  endScan,
  waitIfScanActive,
} from "@/services/scanState";
import { candidateToSubscription } from "./importCandidate";
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
function enqueueScanIconCrawl(
  iconKey: string,
  subscriptionId: string | undefined,
  officialDomain: string | null | undefined,
): Promise<void> {
  scanCrawlChain = scanCrawlChain
    .then(() => waitIfScanActive())
    .then(() =>
      startIconCrawl(iconKey, subscriptionId, {
        officialDomain: officialDomain ?? undefined,
      }),
    )
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
}): Promise<{ imported: number; errors: string[] }> {
  const boxes = await listMailboxesAsync();
  let imported = 0;
  const errors: string[] = [];
  const existingByKey = new Map(
    opts.existing.map((s) => [`${s.name}::${s.paymentMethod ?? ""}`, s]),
  );

  for (const box of boxes) {
    try {
      const provider = createMailProvider(box.providerId, opts.userId);
      const result = await provider.scan({ mailboxId: box.mailboxId });
      const keep = result.candidates.filter(
        (c) =>
          c.kind === "recurring" || c.kind === "sparse" || c.kind === "free",
      );
      for (const candidate of keep) {
        const key = `${candidate.merchant}::${candidate.mailboxId}`;
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
          const cadenceRepair =
            kindCompatible &&
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
          if (
            (richer || cadenceRepair || paperTrailBackfill) &&
            opts.updateSubscription
          ) {
            const patch: Partial<Subscription> = {
              billing: next.billing,
              frequency: next.frequency,
              // repairs never flip the row's stream; import decides it once
              category: already.category,
            };
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
              );
            }
          }
          continue;
        }
        await opts.addSubscription(next);
        existingByKey.set(key, next);
        imported += 1;
        if (next.icon_key && next.icon_key !== "plus") {
          enqueueScanIconCrawl(next.icon_key, next.id, candidate.officialDomain);
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
    }
  }

  return { imported, errors };
}
