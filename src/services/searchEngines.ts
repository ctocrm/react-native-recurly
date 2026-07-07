/**
 * Multi-engine image search + Google dork search scraper.
 * No API keys required — scrapes HTML results directly.
 * Uses rotating User-Agents, timeouts, and domain-level rate limiting.
 *
 * FIXED: Added comprehensive error logging, improved DuckDuckGo parsing,
 * removed unreliable engines, simplified search strategy, integrated
 * per-domain rate limit tracking so we don't hammer rate-limited targets.
 */

import {
  isDomainRateLimited,
  recordRateLimit,
  recordSuccess,
} from "./rateLimitTracker";

const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;
const MIN_RESULTS_FOR_SHORT_CIRCUIT = 15;

// Per-brand result cache to avoid re-hitting engines for repeated calls
const brandResultCache = new Map<
  string,
  { results: ImageSearchResult[]; ts: number }
>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

interface ImageSearchResult {
  url: string;
  format: "svg" | "png" | "ico" | "jpg" | "jpeg" | "gif" | "webp";
  source: string;
  width?: number;
  height?: number;
}

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:124.0) Gecko/20100101 Firefox/124.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:124.0) Gecko/20100101 Firefox/124.0",
];

function getRandomUserAgent(): string {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

/**
 * Fetch with timeout, rate-limit awareness, and retry logic.
 * Checks domain rate-limit state before attempting, and records rate-limit hits.
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response | null> {
  // Check if the domain is rate-limited before attempting
  const rateLimited = await isDomainRateLimited(url);
  if (rateLimited) {
    console.log(
      `[SEARCH_ENGINE] Skipping rate-limited domain: ${url.substring(0, 80)}`,
    );
    return null;
  }

  const maxRetries = MAX_RETRIES;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.log(
        `[SEARCH_ENGINE] Fetch attempt ${attempt + 1}: ${url.substring(0, 120)}`,
      );
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          ...options.headers,
          "User-Agent": getRandomUserAgent(),
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
      });

      // Success - record it for rate limit tracking
      if (response.ok) {
        console.log(
          `[SEARCH_ENGINE] Success (${response.status}): ${url.substring(0, 80)}`,
        );
        await recordSuccess(url);
        return response;
      }

      // Detect 429 rate-limit and honor Retry-After with exponential backoff
      if (response.status === 429) {
        const retryAfter = response.headers.get("Retry-After");
        const delaySec = retryAfter
          ? parseInt(retryAfter, 10)
          : Math.pow(2, attempt + 1);
        const delayMs = Math.min(delaySec * 1000, 30000); // cap at 30s
        console.log(
          `[SEARCH_ENGINE] 429 rate-limited, waiting ${delayMs}ms (attempt ${attempt + 1})`,
        );
        await recordRateLimit(url);
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      // 403 likely means blocked entirely
      if (response.status === 403) {
        console.log(
          `[SEARCH_ENGINE] 403 forbidden, recording rate limit: ${url.substring(0, 80)}`,
        );
        await recordRateLimit(url);
      }

      console.log(
        `[SEARCH_ENGINE] Non-ok status ${response.status}: ${url.substring(0, 80)}`,
      );
    } catch (err: any) {
      console.log(
        `[SEARCH_ENGINE] Fetch error attempt ${attempt + 1}: ${err?.name || err?.message || err}`,
      );
      if (err?.name === "AbortError") {
        console.log(`[SEARCH_ENGINE] Timeout: ${url.substring(0, 80)}`);
      }
    } finally {
      clearTimeout(timer);
    }
    // Exponential backoff between retries
    if (attempt < maxRetries) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 500));
    }
  }
  console.log(`[SEARCH_ENGINE] All attempts failed: ${url.substring(0, 80)}`);
  return null;
}

function detectFormat(url: string): ImageSearchResult["format"] {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  if (clean.endsWith(".svg")) return "svg";
  if (clean.endsWith(".ico")) return "ico";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpeg";
  if (clean.endsWith(".gif")) return "gif";
  if (clean.endsWith(".webp")) return "webp";
  return "png";
}

/**
 * DuckDuckGo image search - most reliable for scraping.
 * Uses the standard image search URL pattern.
 * FIXED: Added multiple extraction patterns for DDG's various HTML formats.
 */
function extractDuckDuckGoImages(
  html: string,
  brand: string,
): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

  // Pattern 1: <img data-src="..." ...> - DuckDuckGo uses data-src for lazy loading
  const dataSrcRegex =
    /<img[^>]+data-src\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = dataSrcRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (
      !seen.has(url) &&
      !url.includes("duckduckgo") &&
      !url.includes("anonymize")
    ) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 2: <img src="..." ...> with image-like URLs
  const srcRegex =
    /<img[^>]+src\s*=\s*["']((?:https?:)?\/\/[^"']+(?:png|svg|jpg|jpeg|ico|webp)[^"']*)["']/gi;
  while ((match = srcRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (!seen.has(url) && !url.includes("duckduckgo")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 3: DuckDuckGo's tilde (encoded) image URLs in the HTML
  // DDG sometimes returns image URLs wrapped in u.js redirects
  const encodedImgRegex = /"image"\s*:\s*"((?:https?:)?\\?\/\\?\/[^"]+)/gi;
  while ((match = encodedImgRegex.exec(html)) !== null) {
    const url = match[1]
      .replace(/\\\//g, "/")
      .replace(/\\u003d/g, "=")
      .replace(/\\/g, "");
    if (!seen.has(url) && !url.includes("duckduckgo")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 4: JSON blob embedded in script tags (most common DDG approach)
  const jsonRegex =
    /"url"\s*:\s*"((?:https?:)?\\?\/\\?\/[^"\\]+(?:png|svg|jpg|jpeg|ico|webp)[^"]*)"/gi;
  while ((match = jsonRegex.exec(html)) !== null) {
    const url = match[1]
      .replace(/\\\//g, "/")
      .replace(/\\u003d/g, "=")
      .replace(/\\/g, "");
    if (!seen.has(url) && !url.includes("duckduckgo")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 5: Try to find vqd/encoded image data in script content
  // DDG often embeds image data in JSON within <script> tags
  const scriptJsonRegex =
    /<script[^>]*>[\s\S]*?"image"\s*:\s*"(https?:\/\/[^"]+\.(?:png|svg|jpg|jpeg|ico|webp)[^"]*)"[\s\S]*?<\/script>/gi;
  while ((match = scriptJsonRegex.exec(html)) !== null) {
    const url = match[1].replace(/\\u0026/g, "&").replace(/\\\//g, "/");
    if (!seen.has(url) && !url.includes("duckduckgo")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 6: Look for srcset attributes (modern DDG responsive images)
  const srcsetRegex =
    /<img[^>]+srcset\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
  while ((match = srcsetRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://").split(" ")[0];
    if (!seen.has(url) && !url.includes("duckduckgo")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 7: Direct <a> links to image files
  const linkRegex =
    /<a[^>]+href\s*=\s*["']((?:https?:)?\/\/[^"']+\.(?:png|svg|jpg|jpeg|ico|webp)[^"']*)["']/gi;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (!seen.has(url) && !url.includes("duckduckgo")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 8: DDG's new VQD-based AJAX image loading - check for thumbnail data
  const vqdRegex = /"thumbnail"\s*:\s*"(https?:\/\/[^"]+)"/gi;
  while ((match = vqdRegex.exec(html)) !== null) {
    const url = match[1].replace(/\\\//g, "/").replace(/\\u0026/g, "&");
    if (!seen.has(url) && !url.includes("duckduckgo")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "duckduckgo_images",
      });
    }
  }

  // Pattern 9: DDG results JSON in `data-results` attribute
  const dataResultsRegex = /data-results\s*=\s*"([^"]+)"/gi;
  while ((match = dataResultsRegex.exec(html)) !== null) {
    try {
      const decoded = JSON.parse(decodeURIComponent(match[1]));
      if (decoded?.results) {
        for (const result of decoded.results) {
          const url = result?.image || result?.thumbnail;
          if (url && !seen.has(url) && !url.includes("duckduckgo")) {
            seen.add(url);
            results.push({
              url,
              format: detectFormat(url),
              source: "duckduckgo_images",
            });
          }
        }
      }
    } catch {
      // ignore JSON parse errors
    }
  }

  // Fallback Pattern: Extract ANY urls from DDG that look like image hosts
  // This catches DDG's newer result formats with encoded URLs
  if (results.length === 0) {
    const anyImgRegex = /<img[^>]+(?:data-src|src)\s*=\s*["']([^"']+)["']/gi;
    const allImgs: string[] = [];
    let imgMatch;
    while ((imgMatch = anyImgRegex.exec(html)) !== null) {
      allImgs.push(imgMatch[1].substring(0, 100));
    }
    if (allImgs.length > 0) {
      console.log(
        `[SEARCH_ENGINE] DuckDuckGo DEBUG: Found ${allImgs.length} <img> tags but none matched extraction patterns`,
      );
      console.log(
        `[SEARCH_ENGINE] DuckDuckGo DEBUG: Sample src/data-src: ${allImgs.slice(0, 3).join(", ")}`,
      );
    }

    // Last resort: search for any URL-looking strings that point to known image hosts
    const rawUrlRegex =
      /https?:\/\/[^"'\s>]+\.(?:png|svg|jpg|jpeg|ico|webp)[^"'\s]*/gi;
    let rawUrlMatch;
    while ((rawUrlMatch = rawUrlRegex.exec(html)) !== null) {
      const url = rawUrlMatch[0].replace(/[),]+$/g, "");
      if (!seen.has(url) && !url.includes("duckduckgo")) {
        seen.add(url);
        results.push({
          url,
          format: detectFormat(url),
          source: "duckduckgo_images",
        });
      }
    }
    if (results.length > 0) {
      console.log(
        `[SEARCH_ENGINE] DuckDuckGo FALLBACK: Extracted ${results.length} raw image URLs`,
      );
    }
  }

  console.log(
    `[SEARCH_ENGINE] DuckDuckGo extracted ${results.length} unique image URLs for "${brand}"`,
  );
  return results;
}

/**
 * Google Images - may be blocked in React Native, but attempt anyway
 */
function extractGoogleImages(html: string, brand: string): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

  // Standard img tags
  const imgRegex = /<img[^>]+(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (
      !seen.has(url) &&
      !url.includes("google") &&
      !url.includes("gstatic.com") &&
      !url.endsWith(".gif")
    ) {
      seen.add(url);
      results.push({ url, format: detectFormat(url), source: "google_images" });
    }
  }

  // JSON-encoded image URLs in inline scripts/data
  const jsonRegex =
    /"(?:src|ou|s)\s*"\s*:\s*"((?:https?:)?\/\/[^"\\]+(?:png|svg|jpg|jpeg|ico|webp)[^"]*)"/gi;
  while ((match = jsonRegex.exec(html)) !== null) {
    const url = match[1].replace(/\\u003d/g, "=").replace(/\\\//g, "/");
    if (!seen.has(url) && !url.includes("gstatic.com")) {
      seen.add(url);
      results.push({ url, format: detectFormat(url), source: "google_images" });
    }
  }

  // Pattern: Try to extract ANY src/data-src that contains image extensions
  // This catches modern Google and DDG formats that don't match other patterns
  const anyImgRegex = /src=["']([^"']+)["']/gi;
  let anyMatch;
  while ((anyMatch = anyImgRegex.exec(html)) !== null) {
    const url = anyMatch[1].replace(/^\/\//, "https://");
    // Filter out non-http URLs and known trackers
    if (
      !seen.has(url) &&
      (url.includes(".png") ||
        url.includes(".svg") ||
        url.includes(".jpg") ||
        url.includes(".jpeg") ||
        url.includes(".ico") ||
        url.includes(".webp")) &&
      !url.includes("google") &&
      !url.includes("gstatic") &&
      !url.includes("duckduckgo") &&
      !url.includes("base64") &&
      url.startsWith("http")
    ) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "google_images",
      });
    }
  }

  console.log(
    `[SEARCH_ENGINE] Google extracted ${results.length} unique image URLs for "${brand}"`,
  );
  return results;
}

/**
 * Google dork web search results parser (more reliable than image search)
 */
function extractGoogleSearchResults(html: string): {
  imageUrls: string[];
  linkUrls: string[];
} {
  const imageUrls: string[] = [];
  const linkUrls: string[] = [];

  // Extract links from search results
  const linkRegex =
    /<a[^>]+href\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (
      !url.includes("google") &&
      !url.includes("accounts") &&
      !url.includes("support")
    ) {
      linkUrls.push(url);
    }
  }

  // Extract image thumbnails
  const imgRegex =
    /<img[^>]+(?:src|data-src)\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (!url.includes("google") && !url.includes("gstatic")) {
      imageUrls.push(url);
    }
  }

  // Fallback: Extract any URLs from Google's result divs
  if (linkUrls.length === 0 && imageUrls.length === 0) {
    // Modern Google uses <div class="g"> with <a> inside
    const divLinkRegex =
      /<div[^>]*class="g"[^>]*>[\s\S]*?<a[^>]+href\s*=\s*["'](([^"']+))["'][^>]*>/gi;
    let divMatch;
    while ((divMatch = divLinkRegex.exec(html)) !== null) {
      const url = divMatch[1].replace(/^\/\//, "https://");
      if (
        !url.includes("google") &&
        !url.includes("accounts") &&
        !url.includes("support") &&
        url.startsWith("http")
      ) {
        linkUrls.push(url);
      }
    }

    // Also try to find data-s or data-url attributes in result divs
    const dataSRegex = /data-s=["'](([^"']+\.(?:png|svg|jpg|jpeg)))["']/gi;
    let sMatch;
    while ((sMatch = dataSRegex.exec(html)) !== null) {
      imageUrls.push(sMatch[1]);
    }
  }

  console.log(
    `[SEARCH_ENGINE] Google dork search extracted ${imageUrls.length} images, ${linkUrls.length} links`,
  );
  return { imageUrls, linkUrls };
}

// Search variations for comprehensive coverage
const SEARCH_VARIATIONS = [
  (b: string) => `${b} logo`,
  (b: string) => `${b} icon`,
  (b: string) => `${b} logo svg`,
  (b: string) => `${b} icon svg`,
  (b: string) => `${b} logo transparent png`,
  (b: string) => `${b} icon transparent png`,
  (b: string) => `${b} logo 512x512`,
  (b: string) => `${b} brand logo`,
  (b: string) => `${b} official logo`,
  (b: string) => `${b} brand icon`,
];

/**
 * DuckDuckGo image search - primary search engine (most scrape-friendly)
 */
export async function searchDuckDuckGoImages(
  brand: string,
  index: number = 0,
): Promise<ImageSearchResult[]> {
  const ddgUrl = "https://duckduckgo.com";

  // Check if DuckDuckGo itself is rate-limited before attempting
  const rateLimited = await isDomainRateLimited(ddgUrl);
  if (rateLimited) {
    console.log(
      `[SEARCH_ENGINE] DuckDuckGo is rate-limited, skipping search for "${brand}"`,
    );
    return [];
  }

  console.log(
    `[SEARCH_ENGINE] DuckDuckGo search starting for "${brand}" (variation ${index})`,
  );
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  const url = `${ddgUrl}/?q=${query}&iax=images&ia=images`;
  console.log(`[SEARCH_ENGINE] DuckDuckGo URL: ${url}`);

  const response = await fetchWithTimeout(url, { method: "GET" }, 12000);
  if (!response) {
    console.log(`[SEARCH_ENGINE] DuckDuckGo: No response for "${brand}"`);
    return [];
  }

  const html = await response.text();
  console.log(
    `[SEARCH_ENGINE] DuckDuckGo: Got ${html.length} chars of HTML for "${brand}"`,
  );

  const results = extractDuckDuckGoImages(html, brand);
  console.log(
    `[SEARCH_ENGINE] DuckDuckGo: Returning ${results.length} results for "${brand}"`,
  );
  return results;
}

/**
 * Google Images search (fallback - often blocked)
 */
export async function searchGoogleImages(
  brand: string,
  index: number = 0,
): Promise<ImageSearchResult[]> {
  const googleUrl = "https://www.google.com";

  // Check if Google is rate-limited before attempting
  const rateLimited = await isDomainRateLimited(googleUrl);
  if (rateLimited) {
    console.log(
      `[SEARCH_ENGINE] Google is rate-limited, skipping Images search for "${brand}"`,
    );
    return [];
  }

  console.log(
    `[SEARCH_ENGINE] Google Images search starting for "${brand}" (variation ${index})`,
  );
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  const url = `${googleUrl}/images?q=${query}&tbm=isch&hl=en`;
  console.log(`[SEARCH_ENGINE] Google Images URL: ${url}`);

  const response = await fetchWithTimeout(url, { method: "GET" }, 12000);
  if (!response) {
    console.log(`[SEARCH_ENGINE] Google Images: No response for "${brand}"`);
    return [];
  }

  const html = await response.text();
  console.log(
    `[SEARCH_ENGINE] Google Images: Got ${html.length} chars for "${brand}"`,
  );

  const results = extractGoogleImages(html, brand);
  console.log(
    `[SEARCH_ENGINE] Google Images: Returning ${results.length} results for "${brand}"`,
  );
  return results;
}

// Enhanced dork queries with multiple search variations
const DORK_QUERIES = [
  `{brand} logo filetype:svg`,
  `{brand} icon filetype:svg`,
  `site:simpleicons.org "{brand}"`,
  `site:worldvectorlogo.com "{brand}"`,
  `site:wikimedia.org "{brand} logo"`,
  `intitle:"{brand}" "logo" filetype:svg`,
  `{brand} logo png transparent`,
  `{brand} icon png transparent`,
  `site:icons8.com "{brand}"`,
  `site:iconfinder.com "{brand}"`,
  `site:flaticon.com "{brand}" logo`,
  `site:thenounproject.com "{brand}"`,
  `{brand} logo high resolution`,
  `{brand} logo hd filetype:png`,
  `{brand} logo 512x512`,
  `site:{brand}.com "asset" "logo" "download"`,
  `inurl:press "{brand}" logo filetype:png`,
  `inurl:brand "{brand}" logo filetype:svg`,
  `"{brand}" "logo.svg"`,
  `{brand} brand guidelines logo`,
  `{brand} favicon.ico`,
  `inurl:{brand} "apple-touch-icon"`,
  `inurl:{brand} "favicon"`,
];

/**
 * Run Google dork searches - but only if Google is not rate-limited.
 * FIXED: Checks rate limit before running dorks, and adds delays between batches.
 */
export async function runDorkSearches(
  brand: string,
): Promise<ImageSearchResult[]> {
  const googleUrl = "https://www.google.com";

  // Check if Google is rate-limited - skip all dork searches if so
  const rateLimited = await isDomainRateLimited(googleUrl);
  if (rateLimited) {
    console.log(
      `[SEARCH_ENGINE] Google is rate-limited, skipping all dork searches for "${brand}"`,
    );
    return [];
  }

  console.log(`[SEARCH_ENGINE] Dork searches starting for "${brand}"`);
  const allResults: ImageSearchResult[] = [];
  const seen = new Set<string>();

  const queries = DORK_QUERIES.map((q) => q.replace(/\{brand\}/g, brand));

  for (let i = 0; i < queries.length; i += 2) {
    // Re-check rate limit before each batch
    const stillLimited = await isDomainRateLimited(googleUrl);
    if (stillLimited) {
      console.log(
        `[SEARCH_ENGINE] Google became rate-limited during dork searches, stopping early for "${brand}"`,
      );
      break;
    }

    const batch = queries.slice(i, i + 2);
    console.log(
      `[SEARCH_ENGINE] Dork batch ${Math.floor(i / 2) + 1}/${Math.ceil(queries.length / 2)}`,
    );

    const batchResults = await Promise.all(
      batch.map(async (dorkQuery) => {
        const encodedQuery = encodeURIComponent(dorkQuery);
        const url = `${googleUrl}/search?q=${encodedQuery}&hl=en`;
        console.log(`[SEARCH_ENGINE] Dork URL: ${url.substring(0, 120)}`);

        const response = await fetchWithTimeout(url, { method: "GET" }, 12000);
        if (!response) {
          console.log(
            `[SEARCH_ENGINE] Dork: No response for "${dorkQuery.substring(0, 60)}"`,
          );
          return [];
        }

        const html = await response.text();
        console.log(
          `[SEARCH_ENGINE] Dork: Got ${html.length} chars for "${dorkQuery.substring(0, 60)}"`,
        );

        const { imageUrls, linkUrls } = extractGoogleSearchResults(html);

        const results: ImageSearchResult[] = [];

        for (const imgUrl of imageUrls) {
          if (!seen.has(imgUrl)) {
            seen.add(imgUrl);
            results.push({
              url: imgUrl,
              format: detectFormat(imgUrl),
              source: `dork:${dorkQuery.substring(0, 50)}`,
            });
          }
        }

        for (const linkUrl of linkUrls) {
          if (
            !seen.has(linkUrl) &&
            (linkUrl.endsWith(".svg") ||
              linkUrl.endsWith(".png") ||
              linkUrl.includes("logo") ||
              linkUrl.includes("icon") ||
              linkUrl.includes("favicon"))
          ) {
            seen.add(linkUrl);
            results.push({
              url: linkUrl,
              format: detectFormat(linkUrl),
              source: `dork:${dorkQuery.substring(0, 50)}`,
            });
          }
        }

        console.log(
          `[SEARCH_ENGINE] Dork: Found ${results.length} results for "${dorkQuery.substring(0, 60)}"`,
        );
        return results;
      }),
    );

    for (const results of batchResults) {
      allResults.push(...results);
    }

    // Longer delay between batches when rate-limited recently
    if (i + 2 < queries.length) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log(
    `[SEARCH_ENGINE] Dork searches: Total ${allResults.length} results for "${brand}"`,
  );
  return allResults;
}

export async function searchAllSources(
  brand: string,
): Promise<ImageSearchResult[]> {
  console.log(
    `[SEARCH_ENGINE] ===== searchAllSources starting for "${brand}" =====`,
  );

  // Check per-brand cache first
  const cached = brandResultCache.get(brand);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    console.log(
      `[SEARCH_ENGINE] Returning ${cached.results.length} cached results for "${brand}"`,
    );
    return cached.results;
  }

  const allResults: ImageSearchResult[] = [];
  const seenUrls = new Set<string>();

  const dedupe = (results: ImageSearchResult[]) => {
    for (const r of results) {
      const normalizedUrl = r.url.replace(/^\/\//, "https://").split("?")[0];
      const storedUrl = r.url.replace(/^\/\//, "https://");
      if (!seenUrls.has(normalizedUrl)) {
        seenUrls.add(normalizedUrl);
        allResults.push({ ...r, url: storedUrl });
      }
    }
  };

  // Run DuckDuckGo with multiple variations - this is the most reliable engine
  console.log(`[SEARCH_ENGINE] Running DuckDuckGo searches (primary engine)`);
  const ddgResults = await Promise.all(
    SEARCH_VARIATIONS.slice(0, 5).map((_, i) =>
      searchDuckDuckGoImages(brand, i),
    ),
  ).then((results) => results.flat());
  console.log(`[SEARCH_ENGINE] DuckDuckGo total: ${ddgResults.length} results`);
  dedupe(ddgResults);

  // Short-circuit if we already have enough results
  if (allResults.length >= MIN_RESULTS_FOR_SHORT_CIRCUIT) {
    console.log(
      `[SEARCH_ENGINE] Short-circuiting with ${allResults.length} results from DuckDuckGo`,
    );
    const sorted = allResults.sort((a, b) => {
      const aScore = a.format === "svg" ? 3 : a.format === "png" ? 2 : 1;
      const bScore = b.format === "svg" ? 3 : b.format === "png" ? 2 : 1;
      return bScore - aScore;
    });
    const top = sorted.slice(0, 50);
    brandResultCache.set(brand, { results: top, ts: Date.now() });
    return top;
  }

  // Check if DuckDuckGo is rate-limited and if so, still try other sources
  const ddgIsRateLimited = await isDomainRateLimited("https://duckduckgo.com");
  if (ddgIsRateLimited) {
    console.log(
      `[SEARCH_ENGINE] DuckDuckGo is rate-limited, but continuing with Google dork searches`,
    );
  }

  // Run Google dork searches - these will be skipped if Google is rate-limited
  console.log(`[SEARCH_ENGINE] Running Google dork searches`);
  const dorkResults = await runDorkSearches(brand);
  console.log(`[SEARCH_ENGINE] Dork total: ${dorkResults.length} results`);
  dedupe(dorkResults);

  // Short-circuit again after dorks
  if (allResults.length >= MIN_RESULTS_FOR_SHORT_CIRCUIT) {
    console.log(
      `[SEARCH_ENGINE] Short-circuiting with ${allResults.length} results after dork searches`,
    );
    const sorted = allResults.sort((a, b) => {
      const aScore = a.format === "svg" ? 3 : a.format === "png" ? 2 : 1;
      const bScore = b.format === "svg" ? 3 : b.format === "png" ? 2 : 1;
      return bScore - aScore;
    });
    const top = sorted.slice(0, 50);
    brandResultCache.set(brand, { results: top, ts: Date.now() });
    return top;
  }

  // Try Google Images as well (may be blocked)
  console.log(`[SEARCH_ENGINE] Running Google Images search`);
  const googleResults = await Promise.all(
    SEARCH_VARIATIONS.slice(0, 2).map((_, i) => searchGoogleImages(brand, i)),
  ).then((results) => results.flat());
  console.log(
    `[SEARCH_ENGINE] Google Images total: ${googleResults.length} results`,
  );
  dedupe(googleResults);

  // Sort by format priority (svg > png > others)
  const sorted = allResults.sort((a, b) => {
    const aScore = a.format === "svg" ? 3 : a.format === "png" ? 2 : 1;
    const bScore = b.format === "svg" ? 3 : b.format === "png" ? 2 : 1;
    return bScore - aScore;
  });

  const top = sorted.slice(0, 50);
  console.log(
    `[SEARCH_ENGINE] ===== searchAllSources done for "${brand}": ${top.length} results =====`,
  );

  // Log first few results
  top.slice(0, 5).forEach((r, i) => {
    console.log(
      `[SEARCH_ENGINE] Result ${i + 1}: ${r.source} | ${r.format} | ${r.url.substring(0, 100)}`,
    );
  });

  // Store in cache before returning
  brandResultCache.set(brand, { results: top, ts: Date.now() });
  return top;
}

export async function searchForLinksToSpider(brand: string): Promise<string[]> {
  console.log(`[SEARCH_ENGINE] ===== searchForLinksToSpider starting for "${brand}" =====`);
  const ddgTextUrl = "https://duckduckgo.com";
  const allLinks: string[] = [];
  const seenLinks = new Set<string>();

  if (!(await isDomainRateLimited(ddgTextUrl))) {
    try {
      const response = await fetch(
        `${ddgTextUrl}/?q=${encodeURIComponent(brand)}&ia=web`,
        { headers: { "User-Agent": getRandomUserAgent() } }
      );
      if (response.ok) {
        const html = await response.text();
        const linkMatches = html.matchAll(/<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi);
        for (const match of linkMatches) {
          let url = match[1];
          if (url.startsWith("//")) url = "https:" + url;
          if (url.startsWith("http") && !url.includes("duckduckgo.com") && !url.includes("google.com")) {
            if (!seenLinks.has(url)) { seenLinks.add(url); allLinks.push(url); }
          }
        }
        console.log(`[SEARCH_ENGINE] Text search found ${allLinks.length} links`);
      }
    } catch (e) { console.log(`[SEARCH_ENGINE] DDG text search error: ${e}`); }
  }
  console.log(`[SEARCH_ENGINE] ===== searchForLinksToSpider done for "${brand}": ${allLinks.length} links =====`);
  return allLinks.slice(0, 30);
}
