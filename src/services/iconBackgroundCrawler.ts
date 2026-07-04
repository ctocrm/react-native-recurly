import {
  deleteCrawlResults,
  dequeueIcon,
  enqueueIconScrape,
  getQueuedIcons,
  incrementQueueAttempt,
  saveCrawlResult,
  setCachedIcon,
} from "@/services/database";
import {
  downloadFaviconAsBase64,
  extractFavicon,
} from "@/src/services/faviconExtractor";
import { setIconLoading } from "@/src/services/iconLoadingRegistry";
import { findAllIconSources } from "@/src/services/iconScraper";

interface DiscoveredIcon {
  base64: string;
  source: string;
  format: string;
  originalUrl: string;
  fallbackTier: number;
}

// In-flight guard to prevent concurrent processIconQueue execution
let isProcessingQueue = false;
let pendingReprocess = false;

// Max retry attempts for icons that fail to be discovered
const MAX_RETRY_ATTEMPTS = 3;

async function crawlIcon(icon_key: string): Promise<boolean> {
  // Returns true if icon was found and cached, false otherwise
  console.log(`Crawling icon for ${icon_key}`);

  const discoveredIcons: DiscoveredIcon[] = [];

  // First, try library icons (simple-icons, tabler)
  const libraryIcons = await findAllIconSources(icon_key);
  for (const libIcon of libraryIcons) {
    const base64Data = await downloadFaviconAsBase64(
      libIcon.url,
      libIcon.format,
    );
    if (base64Data) {
      discoveredIcons.push({
        base64: base64Data,
        source: libIcon.source,
        format: libIcon.format,
        originalUrl: libIcon.url,
        fallbackTier: discoveredIcons.length,
      });
    }
  }

  // If no library icon, try favicon extraction
  if (discoveredIcons.length === 0) {
    const faviconResult = await extractFavicon(icon_key);
    if (faviconResult) {
      const base64Data = await downloadFaviconAsBase64(
        faviconResult.url,
        faviconResult.format,
      );
      if (base64Data) {
        discoveredIcons.push({
          base64: base64Data,
          source: "favicon",
          format: faviconResult.format,
          originalUrl: faviconResult.url,
          fallbackTier: 0,
        });
      }
    }
  }

  // Save results (idempotently: delete existing for this icon_key first if any found)
  if (discoveredIcons.length > 0) {
    await deleteCrawlResults(icon_key);
    for (const icon of discoveredIcons) {
      await saveCrawlResult(
        icon_key,
        icon.base64,
        icon.source,
        icon.format,
        icon.originalUrl,
      );
    }

    // Cache the best icon (lowest fallback tier)
    const bestIcon = discoveredIcons.reduce((prev, curr) =>
      prev.fallbackTier < curr.fallbackTier ? prev : curr,
    );

    await setCachedIcon(
      icon_key,
      bestIcon.base64,
      "base64",
      bestIcon.format,
      bestIcon.originalUrl,
    );
    await dequeueIcon(icon_key);
    console.log(
      `Cached icon for ${icon_key} (${bestIcon.format}) from ${bestIcon.source}`,
    );
    return true;
  } else {
    // No icon found - leave in queue for retry on next app launch
    console.log(`No icon found for ${icon_key}, leaving in queue for retry`);
    return false;
  }
}

// Process all queued icons (used on app startup)
export async function processIconQueue(): Promise<void> {
  // Guard: prevent concurrent execution but track new items for reprocess
  if (isProcessingQueue) {
    console.log(
      "processIconQueue already running, scheduling reprocess after current pass",
    );
    pendingReprocess = true;
    return;
  }

  isProcessingQueue = true;
  try {
    do {
      const hadExternalRequest = pendingReprocess;
      pendingReprocess = false;

      const initialQueueCount = (await getQueuedIcons()).length;

      const queued = await getQueuedIcons();

      for (const item of queued) {
        // Check retry limit and handle failures
        if (item.attempt_count >= MAX_RETRY_ATTEMPTS) {
          console.log(
            `Skipping ${item.icon_key} - max retries (${MAX_RETRY_ATTEMPTS}) exceeded`,
          );
          await dequeueIcon(item.icon_key);
          continue;
        }

        setIconLoading(item.icon_key, true);
        try {
          const found = await crawlIcon(item.icon_key);
          if (!found) {
            // Icon not found - increment attempt count for retry
            await incrementQueueAttempt(item.icon_key);
            // Check if max retries reached after increment
            const updatedItem = await getQueuedIcons().then((items) =>
              items.find((i) => i.icon_key === item.icon_key),
            );
            if (
              updatedItem &&
              (updatedItem?.attempt_count ?? 0) >= MAX_RETRY_ATTEMPTS
            ) {
              console.log(
                `Max retries reached for ${item.icon_key}, giving up`,
              );
              await dequeueIcon(item.icon_key);
            }
          }
        } catch (error) {
          console.error(`Failed to crawl icon for ${item.icon_key}:`, error);
          // Increment attempt count on unexpected errors too
          await incrementQueueAttempt(item.icon_key);
          // Check if max retries reached after increment
          const updatedItem = await getQueuedIcons().then((items) =>
            items.find((i) => i.icon_key === item.icon_key),
          );
          if (
            updatedItem &&
            (updatedItem?.attempt_count ?? 0) >= MAX_RETRY_ATTEMPTS
          ) {
            console.log(
              `Max retries reached for ${item.icon_key} (due to errors), giving up`,
            );
            await dequeueIcon(item.icon_key);
          }
        } finally {
          setIconLoading(item.icon_key, false);
        }
      }

      // Re-process if: external request came in OR new items were queued during processing
      const finalQueueCount = (await getQueuedIcons()).length;
      if (hadExternalRequest || finalQueueCount > initialQueueCount) {
        pendingReprocess = true;
      }
    } while (pendingReprocess);
  } finally {
    isProcessingQueue = false;
    pendingReprocess = false;
  }
}

// Public API for adding to queue and processing
export async function queueIconForScraping(
  icon_key: string,
  subscriptionId?: string,
): Promise<void> {
  await enqueueIconScrape(icon_key, subscriptionId);
  await processIconQueue();
}
