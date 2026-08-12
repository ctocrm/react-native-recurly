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
import { extractFavicon } from "@/services/faviconExtractor";
import { extractIconsFromUrls } from "@/services/htmlIconExtractor";
import {
  notifyCacheUpdate,
  setIconLoading,
} from "@/services/iconLoadingRegistry";
import {
  pickBestIcon,
  scoreIconQuality,
  sortUrlsByQuality,
} from "@/services/iconQuality";
import { getReportsForIcon, hashImageData } from "@/services/iconReportService";
import { findAllIconSources } from "@/services/iconScraper";
import { mimeForFormat, upscaleIconIfSmall } from "@/services/iconUpscaler";
import { isBase64IconValid } from "@/services/iconValidation";
import {
  isDomainRateLimited,
  recordRateLimit,
  recordSuccess,
} from "@/services/rateLimitTracker";
import {
  searchAllSources,
  searchForLinksToSpider,
} from "@/services/searchEngines";
import { Image } from "react-native";

// In-flight guard
let isProcessingQueue = false;
/** If processIconQueue was skipped because busy, run again when free. */
let queueRerunRequested = false;
/** In-flight crawls so double-tap Search does not stack workers for same key. */
const activeCrawls = new Set<string>();

const MAX_LIBRARY_CANDIDATES = 50;
const MAX_SPIDERED_URLS = 40;
const MAX_SPIDERED_ICONS = 40;
const MAX_WEB_SEARCH_RESULTS = 50;
/** How many discovered URLs to fetch immediately (rest go to queue). */
const IMMEDIATE_FETCH_BATCH = 12;
/** Max <img> candidates from official homepage scrape. */
const MAX_OFFICIAL_SITE_IMGS = 20;

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

// Download image and save to DB (rate-limit aware, short transient retries)
const FETCH_TIMEOUT_MS = 15_000;
const FETCH_MAX_ATTEMPTS = 3;

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const asInt = parseInt(header, 10);
  if (!Number.isNaN(asInt) && asInt >= 0) {
    // Retry-After: seconds
    return Math.min(asInt * 1000, 14_400_000);
  }
  const when = Date.parse(header);
  if (!Number.isNaN(when)) {
    return Math.min(Math.max(when - Date.now(), 0), 14_400_000);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function downloadImageAsBase64(
  url: string,
  source: string,
  iconKey: string,
): Promise<boolean> {
  if (await isDomainRateLimited(url)) {
    console.log(`[FETCH] SKIP rate-limited domain: ${url}`);
    return false;
  }

  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt++) {
    try {
      console.log(
        `[FETCH] DOWNLOAD${attempt > 1 ? ` retry ${attempt}/${FETCH_MAX_ATTEMPTS}` : ""}: ${source} ${url}`,
      );
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      let response: Response;
      try {
        response = await fetch(url, {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept: "image/*,*/*;q=0.8",
          },
        });
      } finally {
        clearTimeout(timer);
      }

      // Only true rate-limits (429) cool down the whole domain.
      // 403 is usually hotlink/bot block for one URL — do not blacklist CDNs.
      if (response.status === 429) {
        const retryMs = parseRetryAfterMs(response.headers.get("Retry-After"));
        await recordRateLimit(url, retryMs);
        console.log(`[FETCH] RATE_LIMITED ${url}: 429`);
        return false;
      }
      if (response.status === 403) {
        console.log(`[FETCH] FORBIDDEN ${url}: 403 (no domain cooldown)`);
        return false;
      }

      if (response.status >= 500 && attempt < FETCH_MAX_ATTEMPTS) {
        const backoff = 400 * attempt + Math.floor(Math.random() * 200);
        console.log(
          `[FETCH] ${response.status} on ${url}, backoff ${backoff}ms`,
        );
        await sleep(backoff);
        continue;
      }

      if (!response.ok) {
        console.log(`[FETCH] FAILED ${url}: ${response.status}`);
        return false;
      }

      const arrayBuffer = await response.arrayBuffer();
      // Empty body is not a usable icon
      if (!arrayBuffer || arrayBuffer.byteLength < 16) {
        console.log(`[FETCH] EMPTY body ${url}`);
        return false;
      }
      const uint8Array = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < uint8Array.byteLength; i++) {
        binary += String.fromCharCode(uint8Array[i]);
      }
      const b64 = btoa(binary);
      console.log(`[FETCH] SUCCESS: ${url} (${b64.length} bytes)`);

      const format = detectUrlFormat(url);
      const mime = mimeForFormat(format);
      const dataUri = `data:${mime};base64,${b64}`;
      const origSize = await new Promise<{ width: number; height: number }>(
        (resolve, reject) => {
          Image.getSize(
            dataUri,
            (width, height) => resolve({ width, height }),
            (err) => reject(err),
          );
        },
      ).catch(() => null);

      const { base64: finalB64, format: finalFormat } =
        await upscaleIconIfSmall(b64, format);

      await saveCrawlResult(
        iconKey,
        finalB64,
        source,
        finalFormat,
        url,
        0,
        origSize?.width,
        origSize?.height,
      );
      await recordSuccess(url);
      notifyCacheUpdate();
      return true;
    } catch (err: any) {
      lastErr = err;
      const isAbort = err?.name === "AbortError";
      if (isAbort) {
        console.log(`[FETCH] TIMEOUT ${url} (attempt ${attempt})`);
      } else {
        console.log(`[FETCH] ERROR ${url} (attempt ${attempt}):`, err);
      }
      // Transient network / timeout — retry with backoff
      if (attempt < FETCH_MAX_ATTEMPTS) {
        await sleep(500 * attempt);
        continue;
      }
    }
  }
  if (lastErr) {
    console.log(`[FETCH] GIVING UP ${url}`);
  }
  return false;
}

