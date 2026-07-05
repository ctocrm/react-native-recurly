import { icons } from "@/constants/icons";
import {
  dequeueIcon,
  enqueueIconScrape,
  getCachedIcon,
  getCrawlResults,
  getQueuedIcons,
  incrementQueueAttempt,
  isUrlAlreadyCrawled,
  isUrlAlreadyCrawledBatch,
  markUrlAsCrawled,
  saveCrawlResult,
  setCachedIcon,
} from "@/services/database";
import {
  downloadFaviconAsBase64,
  extractFavicon,
} from "@/src/services/faviconExtractor";
import { extractIconsFromUrls } from "@/src/services/htmlIconExtractor";
import {
  notifyCacheUpdate,
  setIconLoading,
} from "@/src/services/iconLoadingRegistry";
import { findAllIconSources } from "@/src/services/iconScraper";
import { searchAllSources } from "@/src/services/searchEngines";

// In-flight guard
let isProcessingQueue = false;
let pendingReprocess = false;

const MAX_RETRY_ATTEMPTS = 3;
const MAX_LIBRARY_CANDIDATES = 50;
const MAX_DIRECT_IMAGES = 30;
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
    console.log(`[CRAWL] No local icon found for key: ${iconKey}`);
    return null;
  }

  try {
    console.log(`[CRAWL] Loading local icon for ${iconKey}`);
    // For Expo bundled static assets, they're already in the bundle
    // We return a marker to indicate this is a subscription icon
    // The modal will handle displaying it directly
    return `local_asset:${iconKey}`;
  } catch (err) {
    console.log(`[CRAWL] Failed to load local icon ${iconKey}:`, err);
  }
  return null;
}

