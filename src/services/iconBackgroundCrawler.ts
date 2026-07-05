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
import { extractIconsFromUrls } from "@/src/services/htmlIconExtractor";
import { setIconLoading } from "@/src/services/iconLoadingRegistry";
import {
  findAllIconSources
} from "@/src/services/iconScraper";
import { searchAllSources } from "@/src/services/searchEngines";

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

/**
 * Detect image format from a URL's file extension.
 */
function detectUrlFormat(url: string): string {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  if (clean.endsWith(".svg")) return "svg";
  if (clean.endsWith(".ico")) return "ico";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpg";
  if (clean.endsWith(".webp")) return "webp";
  if (clean.endsWith(".gif")) return "gif";
  return "png"; // default fallback
}

/**
 * Download an icon URL to base64, with format auto-detection.
 * Uses a single fetch path since downloadIconAsBase64 doesn't vary by format.
 */
async function downloadImageAsBase64(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });
    clearTimeout(timer);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  } catch {
    return null;
  }
}

async function crawlIcon(icon_key: string): Promise<boolean> {
  console.log(`Crawling icon for ${icon_key}`);

  const discoveredIcons: DiscoveredIcon[] = [];

  // =========================================================
  // TIER 1: Icon library CDNs (simple-icons, tabler, devicons, etc.)
  // =========================================================
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

  // =========================================================
  // TIER 2: Favicon extraction from likely domains
  // =========================================================
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

  // =========================================================
  // TIER 3: Multi-engine image search + Google dork searches (REAL WEB CRAWLER)
  // =========================================================
  if (discoveredIcons.length === 0) {
    console.log(`Searching web for ${icon_key} (engines + dorks)...`);

    // Run all search engine queries + dorks
    const searchResults = await searchAllSources(icon_key);

    // Extract link URLs from search results to spider
    const linkUrls: string[] = [];
    const directImageUrls: string[] = [];

    for (const result of searchResults) {
      // Direct image URLs (from image search results)
      if (
        result.url.endsWith(".svg") ||
        result.url.endsWith(".png") ||
        result.url.endsWith(".jpg") ||
        result.url.endsWith(".jpeg") ||
        result.url.endsWith(".ico") ||
        result.url.endsWith(".webp")
      ) {
        directImageUrls.push(result.url);
      } else if (
        !result.url.includes("google.com") &&
        !result.url.includes("bing.com") &&
        !result.url.includes("duckduckgo.com") &&
        !result.url.includes("yandex.com")
      ) {
        // Non-image URLs from search results - these are pages to spider
        linkUrls.push(result.url);
      }
    }

    // Download direct image URLs (limit to first 15)
    const directDownloadLimit = Math.min(directImageUrls.length, 15);
    for (let i = 0; i < directDownloadLimit; i++) {
      const url = directImageUrls[i];
      const base64Data = await downloadImageAsBase64(url);
      if (base64Data) {
        discoveredIcons.push({
          base64: base64Data,
          source: "web_search",
          format: detectUrlFormat(url),
          originalUrl: url,
          fallbackTier: discoveredIcons.length,
        });
        // Limit to 5 successful downloads from direct URLs
        if (
          discoveredIcons.filter((d) => d.source === "web_search").length >= 5
        )
          break;
      }
    }

    // If still no icons found, spider the link URLs (follow them and extract icons from HTML)
    if (discoveredIcons.length === 0 && linkUrls.length > 0) {
      console.log(`Spidering ${linkUrls.length} URLs for ${icon_key}...`);
      const spideredIcons = await extractIconsFromUrls(linkUrls, icon_key);

      // Download icons found from spidering (limit to first 5 unique)
      let spiderDownloads = 0;
      for (const icon of spideredIcons) {
        if (spiderDownloads >= 5) break;

        // Skip URLs we've already tried
        if (discoveredIcons.some((d) => d.originalUrl === icon.url)) continue;

        const base64Data = await downloadImageAsBase64(icon.url);
        if (base64Data) {
          discoveredIcons.push({
            base64: base64Data,
            source: `spider:${icon.source}`,
            format: icon.format,
            originalUrl: icon.url,
            fallbackTier: discoveredIcons.length,
          });
          spiderDownloads++;
        }
      }
    }
  }

  // =========================================================
  // Save results
  // =========================================================
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

    // Cache the best icon (lowest fallback tier = first discovered)
    const bestIcon = discoveredIcons.reduce((prev, curr) =>
      prev.fallbackTier < curr.fallbackTier ? prev : curr,
    );

    await setCachedIcon(
      icon_key,
      bestIcon.base64,
      bestIcon.source,
      bestIcon.format,
      bestIcon.originalUrl,
    );
    await dequeueIcon(icon_key);
    console.log(
      `Cached icon for ${icon_key} (${bestIcon.format}) from ${bestIcon.source}`,
    );
    return true;
  } else {
    console.log(
      `No icon found for ${icon_key} after all searches, leaving in queue for retry`,
    );
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
