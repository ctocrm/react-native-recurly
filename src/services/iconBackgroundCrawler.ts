import { icons } from "@/constants/icons";
import {
  dequeueIcon,
  enqueueIconScrape,
  getCachedIcon,
  getCrawlResults,
  getQueuedIcons,
  isUrlAlreadyCrawled,
  isUrlAlreadyCrawledBatch,
  saveCrawlResult,
  setCachedIcon,
} from "@/services/database";
import { extractFavicon } from "@/src/services/faviconExtractor";
import { extractIconsFromUrls } from "@/src/services/htmlIconExtractor";
import {
  notifyCacheUpdate,
  setIconLoading,
} from "@/src/services/iconLoadingRegistry";
import { findAllIconSources } from "@/src/services/iconScraper";
import { searchAllSources } from "@/src/services/searchEngines";

// In-flight guard
let isProcessingQueue = false;

const MAX_LIBRARY_CANDIDATES = 50;
const MAX_SPIDERED_URLS = 20;
const MAX_SPIDERED_ICONS = 15;
const MAX_WEB_SEARCH_RESULTS = 50;

function detectUrlFormat(url: string): string {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  if (clean.endsWith(".svg")) return "svg";
  if (clean.endsWith(".ico")) return "ico";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpg";
  if (clean.endsWith(".webp")) return "webp";
  if (clean.endsWith(".gif")) return "gif";
  return "png";
}

// Load local icon asset as base64
async function loadLocalIconAsBase64(iconKey: string): Promise<string | null> {
  const iconSource = icons[iconKey as keyof typeof icons];
  if (!iconSource) {
    console.log(`[LOCAL] No local icon found for key: ${iconKey}`);
    return null;
  }
  console.log(`[LOCAL] Using local icon for ${iconKey}`);
  return `local_asset:${iconKey}`;
}

