import { icons } from "@/constants/icons";
import {
  dequeueIcon,
  enqueueIconScrape,
  getCachedIcon,
  getCrawlResults,
  getQueuedIcons,
  isUrlAlreadyCrawled,
  isUrlAlreadyCrawledBatch,
  markUrlAsCrawled,
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
    const timer = setTimeout(() => controller.abort(), 15000);
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
    } else {
      console.log(`[FETCH] TIMEOUT ${url}`);
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
    if (cached?.imageData) {
      console.log(`[COLLECTION] Found cached icon for ${iconKey}`);
      iconMap.set(cached.imageData, {
        imageData: cached.imageData,
        source: cached.source,
        format: cached.format,
        originalUrl: cached.originalUrl,
      });
    }

    // Add database crawl results to collection (only those with actual image data)
    for (const r of results) {
      if (r.imageData && !iconMap.has(r.imageData)) {
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
        ? `data:image/${detectUrlFormat(cached.format)};base64,${cached.imageData}`
        : null,
      cachedFormat: cached?.format ?? null,
      icons: sorted,
    };
  } catch (err) {
    console.error("[COLLECTION] Failed:", err);
    return { cachedIconUri: null, cachedFormat: null, icons: [] };
  }
}

// Immediately download a single URL and save to DB
async function fetchAndSaveUrl(
  url: string,
  source: string,
  iconKey: string,
  format: string,
): Promise<boolean> {
  console.log(`[FETCH] Immediate fetch: ${source} ${url}`);
  const success = await downloadImageAsBase64(url, source, iconKey);
  if (success) {
    await markUrlAsCrawled(url);
    return true;
  }
  return false;
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

  // Track URLs we need to fetch immediately
  const urlsToFetch: { url: string; source: string; format: string }[] = [];

  // TIER 1: Library CDNs (Simple Icons, Tabler, Lucide, etc.) - FIND URLs
  console.log(`[SEARCH] TIER 1: Library CDNs`);
  const libraryIcons = await findAllIconSources(iconKey);
  console.log(`[SEARCH] TIER 1: Found ${libraryIcons.length} library icons`);
  const alreadyCrawledLibraries = await isUrlAlreadyCrawledBatch(
    libraryIcons.slice(0, MAX_LIBRARY_CANDIDATES).map((i) => i.url),
  );

  // Add library URLs to crawl_results AND queue for immediate fetch
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
      urlsToFetch.push({
        url: libIcon.url,
        source: libIcon.source,
        format: libIcon.format,
      });
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
    urlsToFetch.push({
      url: faviconResult.url,
      source: "favicon",
      format: faviconResult.format,
    });
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
      urlsToFetch.push({
        url: result.url,
        source: "web_search",
        format: detectUrlFormat(result.url),
      });
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
          urlsToFetch.push({
            url: icon.url,
            source: `spider:${icon.source}`,
            format: icon.format,
          });
        }
      }
    }
  }

  console.log(`[SEARCH] Search completed for ${iconKey}`);

  // START IMMEDIATE FETCH of discovered URLs in parallel
  // This replaces the old queue-based approach which had race conditions
  console.log(`[SEARCH] Immediately fetching ${urlsToFetch.length} URLs`);
  if (urlsToFetch.length > 0) {
    // Fetch first 5 immediately (user gets instant feedback)
    const immediate = urlsToFetch.slice(0, 5);
    const rest = urlsToFetch.slice(5);

    // Fetch first batch in parallel
    await Promise.all(
      immediate.map((u) => fetchAndSaveUrl(u.url, u.source, iconKey, u.format)),
    );

    // For remaining URLs, queue via the old method but also try fetching now
    if (rest.length > 0) {
      // Enqueue for background processing
      await enqueueIconScrape(iconKey, undefined);
      console.log(
        `[SEARCH] Queued ${iconKey} for background fetching (${rest.length} remaining URLs)`,
      );

      // Also start background processing immediately for the rest
      processIconQueue().catch(console.error);
    }
  }

  console.log(`[SEARCH] ===== FINISHED SEARCH for ${iconKey} =====`);
}

// PHASE 2: Background fetch worker - processes queued downloads
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

        console.log(
          `[QUEUE] Found ${unfetchedUrls.length} URLs to fetch for ${item.icon_key}`,
        );

        // Fetch all unfetched URLs, but mark them as crawled first to avoid duplication
        for (const url of unfetchedUrls) {
          const crawlResult = crawlResults.find((r) => r.originalUrl === url);
          if (crawlResult) {
            const alreadyCrawled = await isUrlAlreadyCrawled(url);
            if (alreadyCrawled) continue;

            const success = await downloadImageAsBase64(
              url,
              crawlResult.source,
              item.icon_key,
            );
            if (success) {
              await markUrlAsCrawled(url);
              console.log(`[QUEUE] Fetched ${url}`);
            }
          }
        }

        // After fetching, set best icon as cached
        const cached = await getCachedIcon(item.icon_key);
        if (!cached?.imageData) {
          const all = await getCrawlResults(item.icon_key);
          const withData = all.filter((r) => r.imageData);
          if (withData.length > 0) {
            const best = withData.reduce((prev, curr) =>
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

// Search button handler - triggers search THEN immediately starts fetching
export async function queueIconForScraping(
  iconKey: string,
  subscriptionId?: string,
): Promise<void> {
  console.log(`[BUTTON] Search pressed for ${iconKey}`);

  // Run search to find URLs (spinner stops here)
  await findIconUrls(iconKey);

  console.log(`[BUTTON] Search completed for ${iconKey}`);
}
