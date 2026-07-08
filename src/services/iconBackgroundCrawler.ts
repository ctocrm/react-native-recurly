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
import {
  getReportsForIcon,
  hashImageData,
} from "@/src/services/iconReportService";
import { findAllIconSources } from "@/src/services/iconScraper";
import { upscaleIconIfSmall } from "@/src/services/iconUpscaler";
import { isBase64IconValid } from "@/src/services/iconValidation";
import { isDomainRateLimited } from "@/src/services/rateLimitTracker";
import { searchForLinksToSpider } from "@/src/services/searchEngines";

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

    // Rudimentary upscale for low-res icons (e.g. favicons) before storing.
    const format = detectUrlFormat(url);
    const { base64: finalB64, format: finalFormat } = await upscaleIconIfSmall(
      b64,
      format,
    );

    await saveCrawlResult(iconKey, finalB64, source, finalFormat, url);
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
    id: string;
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
    // Build a set of reported (non-rejected) image hashes to hide by default.
    const reports = await getReportsForIcon(iconKey);
    const reportedHashes = new Set(
      reports.filter((r) => !r.rejected).map((r) => r.imageData),
    );

    const iconMap = new Map<
      string,
      {
        id: string;
        imageData: string;
        source: string;
        format: string;
        originalUrl: string | null;
      }
    >();

    // Add cached icon to collection FIRST (upscale small raster icons on view)
    if (
      cached?.imageData &&
      isBase64IconValid(cached.imageData, cached.format) &&
      !reportedHashes.has(cached.imageData)
    ) {
      console.log(`[COLLECTION] Found cached icon for ${iconKey}`);
      const displayData = await upscaleIconIfSmall(
        cached.imageData,
        cached.format,
      );
      iconMap.set(cached.imageData, {
        // id is derived from the ORIGINAL (pre-upscale) bytes so it stays
        // unique even when two source sizes upscale to identical pixels.
        id: hashImageData(cached.imageData),
        imageData: displayData.base64,
        source: cached.source,
        format: displayData.format,
        originalUrl: cached.originalUrl,
      });
    }

    // Add database crawl results to collection (only valid, non-reported images)
    for (const r of results) {
      if (
        r.imageData &&
        !iconMap.has(r.imageData) &&
        isBase64IconValid(r.imageData, r.format) &&
        !reportedHashes.has(r.imageData)
      ) {
        const displayData = await upscaleIconIfSmall(r.imageData, r.format);
        iconMap.set(r.imageData, {
          id: hashImageData(r.imageData),
          imageData: displayData.base64,
          source: r.source,
          format: displayData.format,
          originalUrl: r.originalUrl,
        });
      }
    }

    // ALWAYS add subscription's local icon asset to collection
    const localBase64 = await loadLocalIconAsBase64(iconKey);
    if (localBase64 && !iconMap.has(localBase64)) {
      iconMap.set(localBase64, {
        id: hashImageData(localBase64),
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

    // Derive the MIME subtype directly from the format string
    const mimeSubtype =
      cached?.format === "svg" ? "svg+xml" : (cached?.format ?? "png");
    console.log(`[COLLECTION] Returning ${sorted.length} icons`);
    return {
      cachedIconUri: cached?.imageData
        ? `data:image/${mimeSubtype};base64,${cached.imageData}`
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

  // TIER 0: Discover official website - smarter first step
  // Use a simple text search to find the brand's official site
  console.log(`[SEARCH] TIER 0: Discovering official website`);
  let officialSiteUrl: string | null = null;
  try {
    const ddgUrl = "https://duckduckgo.com";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(
      `${ddgUrl}/?q=${encodeURIComponent(iconKey)}&ia=web`,
      {
        signal: controller.signal,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
      },
    );
    clearTimeout(timer);

    if (response.ok) {
      const html = await response.text();
      // DDG web results use different structure - try multiple patterns
      const patterns = [
        /<a[^>]+class="result__a"[^>]*href\s*=\s*["'](https?:\/\/[^"']+)["']/i,
        /<a[^>]+href\s*=\s*["'](https?:\/\/[^"']+)"[^>]*class="result__a"/i,
        /<div[^>]*class="result__body"[^>]*>[\s\S]*?<a[^>]+href\s*=\s*["'](https?:\/\/[^"']+)["']/i,
        /<a[^>]+class="result__a"[^>]*href="([^"]+)"/i,
      ];
      for (const pattern of patterns) {
        const match = html.match(pattern);
        if (match) {
          officialSiteUrl = match[1];
          console.log(
            `[SEARCH] TIER 0: Found official site: ${officialSiteUrl}`,
          );
          break;
        }
      }
      // If no match, try generic link extraction
      if (!officialSiteUrl) {
        const linkMatch = html.match(
          /<a[^>]+href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/i,
        );
        if (linkMatch) {
          officialSiteUrl = linkMatch[1];
          console.log(
            `[SEARCH] TIER 0: Found official site (fallback): ${officialSiteUrl}`,
          );
        }
      }
    } else {
      // Record rate limit for non-200 responses
      if (response.status === 429 || response.status === 403) {
        const { recordRateLimit } = await import("./rateLimitTracker");
        await recordRateLimit(ddgUrl);
      }
    }
  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.log(`[SEARCH] TIER 0: Error finding official site: ${err}`);
    } else {
      console.log(`[SEARCH] TIER 0: Timeout finding official site`);
    }
  }

  // TIER 0.5: Scrape official website for icons and favicon
  if (officialSiteUrl) {
    console.log(`[SEARCH] TIER 0.5: Scraping official site for icons`);

    // Get favicon from official site - use origin URL
    const faviconUrl = new URL("/favicon.ico", officialSiteUrl).toString();
    if (!existingUrls.has(faviconUrl)) {
      await saveCrawlResult(iconKey, "", "official_favicon", "ico", faviconUrl);
      urlsToFetch.push({
        url: faviconUrl,
        source: "official_favicon",
        format: "ico",
      });
    }

    // Scrape official site for images
    try {
      if (!(await isDomainRateLimited(officialSiteUrl))) {
        const siteResponse = await fetch(officialSiteUrl, {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        if (siteResponse.ok) {
          const siteHtml = await siteResponse.text();
          // Find all image URLs on the site
          const imgMatches =
            siteHtml.match(
              /src=["']([^"']+\.(?:svg|png|jpg|jpeg|ico|webp))["']/gi,
            ) || [];
          for (const match of imgMatches.slice(0, 5)) {
            const urlMatch = match.match(/src=["']([^"']+)["']/i);
            if (urlMatch) {
              let imgUrl = urlMatch[1];
              // Use URL constructor for all relative URLs - works for both relative and root-relative
              if (!imgUrl.startsWith("http")) {
                imgUrl = new URL(imgUrl, officialSiteUrl).toString();
              }
              if (
                !existingUrls.has(imgUrl) &&
                !imgUrl.toLowerCase().includes("favicon")
              ) {
                await saveCrawlResult(
                  iconKey,
                  "",
                  "official_site",
                  detectUrlFormat(imgUrl),
                  imgUrl,
                );
                urlsToFetch.push({
                  url: imgUrl,
                  source: "official_site",
                  format: detectUrlFormat(imgUrl),
                });
              }
            }
          }
          console.log(
            `[SEARCH] TIER 0.5: Found ${imgMatches.length} potential images on official site`,
          );
        }
      }
    } catch (err) {
      console.log(`[SEARCH] TIER 0.5: Error scraping official site: ${err}`);
    }
  }

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
  console.log(`[SEARCH] TIER 3: Web search for links to spider`);
  const linkResults = await searchForLinksToSpider(iconKey);
  console.log(`[SEARCH] TIER 3: Found ${linkResults.length} links to spider`);
  const linkUrls: string[] = [];

  // searchForLinksToSpider returns website URLs - all should be spidered
  for (const linkUrl of linkResults.slice(0, MAX_WEB_SEARCH_RESULTS)) {
    if (existingUrls.has(linkUrl)) continue;
    if (
      !linkUrl.includes("google.com") &&
      !linkUrl.includes("bing.com") &&
      !linkUrl.includes("duckduckgo.com") &&
      !linkUrl.includes("yandex.com")
    ) {
      linkUrls.push(linkUrl);
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

  // Retry gate: on a RE-search, every discovered URL is usually already in
  // crawl_results (deduped above), so `urlsToFetch` is empty and the queue
  // never triggers — but some of those stored rows may have FAILED their
  // earlier download (empty imageData, e.g. a transient HTTP 400). Enqueue
  // the icon for background processing whenever there are still pending
  // (empty) crawl results so processIconQueue re-fetches them. Runs
  // unconditionally (outside the urlsToFetch block) so re-searches recover.
  // Dedupe to the latest row per original_url so earlier append-only empty
  // (failed) rows don't trigger retries once a later successful row exists.
  const crawlRows = await getCrawlResults(iconKey);
  const latestByUrl = new Map<string, (typeof crawlRows)[number]>();
  for (const r of crawlRows) {
    if (!r.originalUrl) continue;
    latestByUrl.set(r.originalUrl, r);
  }
  const pendingResults = Array.from(latestByUrl.values()).filter(
    (r) => !r.imageData,
  );
  if (pendingResults.length > 0) {
    await enqueueIconScrape(iconKey, undefined);
    console.log(
      `[SEARCH] Queued ${iconKey} to retry ${pendingResults.length} pending/failed downloads`,
    );
    processIconQueue().catch(console.error);
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
            // Upscale low-res picks (e.g. favicons) before caching.
            const bestUpscaled = await upscaleIconIfSmall(
              best.imageData,
              best.format,
            );
            await setCachedIcon(
              item.icon_key,
              bestUpscaled.base64,
              best.source,
              bestUpscaled.format,
              best.originalUrl,
            );
            console.log(`[QUEUE] Set best icon as cached: ${best.source}`);
          }
        }
      } catch (error) {
        console.error(`[QUEUE] Error:`, error);
      } finally {
        // NOTE: intentionally do NOT clear the icon-loading flag here. The
        // crawl-wide loading state is owned by startIconCrawl and cleared only
        // when the whole crawl finishes, so the UI stays in "loading" until the
        // crawl that started it is actually done.
        await dequeueIcon(item.icon_key);
      }
    }
  } finally {
    isProcessingQueue = false;
  }
}

// Promote the first already-fetched crawl result to icon_cache so the
// subscription card auto-assigns the icon without reopening any modal.
export async function promoteFirstIconToCache(iconKey: string): Promise<void> {
  try {
    const cached = await getCachedIcon(iconKey);
    if (cached?.imageData) return;

    const all = await getCrawlResults(iconKey);
    const withData = all.filter((r) => r.imageData);
    if (withData.length === 0) return;

    const best = withData.reduce((prev, curr) =>
      prev.fallbackTier < curr.fallbackTier ? prev : curr,
    );
    // Upscale low-res picks (e.g. favicons) before caching.
    const bestUpscaled = await upscaleIconIfSmall(best.imageData, best.format);
    await setCachedIcon(
      iconKey,
      bestUpscaled.base64,
      best.source,
      bestUpscaled.format,
      best.originalUrl,
    );
    console.log(`[CRAWL] Auto-assigned first icon for ${iconKey}`);
  } catch (err) {
    console.error(`[CRAWL] Failed to promote icon for ${iconKey}:`, err);
  }
}

// Detached, persistent background crawler.
// - Writes a durable record to the DB icon_crawl_queue (survives modal unmount).
// - Flags the icon as "loading" in the global registry for the FULL crawl.
// - Runs the actual discovery/fetch as a detached promise that is never awaited
//   by any UI, so closing any modal cannot cancel it.
export async function startIconCrawl(
  iconKey: string,
  subscriptionId?: string,
): Promise<void> {
  console.log(
    `[CRAWL] startIconCrawl for ${iconKey} (sub: ${subscriptionId ?? "none"})`,
  );
  // Durable DB record — this is what makes the search persistent/observable.
  // enqueueIconScrape also kicks off the fetch worker, so the crawl is
  // self-sustaining in the background without startIconCrawl awaiting the
  // queue directly.
  await enqueueIconScrape(iconKey, subscriptionId);

  // Flag the icon as "loading" for the FULL crawl duration. This is the
  // crawl-wide loading state — only startIconCrawl clears it, never the
  // per-item completion inside processIconQueue.
  setIconLoading(iconKey, true);

  // Fire-and-forget background worker. Not awaited by any caller/modal.
  void (async () => {
    try {
      // findIconUrls triggers background queue processing as it discovers URLs,
      // so we only enqueue work here and let it run; promoteFirstIconToCache
      // still runs to auto-assign the first fetched icon to the subscription.
      await findIconUrls(iconKey);
      await promoteFirstIconToCache(iconKey);
    } catch (err) {
      console.error(`[CRAWL] Error crawling ${iconKey}:`, err);
    } finally {
      // Only clear the crawl-wide loading flag from here, never from the
      // per-item completion in processIconQueue.
      setIconLoading(iconKey, false);
    }
  })();
}

// Backwards-compatible alias kept so existing call sites keep working.
export async function queueIconForScraping(
  iconKey: string,
  subscriptionId: string = "",
): Promise<void> {
  console.log(`[BUTTON] Search pressed for ${iconKey}`);
  startIconCrawl(iconKey, subscriptionId || undefined);
}
