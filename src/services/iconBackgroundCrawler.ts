import {
  dequeueIcon,
  enqueueIconScrape,
  getQueuedIcons,
  saveCrawlResult,
  setCachedIcon,
} from "../../services/database";
import { downloadFaviconAsBase64, extractFavicon } from "./faviconExtractor";
import { setIconLoading } from "./iconLoadingRegistry";
import {
  downloadIconAsBase64,
  findAllIconSources
} from "./iconScraper";

// Reentrancy guard: prevents concurrent runs of processIconQueue
let isProcessing = false;

// Process queued icons in FIFO order
export async function processIconQueue(): Promise<void> {
  if (isProcessing) {
    console.log("processIconQueue already running, skipping...");
    return;
  }

  isProcessing = true;

  try {
    const queuedIcons = await getQueuedIcons();
    console.log(`Processing ${queuedIcons.length} queued icons`);

    for (const { icon_key } of queuedIcons) {
      try {
        // Mark as loading
        setIconLoading(icon_key, true);

        // Try ALL icon libraries and save each discovered icon
        const allLibraryResults = await findAllIconSources(icon_key);
        const discoveredIcons: {
          base64: string;
          source: string;
          format: string;
          originalUrl: string;
          fallbackTier: number;
        }[] = [];

        // Process each library source
        for (const [idx, libraryResult] of allLibraryResults.entries()) {
          const base64Data = await downloadIconAsBase64(
            libraryResult.url,
            libraryResult.format,
          );
          if (base64Data) {
            // Save all discovered icons to crawl results
            await saveCrawlResult(
              icon_key,
              base64Data,
              libraryResult.source,
              libraryResult.format,
              libraryResult.url,
              idx,
            );
            discoveredIcons.push({
              base64: base64Data,
              source: libraryResult.source,
              format: libraryResult.format,
              originalUrl: libraryResult.url,
              fallbackTier: idx,
            });
          }
        }

        // If no library icon, try favicon extraction
        let faviconResult = await extractFavicon(icon_key);
        while (faviconResult) {
          const base64Data = await downloadFaviconAsBase64(
            faviconResult.url,
            faviconResult.format,
          );
          if (base64Data) {
            // Save favicon as crawl result
            await saveCrawlResult(
              icon_key,
              base64Data,
              "favicon",
              faviconResult.format,
              faviconResult.url,
              discoveredIcons.length,
            );
            discoveredIcons.push({
              base64: base64Data,
              source: "favicon",
              format: faviconResult.format,
              originalUrl: faviconResult.url,
              fallbackTier: discoveredIcons.length,
            });
            break; // Only save first successful favicon
          }
          // Try next favicon result if available
          faviconResult = null;
        }

        // Cache the best icon (lowest fallback tier) if any discovered
        if (discoveredIcons.length > 0) {
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
        } else {
          // No icon found - definitive "not found", remove from queue
          await dequeueIcon(icon_key);
          console.log(`No icon found for ${icon_key}, removed from queue`);
        }
      } catch (error) {
        // On error, do NOT dequeue - leave it for retry on next run
        console.error(`Error processing icon ${icon_key}, will retry:`, error);
      } finally {
        // Mark as no longer loading
        setIconLoading(icon_key, false);
      }
    }
  } finally {
    isProcessing = false;
  }
}

// Queue icon for background processing
export async function queueIconForScraping(
  iconKey: string,
  subscriptionId?: string,
): Promise<void> {
  await enqueueIconScrape(iconKey, subscriptionId);
}
