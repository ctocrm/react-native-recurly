import {
  dequeueIcon,
  enqueueIconScrape,
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

async function crawlIcon(icon_key: string): Promise<void> {
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
      // Save to crawl results for icon picker
      await saveCrawlResult(
        icon_key,
        base64Data,
        libIcon.source,
        libIcon.format,
        libIcon.url,
      );
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
        // Save favicon as crawl result
        await saveCrawlResult(
          icon_key,
          base64Data,
          "favicon",
          faviconResult.format,
          faviconResult.url,
        );
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
    // No icon found - leave in queue for retry on next app launch
    console.log(`No icon found for ${icon_key}, leaving in queue for retry`);
  }
}

// Process all queued icons (used on app startup)
export async function processIconQueue(): Promise<void> {
  const { getQueuedIcons } = await import("@/services/database");
  const queued = await getQueuedIcons();

  for (const item of queued) {
    setIconLoading(item.icon_key, true);
    try {
      await crawlIcon(item.icon_key);
    } catch (error) {
      console.error(`Failed to crawl icon for ${item.icon_key}:`, error);
      // Leave in queue for retry
    } finally {
      setIconLoading(item.icon_key, false);
    }
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