// Download image and save to DB
async function downloadImageAsBase64(
  url: string,
  source: string,
  iconKey: string,
): Promise<boolean> {
  try {
    console.log(`[FETCH] DOWNLOAD: ${source} ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "image/*,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.log(`[FETCH] FAILED ${url}: ${response.status}`);
      return false;
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const b64 = btoa(binary);
    console.log(`[FETCH] SUCCESS: ${url} (${b64.length} bytes)`);

    await saveCrawlResult(iconKey, b64, source, detectUrlFormat(url), url);
    notifyCacheUpdate();
    return true;
  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.log(`[FETCH] ERROR ${url}:`, err);
    }
    return false;
  }
}

// Get icon collection for picker
export async function getIconCollection(iconKey: string): Promise<{
  cachedIconUri: string | null;
  cachedFormat: string | null;
  icons: {
    imageData: string;
    source: string;
    format: string;
    originalUrl: string | null;
  }[];
}> {
  try {
    console.log(`[COLLECTION] Loading icons for ${iconKey}`);
    const cached = await getCachedIcon(iconKey);
    const results = await getCrawlResults(iconKey);

    const iconMap = new Map<
      string,
      {
        imageData: string;
        source: string;
        format: string;
        originalUrl: string | null;
      }
    >();

    // Add cached icon to collection FIRST
    if (cached) {
      console.log(`[COLLECTION] Found cached icon for ${iconKey}`);
      iconMap.set(cached.imageData, {
        imageData: cached.imageData,
        source: cached.source,
        format: cached.format,
        originalUrl: cached.originalUrl,
      });
    }

    // Add database crawl results to collection
    for (const r of results) {
      if (!iconMap.has(r.imageData)) {
        iconMap.set(r.imageData, {
          imageData: r.imageData,
          source: r.source,
          format: r.format,
          originalUrl: r.originalUrl,
        });
      }
    }

    // ALWAYS add subscription's local icon asset to collection
    const localBase64 = await loadLocalIconAsBase64(iconKey);
    if (localBase64 && !iconMap.has(localBase64)) {
      iconMap.set(localBase64, {
        imageData: localBase64,
        source: "subscription",
        format: "png",
        originalUrl: null,
      });
      console.log(`[COLLECTION] Added subscription icon to collection`);
    }

    // Sort: subscription first, then cached, then others
    const sorted = Array.from(iconMap.values()).sort((a, b) => {
      if (a.source === "subscription") return -1;
      if (b.source === "subscription") return 1;
      return 0;
    });

    console.log(`[COLLECTION] Returning ${sorted.length} icons`);
    return {
      cachedIconUri: cached?.imageData
        ? `data:${detectUrlFormat(cached.format)};base64,${cached.imageData}`
        : null,
      cachedFormat: cached?.format ?? null,
      icons: sorted,
    };
  } catch (err) {
    console.error("[COLLECTION] Failed:", err);
    return { cachedIconUri: null, cachedFormat: null, icons: [] };
  }
}

// PHASE 1: Find URLs to download (LOCAL + LIBRARIES + CDN + FAVICON + SEARCH + SPIDER)
// This is called when user types or taps search - spinner stops after this returns
export async function findIconUrls(iconKey: string): Promise<void> {
  console.log(`[SEARCH] ===== STARTING SEARCH for ${iconKey} =====`);

  const existing = await getCrawlResults(iconKey);
  const existingUrls = new Set(
    existing.map((r) => r.originalUrl).filter((u): u is string => Boolean(u)),
  );

  // LOCAL ICON - immediate, no download needed
  console.log(`[SEARCH] LOCAL: Checking for ${iconKey}`);
  const localIcon = icons[iconKey as keyof typeof icons];
  if (localIcon) {
    console.log(`[SEARCH] LOCAL: Found local icon`);
  }

  // TIER 1: Library CDNs (Simple Icons, Tabler, Lucide, etc.) - FIND URLs
  console.log(`[SEARCH] TIER 1: Library CDNs`);
  const libraryIcons = await findAllIconSources(iconKey);
  console.log(`[SEARCH] TIER 1: Found ${libraryIcons.length} library icons`);
  const alreadyCrawledLibraries = await isUrlAlreadyCrawledBatch(
    libraryIcons.slice(0, MAX_LIBRARY_CANDIDATES).map((i) => i.url),
  );

  // Add library URLs to crawl_results (so they're tracked)
  for (const libIcon of libraryIcons.slice(0, MAX_LIBRARY_CANDIDATES)) {
    if (
      !existingUrls.has(libIcon.url) &&
      !alreadyCrawledLibraries.has(libIcon.url)
    ) {
      await saveCrawlResult(
        iconKey,
        "",
        libIcon.source,
        libIcon.format,
        libIcon.url,
      );
    }
  }

  // TIER 2: Favicon extraction - FIND URL
  console.log(`[SEARCH] TIER 2: Favicon`);
  const faviconResult = await extractFavicon(iconKey);
  if (faviconResult && !existingUrls.has(faviconResult.url)) {
    await saveCrawlResult(
      iconKey,
      "",
      "favicon",
      faviconResult.format,
      faviconResult.url,
    );
    console.log(`[SEARCH] TIER 2: Found favicon URL`);
  } else {
    console.log(`[SEARCH] TIER 2: No favicon found`);
  }

  // TIER 3: Web search + SPIDER - FIND URLs
  console.log(`[SEARCH] TIER 3: Web search`);
  const searchResults = await searchAllSources(iconKey);
  console.log(`[SEARCH] TIER 3: Found ${searchResults.length} results`);
  const linkUrls: string[] = [];

  for (const result of searchResults.slice(0, MAX_WEB_SEARCH_RESULTS)) {
    if (existingUrls.has(result.url)) continue;
    const isImage =
      result.url.match(/\.(svg|png|jpg|jpeg|ico|webp|gif)(\?|$)/i) ||
      result.url.includes("logo") ||
      result.url.includes("icon");
    if (isImage) {
      await saveCrawlResult(
        iconKey,
        "",
        "web_search",
        detectUrlFormat(result.url),
        result.url,
      );
    } else if (
      !result.url.includes("google.com") &&
      !result.url.includes("bing.com") &&
      !result.url.includes("duckduckgo.com") &&
      !result.url.includes("yandex.com")
    ) {
      linkUrls.push(result.url);
    }
  }

  // SPIDER: Extract icons from link pages - FIND URLs
  console.log(`[SEARCH] SPIDER: Processing ${linkUrls.length} links`);
  if (linkUrls.length > 0) {
    const uncrawledLinks = (
      await Promise.all(
        linkUrls
          .slice(0, MAX_SPIDERED_URLS)
          .map(async (u) => ((await isUrlAlreadyCrawled(u)) ? null : u)),
      )
    ).filter((u): u is string => u !== null);

    if (uncrawledLinks.length > 0) {
      console.log(`[SEARCH] SPIDER: Fetching ${uncrawledLinks.length} pages`);
      const spideredIcons = await extractIconsFromUrls(uncrawledLinks, iconKey);
      console.log(`[SEARCH] SPIDER: Found ${spideredIcons.length} icon URLs`);
      for (const icon of spideredIcons.slice(0, MAX_SPIDERED_ICONS)) {
        if (!existingUrls.has(icon.url)) {
          await saveCrawlResult(
            iconKey,
            "",
            `spider:${icon.source}`,
            icon.format,
            icon.url,
          );
        }
      }
    }
  }

  console.log(`[SEARCH] Search completed for ${iconKey}`);

  // Queue icon key for background fetching
  await enqueueIconScrape(iconKey, undefined);
  console.log(`[SEARCH] Queued ${iconKey} for background fetching`);
}

// PHASE 2: Background fetch worker - processes queued downloads
// This runs separately and downloads images
export async function processIconQueue(): Promise<void> {
  console.log(`[QUEUE] processIconQueue starting`);
  if (isProcessingQueue) {
    console.log(`[QUEUE] Already processing, skipping`);
    return;
  }
  isProcessingQueue = true;
  try {
    const queued = await getQueuedIcons();
    console.log(`[QUEUE] Found ${queued.length} items in queue`);

    for (const item of queued) {
      console.log(`[QUEUE] Fetching icons for ${item.icon_key}`);
      setIconLoading(item.icon_key, true);

      try {
        // Get URLs from crawl results (found during search)
        const crawlResults = await getCrawlResults(item.icon_key);
        const unfetchedUrls = crawlResults
          .filter((r) => !r.imageData) // No image data means not yet downloaded
          .map((r) => r.originalUrl)
          .filter((u): u is string => Boolean(u));

        console.log(`[QUEUE] Found ${unfetchedUrls.length} URLs to fetch`);

        // Fetch all unfetched URLs
        for (const url of unfetchedUrls) {
          if (await isUrlAlreadyCrawled(url)) continue;
          const crawlResult = crawlResults.find((r) => r.originalUrl === url);
          if (crawlResult) {
            const success = await downloadImageAsBase64(
              url,
              crawlResult.source,
              item.icon_key,
            );
            if (success) {
              console.log(`[QUEUE] Fetched ${url}`);
            }
          }
        }

        // After fetching, set best icon as cached
        const cached = await getCachedIcon(item.icon_key);
        if (!cached?.imageData) {
          const all = await getCrawlResults(item.icon_key);
          if (all.length > 0) {
            const best = all.reduce((prev, curr) =>
              prev.fallbackTier < curr.fallbackTier ? prev : curr,
            );
            await setCachedIcon(
              item.icon_key,
              best.imageData,
              best.source,
              best.format,
              best.originalUrl,
            );
            console.log(`[QUEUE] Set best icon as cached: ${best.source}`);
          }
        }
      } catch (error) {
        console.error(`[QUEUE] Error:`, error);
      } finally {
        setIconLoading(item.icon_key, false);
        await dequeueIcon(item.icon_key);
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

// Search button handler - triggers search ONLY (spinner stops after search)
export async function queueIconForScraping(
  iconKey: string,
  subscriptionId?: string,
): Promise<void> {
  console.log(`[BUTTON] Search pressed for ${iconKey}`);

  // Run search to find URLs (spinner stops here)
  await findIconUrls(iconKey);

  // Start queue processing in background
  processIconQueue().catch(console.error);

  console.log(`[BUTTON] Search completed for ${iconKey}`);
}