async function downloadImageAsBase64(url: string): Promise<string | null> {
  try {
    const alreadyTried = await isUrlAlreadyCrawled(url);
    if (alreadyTried) {
      console.log(`[CRAWL] SKIP: ${url} (already tried)`);
      return null;
    }

    console.log(`[CRAWL] DOWNLOAD: ${url}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "image/*,*/*;q=0.8",
        Referer: "https://www.google.com/",
      },
    });
    clearTimeout(timer);
    if (!response.ok) {
      console.log(`[CRAWL] DOWNLOAD FAILED ${url}: ${response.status}`);
      await markUrlAsCrawled(url);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const b64 = btoa(binary);
    await markUrlAsCrawled(url);
    console.log(`[CRAWL] DOWNLOAD SUCCESS: ${url} (${b64.length} bytes)`);
    return b64;
  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.log(`[CRAWL] DOWNLOAD ERROR ${url}: ${err.message || err}`);
    }
    await markUrlAsCrawled(url);
    return null;
  }
}

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
    console.log(`[PICKER] Loading icons for ${iconKey}`);
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
      console.log(`[PICKER] Found cached icon for ${iconKey}`);
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

    // ALWAYS add subscription's local icon asset to collection (not just when empty!)
    // This ensures the current icon is always visible in the picker
    console.log(`[PICKER] Loading local asset for ${iconKey}`);
    const localBase64 = await loadLocalIconAsBase64(iconKey);
    if (localBase64 && !iconMap.has(localBase64)) {
      iconMap.set(localBase64, {
        imageData: localBase64,
        source: "subscription",
        format: "png",
        originalUrl: null,
      });
      console.log(
        `[PICKER] Added subscription icon to collection for ${iconKey}`,
      );
    }

    // Sort: subscription first, then cached, then others
    const sorted = Array.from(iconMap.values()).sort((a, b) => {
      if (a.source === "subscription") return -1;
      if (b.source === "subscription") return 1;
      return 0;
    });

    console.log(`[PICKER] Returning ${sorted.length} icons for ${iconKey}`);
    return {
      cachedIconUri: cached?.imageData
        ? `data:${detectUrlFormat(cached.format)};base64,${cached.imageData}`
        : null,
      cachedFormat: cached?.format ?? null,
      icons: sorted,
    };
  } catch (err) {
    console.error("[PICKER] Failed:", err);
    return { cachedIconUri: null, cachedFormat: null, icons: [] };
  }
}

async function crawlIcon(icon_key: string): Promise<boolean> {
  console.log(`[CRAWL] Starting for ${icon_key}`);

  const existing = await getCrawlResults(icon_key);
  const existingUrls = new Set(
    existing.map((r) => r.originalUrl).filter((u): u is string => Boolean(u)),
  );
  const existingData = new Set(existing.map((r) => r.imageData));
  let newIconCount = 0;

  // TIER 1: Library CDNs
  const libraryIcons = await findAllIconSources(icon_key);
  const alreadyCrawledLibraries = await isUrlAlreadyCrawledBatch(
    libraryIcons.slice(0, MAX_LIBRARY_CANDIDATES).map((i) => i.url),
  );

  for (const libIcon of libraryIcons.slice(0, MAX_LIBRARY_CANDIDATES)) {
    if (existingUrls.has(libIcon.url)) continue;
    if (alreadyCrawledLibraries.has(libIcon.url)) continue;
    const b64 = await downloadFaviconAsBase64(libIcon.url, libIcon.format);
    if (b64 && !existingData.has(b64)) {
      existingData.add(b64);
      existingUrls.add(libIcon.url);
      newIconCount++;
      await saveCrawlResult(
        icon_key,
        b64,
        libIcon.source,
        libIcon.format,
        libIcon.url,
      );
      notifyCacheUpdate();
      console.log(`[CRAWL] Saved ${libIcon.source}`);
    }
  }

  // TIER 2: Favicon
  const faviconResult = await extractFavicon(icon_key);
  if (faviconResult && !existingUrls.has(faviconResult.url)) {
    if (!(await isUrlAlreadyCrawled(faviconResult.url))) {
      const b64 = await downloadFaviconAsBase64(
        faviconResult.url,
        faviconResult.format,
      );
      if (b64 && !existingData.has(b64)) {
        existingData.add(b64);
        existingUrls.add(faviconResult.url);
        newIconCount++;
        await saveCrawlResult(
          icon_key,
          b64,
          "favicon",
          faviconResult.format,
          faviconResult.url,
        );
        notifyCacheUpdate();
      }
    }
  }

  // TIER 3: Web search
  const searchResults = await searchAllSources(icon_key);
  const directImageUrls: string[] = [];
  const linkUrls: string[] = [];

  for (const result of searchResults.slice(0, MAX_WEB_SEARCH_RESULTS)) {
    if (existingUrls.has(result.url)) continue;
    const isImage =
      result.url.match(/\.(svg|png|jpg|jpeg|ico|webp|gif)(\?|$)/i) ||
      result.url.includes("logo") ||
      result.url.includes("icon");
    if (isImage) {
      directImageUrls.push(result.url);
    } else if (
      !result.url.includes("google.com") &&
      !result.url.includes("bing.com") &&
      !result.url.includes("duckduckgo.com") &&
      !result.url.includes("yandex.com")
    ) {
      linkUrls.push(result.url);
    }
  }

  const uncrawledDirect = (
    await Promise.all(
      directImageUrls
        .slice(0, MAX_DIRECT_IMAGES)
        .map(async (u) => ((await isUrlAlreadyCrawled(u)) ? null : u)),
    )
  ).filter((u): u is string => u !== null);

  for (const url of uncrawledDirect) {
    if (existingUrls.has(url)) continue;
    const b64 = await downloadImageAsBase64(url);
    if (b64 && !existingData.has(b64)) {
      existingData.add(b64);
      existingUrls.add(url);
      newIconCount++;
      await saveCrawlResult(
        icon_key,
        b64,
        "web_search",
        detectUrlFormat(url),
        url,
      );
      notifyCacheUpdate();
    }
  }

  // SPIDER
  if (linkUrls.length > 0) {
    const uncrawledLinks = (
      await Promise.all(
        linkUrls
          .slice(0, MAX_SPIDERED_URLS)
          .map(async (u) => ((await isUrlAlreadyCrawled(u)) ? null : u)),
      )
    ).filter((u): u is string => u !== null);

    if (uncrawledLinks.length > 0) {
      const spideredIcons = await extractIconsFromUrls(
        uncrawledLinks,
        icon_key,
      );
      for (const icon of spideredIcons.slice(0, MAX_SPIDERED_ICONS)) {
        if (existingUrls.has(icon.url)) continue;
        if (await isUrlAlreadyCrawled(icon.url)) continue;
        const b64 = await downloadImageAsBase64(icon.url);
        if (b64 && !existingData.has(b64)) {
          existingData.add(b64);
          existingUrls.add(icon.url);
          newIconCount++;
          await saveCrawlResult(
            icon_key,
            b64,
            `spider:${icon.source}`,
            icon.format,
            icon.url,
          );
          notifyCacheUpdate();
        }
      }
    }
  }

  if (newIconCount > 0) {
    const cached = await getCachedIcon(icon_key);
    if (!cached?.imageData) {
      const all = await getCrawlResults(icon_key);
      if (all.length > 0) {
        const best = all.reduce((prev, curr) =>
          prev.fallbackTier < curr.fallbackTier ? prev : curr,
        );
        await setCachedIcon(
          icon_key,
          best.imageData,
          best.source,
          best.format,
          best.originalUrl,
        );
      }
    }
    return true;
  }
  return false;
}

export async function processIconQueue(): Promise<void> {
  if (isProcessingQueue) {
    pendingReprocess = true;
    return;
  }
  isProcessingQueue = true;
  try {
    do {
      pendingReprocess = false;
      const initialQueueCount = (await getQueuedIcons()).length;
      const queued = await getQueuedIcons();

      for (const item of queued) {
        if (item.attempt_count >= MAX_RETRY_ATTEMPTS) {
          await dequeueIcon(item.icon_key);
          continue;
        }

        setIconLoading(item.icon_key, true);
        try {
          const found = await crawlIcon(item.icon_key);
          if (!found) {
            await incrementQueueAttempt(item.icon_key);
            const updatedItem = await getQueuedIcons().then((i) =>
              i.find((x) => x.icon_key === item.icon_key),
            );
            if (
              updatedItem &&
              (updatedItem?.attempt_count ?? 0) >= MAX_RETRY_ATTEMPTS
            ) {
              await dequeueIcon(item.icon_key);
            }
          }
        } catch (error) {
          console.error(`[CRAWL] Failed ${item.icon_key}:`, error);
          await incrementQueueAttempt(item.icon_key);
          const updatedItem = await getQueuedIcons().then((i) =>
            i.find((x) => x.icon_key === item.icon_key),
          );
          if (
            updatedItem &&
            (updatedItem?.attempt_count ?? 0) >= MAX_RETRY_ATTEMPTS
          ) {
            await dequeueIcon(item.icon_key);
          }
        } finally {
          setIconLoading(item.icon_key, false);
        }
      }

      const finalQueueCount = (await getQueuedIcons()).length;
      if (pendingReprocess || finalQueueCount > initialQueueCount) {
        pendingReprocess = true;
      }
    } while (pendingReprocess);
  } finally {
    isProcessingQueue = false;
    pendingReprocess = false;
  }
}

export function queueIconForScraping(
  icon_key: string,
  subscriptionId?: string,
): void {
  (async () => {
    await enqueueIconScrape(icon_key, subscriptionId);
    await processIconQueue();
  })().catch((err) => console.error(`[CRAWL] Failed:`, err));
}
