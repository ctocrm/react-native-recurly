import { icons } from "@/constants/icons";
import {
  CrawlGenerationRegistry,
  canAutoAssignCache,
  terminalStatusFor,
} from "@/services/crawlLifecycle";
import {
  beginIconCrawlSession,
  dequeueIcon,
  enqueueIconScrape,
  getCachedIcon,
  getCrawlResults,
  getIconCrawlSession,
  getQueuedIcons,
  markUrlAsCrawled,
  saveCrawlResult,
  setCachedIcon,
  updateIconCrawlSession,
} from "@/services/database";
import { rankOfficialDomainCandidates } from "@/services/domain/domainDiscovery";
import {
  officialSiteUrlForHost,
  sanitizeOfficialHost,
} from "@/services/domain/officialDomain";
import {
  classifyCandidate,
  isTrustedProvenance,
  officialHostsForBrand,
} from "@/services/domain/provenance";
import { extractFavicon } from "@/services/faviconExtractor";
import { extractIconsFromUrls } from "@/services/htmlIconExtractor";
import {
  notifyCacheUpdate,
  setIconCrawlProgress,
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
  extractDuckDuckGoUddgLinks,
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

/**
 * Explicit mobile-safe deep-discovery policy. These caps are deliberately
 * high enough to retain source diversity, while bounding hostile/misleading
 * web results so discovery cannot consume all network, battery, or JS time.
 */
export const ICON_CRAWL_POLICY = Object.freeze({
  libraryCandidates: 120,
  officialSiteImages: 50,
  webSearchResults: 150,
  spideredPages: 80,
  spideredIcons: 160,
});
const MAX_LIBRARY_CANDIDATES = ICON_CRAWL_POLICY.libraryCandidates;
const MAX_SPIDERED_URLS = ICON_CRAWL_POLICY.spideredPages;
const MAX_SPIDERED_ICONS = ICON_CRAWL_POLICY.spideredIcons;
const MAX_WEB_SEARCH_RESULTS = ICON_CRAWL_POLICY.webSearchResults;
/** How many high-quality candidates to fetch before returning work to the queue. */
const IMMEDIATE_FETCH_BATCH = 2;
/**
 * Each download includes base64 conversion, image validation, and database
 * writes. Keep this deliberately small so a crawl cannot monopolize the JS
 * runtime while the user is navigating or typing.
 */
const DOWNLOAD_CONCURRENCY = 2;
/** Reject arbitrary web images before their bytes are copied into a JS string. */
const MAX_ICON_DOWNLOAD_BYTES = 1_500_000;
const BASE64_CONVERSION_CHUNK_BYTES = 8_192;
const BASE64_CONVERSION_YIELD_BYTES = 65_536;
/** Max <img> candidates from official homepage scrape. */
const MAX_OFFICIAL_SITE_IMGS = ICON_CRAWL_POLICY.officialSiteImages;

type CrawlCandidate = { url: string; source: string; format: string };

interface CrawlCounts {
  discovered: number;
  downloaded: number;
  rejected: number;
  deferred: number;
  spideredPages: number;
}

async function reportCrawlProgress(
  iconKey: string,
  status:
    | "discovering"
    | "fetching"
    | "deep_search"
    | "waiting_for_rate_limit"
    | "complete"
    | "partial"
    | "failed",
  detail: string,
  counts: CrawlCounts,
  completed = false,
): Promise<void> {
  await updateIconCrawlSession(iconKey, {
    status,
    detail,
    discoveredCount: counts.discovered,
    downloadedCount: counts.downloaded,
    rejectedCount: counts.rejected,
    deferredCount: counts.deferred,
    spideredPages: counts.spideredPages,
    completed,
  });
  setIconCrawlProgress(iconKey, {
    status,
    detail,
    discoveredCount: counts.discovered,
    downloadedCount: counts.downloaded,
    rejectedCount: counts.rejected,
    deferredCount: counts.deferred,
    spideredPages: counts.spideredPages,
  });
}

/**
 * Reject HTML/JSON/error documents served from image-looking URLs before they
 * enter the picker. URL extensions are useful discovery hints, not validation.
 */
function detectDownloadedIconFormat(
  bytes: Uint8Array,
  contentType: string | null,
  fallbackFormat: string,
): string | null {
  const normalizedType = contentType?.split(";")[0].trim().toLowerCase() ?? "";
  if (
    normalizedType.includes("text/html") ||
    normalizedType.includes("application/json")
  ) {
    return null;
  }
  const hasPngSignature =
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47;
  const hasJpegSignature =
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff;
  const hasGifSignature =
    bytes.length >= 6 &&
    String.fromCharCode(...bytes.subarray(0, 6)).startsWith("GIF");
  const hasIcoSignature =
    bytes.length >= 4 &&
    bytes[0] === 0 &&
    bytes[1] === 0 &&
    bytes[2] === 1 &&
    bytes[3] === 0;
  const hasWebpSignature =
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP";
  const textHead = String.fromCharCode(
    ...bytes.subarray(0, Math.min(bytes.length, 512)),
  );
  const hasSvg = /<svg[\s>]/i.test(textHead);

  if (hasSvg || normalizedType === "image/svg+xml")
    return hasSvg ? "svg" : null;
  if (hasPngSignature) return "png";
  if (hasJpegSignature) return "jpeg";
  if (hasGifSignature) return "gif";
  if (hasIcoSignature) return "ico";
  if (hasWebpSignature) return "webp";

  // Some icon CDNs use application/octet-stream for legitimate image files.
  // Only accept a known image MIME when the URL supplied a supported format.
  if (normalizedType.startsWith("image/")) {
    return ["svg", "png", "ico", "jpg", "jpeg", "webp", "gif"].includes(
      fallbackFormat,
    )
      ? fallbackFormat
      : null;
  }
  return null;
}

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

/** Give React Native a turn to render/respond between background work batches. */
function yieldToUi(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Wait without blocking JS until the shared bounded download worker is idle. */
async function waitForQueueIdle(): Promise<void> {
  while (isProcessingQueue) {
    await sleep(100);
  }
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
      // A search result is untrusted. Converting a multi-megabyte response to a
      // JS binary string is both unnecessary for an app icon and a common UI
      // stall on mobile devices.
      if (arrayBuffer.byteLength > MAX_ICON_DOWNLOAD_BYTES) {
        console.log(
          `[FETCH] SKIP oversized icon ${url} (${arrayBuffer.byteLength} bytes)`,
        );
        return false;
      }
      const uint8Array = new Uint8Array(arrayBuffer);
      const format = detectDownloadedIconFormat(
        uint8Array,
        response.headers.get("Content-Type"),
        detectUrlFormat(url),
      );
      if (!format) {
        console.log(
          `[FETCH] REJECT non-image response ${url} (content-type=${response.headers.get("Content-Type") ?? "unknown"})`,
        );
        return false;
      }
      let binary = "";
      for (
        let i = 0;
        i < uint8Array.byteLength;
        i += BASE64_CONVERSION_CHUNK_BYTES
      ) {
        const end = Math.min(
          i + BASE64_CONVERSION_CHUNK_BYTES,
          uint8Array.byteLength,
        );
        binary += String.fromCharCode(...uint8Array.subarray(i, end));
        if (
          end < uint8Array.byteLength &&
          end % BASE64_CONVERSION_YIELD_BYTES === 0
        ) {
          await yieldToUi();
        }
      }
      const b64 = btoa(binary);
      console.log(`[FETCH] SUCCESS: ${url} (${b64.length} bytes)`);

      // Reject empty / blank / fully-transparent images before they enter the DB.
      if (!isBase64IconValid(b64, format)) {
        console.log(
          `[FETCH] REJECT empty/transparent icon ${url} (format=${format}, bytes=${b64.length})`,
        );
        return false;
      }

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

      // Degenerate dimensions (when readable) are not usable card icons.
      if (
        origSize &&
        (origSize.width < 8 ||
          origSize.height < 8 ||
          origSize.width > 100000 ||
          origSize.height > 100000)
      ) {
        console.log(
          `[FETCH] REJECT bad dimensions ${url}: ${origSize.width}x${origSize.height}`,
        );
        return false;
      }

      const { base64: finalB64, format: finalFormat } =
        await upscaleIconIfSmall(b64, format);

      // Re-validate after upscale (should still pass; guards against bad transforms).
      if (!isBase64IconValid(finalB64, finalFormat)) {
        console.log(`[FETCH] REJECT post-upscale invalid icon ${url}`);
        return false;
      }

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
// Process pending downloads in small bounded chunks so retries stay
// rate-limited and do not monopolize the JS runtime.
const RETRY_BATCH_SIZE = DOWNLOAD_CONCURRENCY;

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
    await yieldToUi();
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
    // Heal empty/transparent auto-assigned cache before building the picker list.
    await promoteFirstIconToCache(iconKey);
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

    // Only expose cached URI when the cached icon itself is valid (not empty/transparent).
    const cachedValid =
      !!cached?.imageData && isBase64IconValid(cached.imageData, cached.format);
    const mimeSubtype =
      cached?.format === "svg" ? "svg+xml" : (cached?.format ?? "png");
    console.log(
      `[COLLECTION] Returning ${sorted.length} icons (cachedValid=${cachedValid})`,
    );
    return {
      cachedIconUri: cachedValid
        ? `data:image/${mimeSubtype};base64,${cached!.imageData}`
        : null,
      cachedFormat: cachedValid ? (cached?.format ?? null) : null,
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

/**
 * Start the high-confidence candidates immediately. Deep search continues to
 * expand the same persistent per-icon collection; it never gates first icons.
 */
async function fetchInitialCandidates(
  iconKey: string,
  candidates: CrawlCandidate[],
  counts: CrawlCounts,
): Promise<Set<string>> {
  const immediate = sortUrlsByQuality(candidates).slice(
    0,
    IMMEDIATE_FETCH_BATCH,
  );
  const attempted = new Set(immediate.map((candidate) => candidate.url));
  if (immediate.length === 0) return attempted;

  await reportCrawlProgress(
    iconKey,
    "fetching",
    `Fetching ${immediate.length} high-confidence icon candidates`,
    counts,
  );
  for (let i = 0; i < immediate.length; i += DOWNLOAD_CONCURRENCY) {
    const batch = immediate.slice(i, i + DOWNLOAD_CONCURRENCY);
    const outcomes = await Promise.all(
      batch.map((candidate) =>
        fetchAndSaveUrl(
          candidate.url,
          candidate.source,
          iconKey,
          candidate.format,
        ),
      ),
    );
    counts.downloaded += outcomes.filter(Boolean).length;
    counts.rejected += outcomes.filter((result) => !result).length;
    await reportCrawlProgress(
      iconKey,
      "fetching",
      `Found ${counts.discovered} candidates; ${counts.downloaded} valid icons saved`,
      counts,
    );
    await yieldToUi();
  }

  // Let the durable worker continue with the rest while web/spider discovery
  // is still running. It has its own bounded, yielding download loop.
  await enqueueIconScrape(iconKey, undefined);
  void processIconQueue().catch(console.error);
  return attempted;
}

/** Per-key crawl generations for stale-cancellation (Tranche E). */
const crawlGens = new CrawlGenerationRegistry();

// PHASE 1: Find URLs to download (LOCAL + LIBRARIES + CDN + FAVICON + SEARCH + SPIDER)
// This is called when user types or taps search - spinner stops after this returns.
// Returns the number of provider failures so the caller can report a truthful
// terminal status (a provider outage must not read as a clean "complete").
export async function findIconUrls(iconKey: string): Promise<number> {
  console.log(`[SEARCH] ===== STARTING SEARCH for ${iconKey} =====`);
  let providerFailures = 0;
  const counts: CrawlCounts = {
    discovered: 0,
    downloaded: 0,
    rejected: 0,
    deferred: 0,
    spideredPages: 0,
  };

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
  const urlsToFetch: CrawlCandidate[] = [];

  // TIER 0: Discover official website. Scan seeds skip search.
  console.log(`[SEARCH] TIER 0: Discovering official website`);
  let officialSiteUrl: string | null = null;
  let officialHosts = officialHostsForBrand(iconKey);
  const sessionHint = await getIconCrawlSession(iconKey);
  const seededHost = sessionHint?.officialDomain
    ? sanitizeOfficialHost(sessionHint.officialDomain)
    : null;
  if (seededHost) {
    officialSiteUrl = officialSiteUrlForHost(seededHost);
    officialHosts = officialHostsForBrand(iconKey, seededHost);
    console.log(`[SEARCH] TIER 0: Using seeded official site: ${officialSiteUrl}`);
  } else {
    try {
      const ddgHtmlUrl = "https://html.duckduckgo.com";
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const response = await fetch(
        `${ddgHtmlUrl}/html/?q=${encodeURIComponent(iconKey)}`,
        {
          signal: controller.signal,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          },
        },
      );
      clearTimeout(timer);

      if (response.ok) {
        const html = await response.text();
        const candidateUrls = extractDuckDuckGoUddgLinks(html);
        if (candidateUrls.length === 0) {
          const linkRe = /<a[^>]+href\s*=\s*["'](https?:\/\/[^"']+)["'][^>]*>/gi;
          let m: RegExpExecArray | null;
          while ((m = linkRe.exec(html)) !== null) {
            if (
              !m[1].includes("duckduckgo.com") &&
              !m[1].includes("google.com")
            ) {
              candidateUrls.push(m[1]);
            }
          }
        }

        const ranking = rankOfficialDomainCandidates(iconKey, candidateUrls);
        if (ranking.best) {
          officialSiteUrl = ranking.best.url;
          officialHosts = officialHostsForBrand(iconKey, ranking.best.host);
          await updateIconCrawlSession(iconKey, {
            officialDomain: ranking.best.host,
          });
          console.log(
            `[SEARCH] TIER 0: Ranked official site: ${officialSiteUrl} (${ranking.best.confidence}, ${ranking.best.reason})`,
          );
        } else {
          console.log(
            `[SEARCH] TIER 0: no confident official domain among ${candidateUrls.length} links`,
          );
        }
        if (ranking.rejected.length > 0) {
          console.log(
            `[SEARCH] TIER 0: rejected ${ranking.rejected.length} non-brand hosts: ${ranking.rejected
              .slice(0, 5)
              .map((r) => `${r.host}(${r.reason})`)
              .join(", ")}`,
          );
        }
      } else if (response.status === 429) {
        await recordRateLimit(ddgHtmlUrl);
      } else {
        providerFailures++;
      }
    } catch (err: any) {
      providerFailures++;
      if (err.name !== "AbortError") {
        console.log(`[SEARCH] TIER 0: Error finding official site: ${err}`);
      } else {
        console.log(`[SEARCH] TIER 0: Timeout finding official site`);
      }
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
      counts.discovered++;
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
          // Tranche C: only keep <img> with a real logo/brand signal. Removes
          // unconstrained generic page-image pollution (menu chrome, avatars).
          const imgScore = (s: string) => {
            const l = s.toLowerCase();
            let n = 0;
            if (l.includes("logo")) n += 5;
            if (l.includes("icon") || l.includes("brand")) n += 3;
            if (l.includes("apple-touch") || l.includes("512")) n += 2;
            if (l.includes("avatar") || l.includes("hero")) n -= 2;
            return n;
          };
          const ranked = [...imgMatches]
            .filter((mm) => imgScore(mm) > 0)
            .sort((a, b) => imgScore(b) - imgScore(a));
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
            counts.discovered++;
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
  // Candidates belong to an icon key. Universal URL history is telemetry, not
  // ownership: a valid library URL fetched for one subscription must still be
  // saved and selectable for another subscription with the same candidate.
  // Add library URLs to crawl_results AND queue for immediate fetch.
  for (const libIcon of libraryIcons.slice(0, MAX_LIBRARY_CANDIDATES)) {
    if (!existingUrls.has(libIcon.url)) {
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
      existingUrls.add(libIcon.url);
      counts.discovered++;
    }
  }

  // TIER 2: Favicon extraction - FIND URL
  console.log(`[SEARCH] TIER 2: Favicon`);
  const faviconResult = await extractFavicon(
    iconKey,
    officialSiteUrl ? new URL(officialSiteUrl).hostname : null,
  );
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
    existingUrls.add(faviconResult.url);
    counts.discovered++;
    console.log(`[SEARCH] TIER 2: Found favicon URL`);
  } else {
    console.log(`[SEARCH] TIER 2: No favicon found`);
  }

  // Fetch curated/official candidates before unreliable web discovery. This
  // keeps maximum-search behavior without making first results wait on DDG,
  // Bing, Google, or a multi-page spider crawl.
  const immediatelyAttempted = await fetchInitialCandidates(
    iconKey,
    urlsToFetch,
    counts,
  );

  // TIER 3: Multi-engine image/dork search (direct logo URLs) + page links to spider
  // Restored searchAllSources — removed in 1a7cf9c and left as dead code.
  console.log(`[SEARCH] TIER 3: Image/dork search + links to spider`);
  await reportCrawlProgress(
    iconKey,
    "deep_search",
    `Continuing deep search after ${counts.downloaded} valid icons`,
    counts,
  );
  const isSearchEngineHost = (u: string) =>
    /google\.|bing\.|duckduckgo\.|yandex\./i.test(u);

  // Match peak-era (5b7c1a0) image gate: extension OR logo/icon token in URL.
  const looksLikeDirectImage = (url: string): boolean => {
    const lower = url.toLowerCase();
    if (/\.(svg|png|jpg|jpeg|ico|webp|gif)(\?|#|$)/i.test(lower)) return true;
    if (lower.includes("logo") || lower.includes("icon")) return true;
    if (
      /(?:^|[/?#_.=-])(favicon|brand|apple-touch|android-chrome)(?:$|[/?#_.=-])/i.test(
        lower,
      )
    ) {
      return true;
    }
    return false;
  };

  const [searchResults, linkResults] = await Promise.all([
    searchAllSources(iconKey).catch((e) => {
      providerFailures++;
      console.log(
        `[SEARCH] TIER 3: searchAllSources failed:`,
        e instanceof Error ? e.message : e,
      );
      return [] as Awaited<ReturnType<typeof searchAllSources>>;
    }),
    searchForLinksToSpider(iconKey).catch((e) => {
      providerFailures++;
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
  let untrustedRejected = 0;
  for (const result of searchResults.slice(0, MAX_WEB_SEARCH_RESULTS)) {
    if (existingUrls.has(result.url)) continue;
    if (isSearchEngineHost(result.url)) continue;

    // Tranche D: gate publication on provenance. Arbitrary-domain images with no
    // brand evidence (random pictures) are rejected even if they look like images.
    if (
      !isTrustedProvenance(
        classifyCandidate(iconKey, officialHosts, result.url).prov,
      )
    ) {
      untrustedRejected++;
      continue;
    }

    if (looksLikeDirectImage(result.url)) {
      const fmt = result.format || detectUrlFormat(result.url);
      const src = result.source || "web_search";
      await saveCrawlResult(iconKey, "", src, fmt, result.url);
      urlsToFetch.push({ url: result.url, source: src, format: fmt });
      existingUrls.add(result.url);
      directAdded++;
      counts.discovered++;
    }
  }
  console.log(
    `[SEARCH] TIER 3: Queued ${directAdded} direct image URLs; rejected ${untrustedRejected} untrusted-provenance URLs`,
  );

  const linkUrls: string[] = [];
  const queueDirectFromLink = async (linkUrl: string) => {
    if (existingUrls.has(linkUrl)) return;
    const fmt = detectUrlFormat(linkUrl);
    await saveCrawlResult(iconKey, "", "web_search", fmt, linkUrl);
    urlsToFetch.push({ url: linkUrl, source: "web_search", format: fmt });
    existingUrls.add(linkUrl);
    directAdded++;
    counts.discovered++;
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
  // Tranche D: only spider first-party (official-host) pages. Arbitrary pages
  // contribute their OWN favicon/og:image/logo and pollute the picker.
  const officialLinks = linkUrls.filter((u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, "").toLowerCase();
      return officialHosts.has(h);
    } catch {
      return false;
    }
  });
  console.log(
    `[SEARCH] SPIDER: Processing ${officialLinks.length} official-host links (of ${linkUrls.length})`,
  );
  if (officialLinks.length > 0) {
    const uncrawledLinks = officialLinks.slice(0, MAX_SPIDERED_URLS);

    if (uncrawledLinks.length > 0) {
      console.log(`[SEARCH] SPIDER: Fetching ${uncrawledLinks.length} pages`);
      counts.spideredPages += uncrawledLinks.length;
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
          counts.discovered++;
        }
      }
    }
  }

  console.log(`[SEARCH] Search completed for ${iconKey}`);
  await reportCrawlProgress(
    iconKey,
    "fetching",
    `Discovered ${counts.discovered} candidates across all sources`,
    counts,
  );

  // START IMMEDIATE FETCH of discovered URLs in parallel
  // This replaces the old queue-based approach which had race conditions
  // High-quality sources first so the first batch is not all tiny favicons
  const orderedFetch = sortUrlsByQuality(
    urlsToFetch.filter((candidate) => !immediatelyAttempted.has(candidate.url)),
  );
  console.log(
    `[SEARCH] Immediately fetching ${orderedFetch.length} URLs (quality-ordered)`,
  );
  if (orderedFetch.length > 0) {
    // Fetch a bounded next batch; the early batch already gave the picker a
    // head start before deep search completed.
    const immediate = orderedFetch.slice(0, IMMEDIATE_FETCH_BATCH);
    const rest = orderedFetch.slice(IMMEDIATE_FETCH_BATCH);

    // Fetch only a couple of high-quality candidates right away. Each fetch
    // performs CPU-heavy base64/image validation work, so unlimited parallelism
    // makes the app look frozen despite the network calls themselves being async.
    for (let i = 0; i < immediate.length; i += DOWNLOAD_CONCURRENCY) {
      const batch = immediate.slice(i, i + DOWNLOAD_CONCURRENCY);
      const outcomes = await Promise.all(
        batch.map((u) => fetchAndSaveUrl(u.url, u.source, iconKey, u.format)),
      );
      counts.downloaded += outcomes.filter(Boolean).length;
      counts.rejected += outcomes.filter((result) => !result).length;
      await yieldToUi();
    }

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
  await reportCrawlProgress(
    iconKey,
    "fetching",
    `Deep discovery complete: ${counts.discovered} candidates, ${counts.downloaded} saved so far`,
    counts,
  );
  return providerFailures;
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
            // Downloads include image decoding/validation. Explicitly yield so
            // this detached worker remains cooperative with UI interactions.
            await yieldToUi();
          }

          // After fetching, set best *valid* icon as cached (skip empty/transparent)
          const cached = await getCachedIcon(item.icon_key);
          const cachedValid =
            !!cached?.imageData &&
            isBase64IconValid(cached.imageData, cached.format);
          if (canAutoAssignCache(!!cached?.imageData, cachedValid)) {
            const all = await getCrawlResults(item.icon_key);
            const withData = all.filter(
              (r) => r.imageData && isBase64IconValid(r.imageData, r.format),
            );
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
              if (
                !isBase64IconValid(bestUpscaled.base64, bestUpscaled.format)
              ) {
                console.log(
                  `[QUEUE] Skip caching invalid best icon for ${item.icon_key}`,
                );
              } else {
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

// Promote the best already-fetched *valid* crawl result to icon_cache so the
// subscription card auto-assigns a non-empty icon without reopening any modal.
export async function promoteFirstIconToCache(iconKey: string): Promise<void> {
  try {
    const cached = await getCachedIcon(iconKey);
    const cachedValid =
      !!cached?.imageData && isBase64IconValid(cached.imageData, cached.format);
    // Tranche E explicit ownership: never overwrite a valid (chosen) cache.
    if (!canAutoAssignCache(!!cached?.imageData, cachedValid)) {
      return;
    }

    const all = await getCrawlResults(iconKey);
    // Never auto-assign empty / fully-transparent images to the card.
    const withData = all.filter(
      (r) => r.imageData && isBase64IconValid(r.imageData, r.format),
    );
    if (withData.length === 0) {
      console.log(
        `[CRAWL] No valid icons to auto-assign for ${iconKey} (${all.filter((r) => r.imageData).length} with data, all invalid/empty)`,
      );
      return;
    }

    const best = pickBestIcon(
      withData.map((r) => ({
        ...r,
        imageDataLength: r.imageData?.length,
      })),
    )!;
    // Upscale low-res picks (e.g. favicons) before caching.
    const bestUpscaled = await upscaleIconIfSmall(best.imageData, best.format);
    if (!isBase64IconValid(bestUpscaled.base64, bestUpscaled.format)) {
      console.log(
        `[CRAWL] Best icon for ${iconKey} became invalid after upscale — skip auto-assign`,
      );
      return;
    }
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
    console.log(
      `[CRAWL] Auto-assigned first valid icon for ${iconKey} (source=${best.source})`,
    );
    notifyCacheUpdate();
  } catch (err) {
    console.error(`[CRAWL] Failed to promote icon for ${iconKey}:`, err);
  }
}

// Detached, persistent background crawler.
// - Writes a durable record to the DB icon_crawl_queue (survives modal unmount).
// - Flags the icon as "loading" in the global registry for the FULL crawl.
// - Runs the actual discovery/fetch as a detached promise that is never awaited
//   by any UI, so closing any modal cannot cancel it.
export type IconCrawlOptions = {
  officialDomain?: string | null;
};

export async function startIconCrawl(
  iconKey: string,
  subscriptionId?: string,
  options?: IconCrawlOptions,
): Promise<void> {
  const seeded = options?.officialDomain
    ? sanitizeOfficialHost(options.officialDomain)
    : null;
  console.log(
    `[CRAWL] startIconCrawl for ${iconKey} (sub: ${subscriptionId ?? "none"}; official=${seeded ?? "search"})`,
  );
  if (activeCrawls.has(iconKey)) {
    console.log(`[CRAWL] Already crawling ${iconKey}, skip duplicate start`);
    await enqueueIconScrape(iconKey, subscriptionId);
    if (seeded) {
      await updateIconCrawlSession(iconKey, { officialDomain: seeded });
    }
    return;
  }
  activeCrawls.add(iconKey);
  const gen = crawlGens.begin(iconKey);

  await enqueueIconScrape(iconKey, subscriptionId);
  await beginIconCrawlSession(iconKey, seeded);
  setIconCrawlProgress(iconKey, {
    status: "discovering",
    detail: "Discovering icon sources",
  });

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
      const providerFailures = await findIconUrls(iconKey);
      // `findIconUrls` deliberately starts the shared worker without awaiting
      // it, so the UI can receive early icons. Completion, however, must only
      // be reported after that worker has reached an idle terminal state.
      await waitForQueueIdle();
      // Stale-cancellation: a newer crawl for this key owns publication now.
      if (!crawlGens.isCurrent(iconKey, gen)) return;
      await promoteFirstIconToCache(iconKey);
      const finalResults = await getCrawlResults(iconKey);
      const saved = finalResults.filter((result) => Boolean(result.imageData));
      const remaining = finalResults.filter((result) => !result.imageData);
      const finalCounts: CrawlCounts = {
        discovered: finalResults.length,
        downloaded: saved.length,
        rejected: 0,
        deferred: remaining.length,
        spideredPages: 0,
      };
      const terminalStatus = terminalStatusFor(
        saved.length,
        remaining.length,
        providerFailures,
      );
      await reportCrawlProgress(
        iconKey,
        terminalStatus,
        terminalStatus === "complete"
          ? `${saved.length} valid icons saved from ${finalResults.length} candidates`
          : `${saved.length} valid icons saved; ${remaining.length} retryable; ${providerFailures} provider failure(s)`,
        finalCounts,
        true,
      );
    } catch (err) {
      console.error(`[CRAWL] Error crawling ${iconKey}:`, err);
      await updateIconCrawlSession(iconKey, {
        status: "failed",
        detail: err instanceof Error ? err.message : "Crawler failed",
        completed: true,
      });
      setIconCrawlProgress(iconKey, {
        status: "failed",
        detail: "Crawler failed; saved candidates can be retried",
      });
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
