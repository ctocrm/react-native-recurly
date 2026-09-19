/**
 * Self-heal re-enqueue (agreed 2026-09-11; fixes the placeholder flood found
 * that day): clearing icon_cache — the G1 gate wiped it on 2026-09-10 — used
 * to strand every EXISTING subscription on the "+" placeholder forever,
 * because scans only crawl NEW/updated rows, the 30-min interval only
 * re-fetches URLs of cache rows that still exist, and nothing ever
 * re-enqueued the rest (log evidence: `[ICON] <key> … bytes=0` for ~100 keys
 * with an empty icon_crawl_queue).
 *
 * Called at boot and on every foreground transition: every subscription
 * icon_key with no icon_cache row gets a fresh crawl. Keys are chained
 * exactly like the scan-fired crawl chain (scanCrawlChain, the 2026-09-05
 * OOM guard: one chained flow, never N concurrent discoveries), the pass
 * parks while an email scan runs (scanState), and it is single-flight.
 */
import {
  getQueuedIcons,
  listIconKeysMissingCache,
} from "@/services/database";
import {
  awaitCrawlCompletion,
  startIconCrawl,
} from "@/services/iconBackgroundCrawler";
import { waitIfScanActive } from "@/services/scanState";

let isSelfHealing = false;

export async function selfHealMissingIcons(): Promise<number> {
  if (isSelfHealing) {
    console.log("[HEAL] pass already running — skip");
    return 0;
  }
  isSelfHealing = true;
  try {
    await waitIfScanActive();
    const missing = await listIconKeysMissingCache();
    if (missing.length === 0) {
      console.log("[HEAL] every subscription has a cached icon");
      return 0;
    }
    const queued = new Set((await getQueuedIcons()).map((q) => q.icon_key));
    const keys = missing.filter((key) => !queued.has(key));
    const skipped = missing.length - keys.length;
    console.log(
      `[HEAL] ${keys.length} key(s) without a cached icon` +
        (skipped > 0 ? ` (${skipped} already queued — skipped)` : ""),
    );
    if (keys.length === 0) return 0;
    let chain: Promise<void> = Promise.resolve();
    for (const key of keys) {
      chain = chain
        .then(() => waitIfScanActive())
        .then(() => {
          console.log(`[HEAL] re-crawling ${key}`);
          return startIconCrawl(key);
        })
        // True serialization (OOM guard intent): startIconCrawl resolves at
        // setup — its discovery+fetch worker runs detached. Without this, a
        // ~100-key pass would stack ~100 discovery flows (the 2026-09-05
        // FATAL-at-192MB class the scan chain was written to prevent).
        .then(() => awaitCrawlCompletion(key))
        .catch((error) => {
          console.warn(`[HEAL] crawl failed for ${key}:`, error);
        });
    }
    await chain;
    console.log(`[HEAL] pass complete (${keys.length} key(s) re-crawled)`);
    return keys.length;
  } finally {
    isSelfHealing = false;
  }
}