// Re-fetch crawl results that previously failed (empty imageData) without
// relying on the one-shot icon_crawl_queue, which a prior crawl may have
// already consumed. Directly downloads the pending URLs, then promotes the
// best fetched icon to the cache so re-searches actually recover.
// Process pending downloads in small bounded chunks (mirrors the first-5
// batching used for newly discovered URLs) so retries stay rate-limited and
// don't open unbounded parallel network/DB work.
const RETRY_BATCH_SIZE = 5;

async function retryPendingDownloads(
  iconKey: string,
  pending: { originalUrl: string | null; source: string }[],
): Promise<void> {
  const toFetch = pending.filter(
    (p): p is { originalUrl: string; source: string } => Boolean(p.originalUrl),
  );
  console.log(
    `[RETRY] Re-fetching ${toFetch.length} pending/failed downloads for ${iconKey}`,
  );
  for (let i = 0; i < toFetch.length; i += RETRY_BATCH_SIZE) {
    const batch = toFetch.slice(i, i + RETRY_BATCH_SIZE);
    await Promise.all(
      batch.map(async (p) => {
        const ok = await downloadImageAsBase64(
          p.originalUrl,
          p.source,
          iconKey,
        );
        if (ok) await markUrlAsCrawled(p.originalUrl);
      }),
    );
  }
  await promoteFirstIconToCache(iconKey);
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
    originalWidth?: number;
    originalHeight?: number;
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
        originalWidth?: number;
        originalHeight?: number;
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
        originalWidth: cached.originalWidth,
        originalHeight: cached.originalHeight,
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
          originalWidth: r.originalWidth,
          originalHeight: r.originalHeight,
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

    // Sort: AI / subscription first, then by source quality (SVG, large touch icons, …)
    const sorted = Array.from(iconMap.values()).sort((a, b) => {
      return (
        scoreIconQuality({
          source: b.source,
          format: b.format,
          originalUrl: b.originalUrl,
          originalWidth: b.originalWidth,
          originalHeight: b.originalHeight,
          imageDataLength: b.imageData?.length,
        }) -
        scoreIconQuality({
          source: a.source,
          format: a.format,
          originalUrl: a.originalUrl,
          originalWidth: a.originalWidth,
          originalHeight: a.originalHeight,
          imageDataLength: a.imageData?.length,
        })
      );
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
    } else if (response.status === 429) {
      // Only 429 cools down DDG; 403 is common bot challenge, not a domain ban
      await recordRateLimit(ddgUrl);
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

    // Prefer large / vector brand assets on the official origin before tiny .ico
    const officialPaths: { path: string; source: string; format: string }[] = [
      { path: "/favicon.svg", source: "official_favicon", format: "svg" },
      {
        path: "/apple-touch-icon.png",
        source: "official_apple_touch",
        format: "png",
      },
      {
        path: "/apple-touch-icon-precomposed.png",
        source: "official_apple_touch",
        format: "png",
      },
      {
        path: "/android-chrome-512x512.png",
        source: "official_pwa",
        format: "png",
      },
      {
        path: "/android-chrome-192x192.png",
        source: "official_pwa",
        format: "png",
      },
      { path: "/favicon.ico", source: "official_favicon", format: "ico" },
    ];
    for (const op of officialPaths) {
      const u = new URL(op.path, officialSiteUrl).toString();
      if (existingUrls.has(u)) continue;
      await saveCrawlResult(iconKey, "", op.source, op.format, u);
      urlsToFetch.push({ url: u, source: op.source, format: op.format });
      existingUrls.add(u);
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
              /<(?:img|source)[^>]+(?:src|srcset)=["']([^"']+\.(?:svg|png|jpg|jpeg|ico|webp)[^"']*)["'][^>]*>/gi,
            ) ||
            siteHtml.match(
              /src=["']([^"']+\.(?:svg|png|jpg|jpeg|ico|webp))["']/gi,
            ) ||
            [];
          // Prefer logo/icon-looking assets first
          const ranked = [...imgMatches].sort((a, b) => {
            const score = (s: string) => {
              const l = s.toLowerCase();
              let n = 0;
              if (l.includes("logo")) n += 5;
              if (l.includes("icon") || l.includes("brand")) n += 3;
              if (l.includes("apple-touch") || l.includes("512")) n += 2;
              if (l.includes("avatar") || l.includes("hero")) n -= 2;
              return n;
            };
            return score(b) - score(a);
          });
          let added = 0;
          for (const match of ranked) {
            if (added >= MAX_OFFICIAL_SITE_IMGS) break;
            const urlMatch =
              match.match(/(?:src|srcset)=["']([^"'\s,]+)/i) ||
              match.match(/src=["']([^"']+)["']/i);
            if (!urlMatch) continue;
            let imgUrl = urlMatch[1];
            if (!imgUrl.startsWith("http")) {
              try {
                imgUrl = new URL(imgUrl, officialSiteUrl).toString();
              } catch {
                continue;
              }
            }
            if (existingUrls.has(imgUrl)) continue;
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
            existingUrls.add(imgUrl);
            added++;
          }
          console.log(
            `[SEARCH] TIER 0.5: Found ${imgMatches.length} imgs, queued ${added} on official site`,
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

  // TIER 3: Multi-engine image/dork search (direct logo URLs) + page links to spider
  // Restored searchAllSources — removed in 1a7cf9c and left as dead code.
  console.log(`[SEARCH] TIER 3: Image/dork search + links to spider`);
  const isSearchEngineHost = (u: string) =>
    /google\.|bing\.|duckduckgo\.|yandex\./i.test(u);

  const looksLikeDirectImage = (url: string): boolean => {
    const lower = url.toLowerCase();
    if (/\.(svg|png|jpg|jpeg|ico|webp|gif)(\?|#|$)/i.test(lower)) return true;
    // CDN / brand asset paths without clean extensions
    if (
      /(?:^|[/?#_.=-])(logo|icon|favicon|brand|apple-touch|android-chrome)(?:$|[/?#_.=-])/i.test(
        lower,
      )
    ) {
      return true;
    }
    return false;
  };

  const [searchResults, linkResults] = await Promise.all([
    searchAllSources(iconKey).catch((e) => {
      console.log(
        `[SEARCH] TIER 3: searchAllSources failed:`,
        e instanceof Error ? e.message : e,
      );
      return [] as Awaited<ReturnType<typeof searchAllSources>>;
    }),
    searchForLinksToSpider(iconKey).catch((e) => {
      console.log(
        `[SEARCH] TIER 3: searchForLinksToSpider failed:`,
        e instanceof Error ? e.message : e,
      );
      return [] as string[];
    }),
  ]);

  console.log(
    `[SEARCH] TIER 3: ${searchResults.length} image/dork hits, ${linkResults.length} spider links`,
  );

  let directAdded = 0;
  for (const result of searchResults.slice(0, MAX_WEB_SEARCH_RESULTS)) {
    if (existingUrls.has(result.url)) continue;
    if (isSearchEngineHost(result.url)) continue;

    if (looksLikeDirectImage(result.url)) {
      const fmt = result.format || detectUrlFormat(result.url);
      const src = result.source || "web_search";
      await saveCrawlResult(iconKey, "", src, fmt, result.url);
      urlsToFetch.push({ url: result.url, source: src, format: fmt });
      existingUrls.add(result.url);
      directAdded++;
    }
  }
  console.log(`[SEARCH] TIER 3: Queued ${directAdded} direct image URLs`);

  const linkUrls: string[] = [];
  const queueDirectFromLink = async (linkUrl: string) => {
    if (existingUrls.has(linkUrl)) return;
    const fmt = detectUrlFormat(linkUrl);
    await saveCrawlResult(iconKey, "", "web_search", fmt, linkUrl);
    urlsToFetch.push({ url: linkUrl, source: "web_search", format: fmt });
    existingUrls.add(linkUrl);
    directAdded++;
  };

  // Non-image search hits → spider candidates; image-like → direct fetch
  for (const result of searchResults.slice(0, MAX_WEB_SEARCH_RESULTS)) {
    if (looksLikeDirectImage(result.url)) continue;
    if (existingUrls.has(result.url) || isSearchEngineHost(result.url))
      continue;
    if (!linkUrls.includes(result.url)) linkUrls.push(result.url);
  }
  for (const linkUrl of linkResults.slice(0, MAX_WEB_SEARCH_RESULTS)) {
    if (existingUrls.has(linkUrl) || isSearchEngineHost(linkUrl)) continue;
    if (looksLikeDirectImage(linkUrl)) {
      await queueDirectFromLink(linkUrl);
      continue;
    }
    if (!linkUrls.includes(linkUrl)) linkUrls.push(linkUrl);
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
          existingUrls.add(icon.url);
        }
      }
    }
  }

  console.log(`[SEARCH] Search completed for ${iconKey}`);

  // START IMMEDIATE FETCH of discovered URLs in parallel
  // This replaces the old queue-based approach which had race conditions
  // High-quality sources first so the first batch is not all tiny favicons
  const orderedFetch = sortUrlsByQuality(urlsToFetch);
  console.log(
    `[SEARCH] Immediately fetching ${orderedFetch.length} URLs (quality-ordered)`,
  );
  if (orderedFetch.length > 0) {
    // Fetch first batch immediately (user gets instant feedback)
    const immediate = orderedFetch.slice(0, IMMEDIATE_FETCH_BATCH);
    const rest = orderedFetch.slice(IMMEDIATE_FETCH_BATCH);

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
  // Exclude URLs that were just discovered in this same crawl and are already
  // being fetched via the urlsToFetch immediate/queued path — only retry rows
  // that genuinely failed earlier.
  const justFetched = new Set(urlsToFetch.map((u) => u.url));
  const retryRows = pendingResults.filter(
    (r) => !r.originalUrl || !justFetched.has(r.originalUrl),
  );
  if (retryRows.length > 0) {
    console.log(
      `[SEARCH] ${retryRows.length} pending/failed downloads to retry for ${iconKey}`,
    );
    // Re-fetch directly instead of via the one-shot queue (which a prior crawl
    // may have already consumed), so the retries actually execute. Await it so
    // the re-search completes only after cache promotion is done.
    await retryPendingDownloads(iconKey, retryRows);
  }

  console.log(`[SEARCH] ===== FINISHED SEARCH for ${iconKey} =====`);
}

// Background fetch worker — processes queued downloads
export async function processIconQueue(): Promise<void> {
  console.log(`[QUEUE] processIconQueue starting`);
  if (isProcessingQueue) {
    queueRerunRequested = true;
    console.log(`[QUEUE] Already processing, will re-run when free`);
    return;
  }
  isProcessingQueue = true;
  try {
    // Loop while new work arrived mid-run
     
    while (true) {
      queueRerunRequested = false;
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

          // Prefer high-quality candidates; skip domains still in cooldown
          const candidates = sortUrlsByQuality(
            unfetchedUrls
              .map((url) => {
                const crawlResult = crawlResults.find(
                  (r) => r.originalUrl === url,
                );
                if (!crawlResult) return null;
                return {
                  url,
                  source: crawlResult.source,
                  format: crawlResult.format,
                };
              })
              .filter(
                (x): x is { url: string; source: string; format: string } =>
                  Boolean(x),
              ),
          );

          for (const c of candidates) {
            if (await isUrlAlreadyCrawled(c.url)) continue;
            if (await isDomainRateLimited(c.url)) {
              console.log(`[QUEUE] Skip rate-limited ${c.url}`);
              continue;
            }
            const success = await downloadImageAsBase64(
              c.url,
              c.source,
              item.icon_key,
            );
            if (success) {
              await markUrlAsCrawled(c.url);
              console.log(`[QUEUE] Fetched ${c.url}`);
            }
          }

          // After fetching, set best icon as cached
          const cached = await getCachedIcon(item.icon_key);
          if (!cached?.imageData) {
            const all = await getCrawlResults(item.icon_key);
            const withData = all.filter((r) => r.imageData);
            if (withData.length > 0) {
              const best = pickBestIcon(
                withData.map((r) => ({
                  ...r,
                  imageDataLength: r.imageData?.length,
                })),
              )!;
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
                0,
                best.originalWidth,
                best.originalHeight,
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
      if (!queueRerunRequested) break;
      console.log(`[QUEUE] Re-running after mid-flight enqueue`);
    } // while
  } finally {
    isProcessingQueue = false;
    if (queueRerunRequested) {
      queueRerunRequested = false;
      void processIconQueue().catch(console.error);
    }
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

    const best = pickBestIcon(
      withData.map((r) => ({
        ...r,
        imageDataLength: r.imageData?.length,
      })),
    )!;
    // Upscale low-res picks (e.g. favicons) before caching.
    const bestUpscaled = await upscaleIconIfSmall(best.imageData, best.format);
    await setCachedIcon(
      iconKey,
      bestUpscaled.base64,
      best.source,
      bestUpscaled.format,
      best.originalUrl,
      0,
      best.originalWidth,
      best.originalHeight,
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
  if (activeCrawls.has(iconKey)) {
    console.log(`[CRAWL] Already crawling ${iconKey}, skip duplicate start`);
    // Still ensure queue will process any pending rows
    await enqueueIconScrape(iconKey, subscriptionId);
    return;
  }
  activeCrawls.add(iconKey);

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
      activeCrawls.delete(iconKey);
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
