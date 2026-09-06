import { startIconCrawl } from "@/services/iconBackgroundCrawler";
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
let scanCrawlChain: Promise<void> = Promise.resolve();
function enqueueScanIconCrawl(
  iconKey: string,
  subscriptionId: string | undefined,
  officialDomain: string | null | undefined,
): Promise<void> {
  scanCrawlChain = scanCrawlChain
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
          const richer =
            (already.priceUnknown && !next.priceUnknown) ||
            (candidate.amount !== undefined &&
              candidate.amount !== already.price);
          if (richer && opts.updateSubscription) {
            await opts.updateSubscription(already.id, {
              price: next.price,
              priceUnknown: next.priceUnknown,
              currency: next.currency,
              billing: next.billing,
              frequency: next.frequency,
              category: next.category,
            });
            existingByKey.set(key, { ...already, ...next, id: already.id });
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
      errors.push(`${box.mailboxId}: ${message}`);
    }
  }

  return { imported, errors };
}
