/**
 * Multi-engine image search + Google dork search scraper.
 * No API keys required — scrapes HTML results directly.
 * Uses rotating User-Agents and timeouts.
 *
 * FIXED: Added comprehensive error logging, improved DuckDuckGo parsing,
 * removed unreliable engines, simplified search strategy.
 */

const FETCH_TIMEOUT_MS = 10000;
const MAX_RETRIES = 2;

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

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response | null> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
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
      if (response.ok) {
        console.log(
          `[SEARCH_ENGINE] Success (${response.status}): ${url.substring(0, 80)}`,
        );
        return response;
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
  console.log(
    `[SEARCH_ENGINE] DuckDuckGo search starting for "${brand}" (variation ${index})`,
  );
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  // Use the user-confirmed working URL pattern
  const url = `https://duckduckgo.com/?q=${query}&iax=images&ia=images`;
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
  console.log(
    `[SEARCH_ENGINE] Google Images search starting for "${brand}" (variation ${index})`,
  );
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  const url = `https://www.google.com/images?q=${query}&tbm=isch&hl=en`;
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
  // SVG searches (highest priority)
  `{brand} logo filetype:svg`,
  `{brand} icon filetype:svg`,
  `site:simpleicons.org "{brand}"`,
  `site:worldvectorlogo.com "{brand}"`,
  `site:wikimedia.org "{brand} logo"`,
  `intitle:"{brand}" "logo" filetype:svg`,
  // PNG searches (transparent backgrounds)
  `{brand} logo png transparent`,
  `{brand} icon png transparent`,
  `site:icons8.com "{brand}"`,
  `site:iconfinder.com "{brand}"`,
  `site:flaticon.com "{brand}" logo`,
  `site:thenounproject.com "{brand}"`,
  // High-res searches
  `{brand} logo high resolution`,
  `{brand} logo hd filetype:png`,
  `{brand} logo 512x512`,
  // Official brand assets
  `site:{brand}.com "asset" "logo" "download"`,
  `inurl:press "{brand}" logo filetype:png`,
  `inurl:brand "{brand}" logo filetype:svg`,
  `"{brand}" "logo.svg"`,
  `{brand} brand guidelines logo`,
  // Favicon searches
  `{brand} favicon.ico`,
  `inurl:{brand} "apple-touch-icon"`,
  `inurl:{brand} "favicon"`,
];

export async function runDorkSearches(
  brand: string,
): Promise<ImageSearchResult[]> {
  console.log(`[SEARCH_ENGINE] Dork searches starting for "${brand}"`);
  const allResults: ImageSearchResult[] = [];
  const seen = new Set<string>();

  const queries = DORK_QUERIES.map((q) => q.replace(/\{brand\}/g, brand));

  for (let i = 0; i < queries.length; i += 2) {
    const batch = queries.slice(i, i + 2);
    console.log(
      `[SEARCH_ENGINE] Dork batch ${Math.floor(i / 2) + 1}/${Math.ceil(queries.length / 2)}`,
    );

    const batchResults = await Promise.all(
      batch.map(async (dorkQuery) => {
        const encodedQuery = encodeURIComponent(dorkQuery);
        const url = `https://www.google.com/search?q=${encodedQuery}&hl=en`;
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

    // Rate limiting between batches
    if (i + 2 < queries.length) {
      await new Promise((r) => setTimeout(r, 1500));
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

  // Run Google dork searches
  console.log(`[SEARCH_ENGINE] Running Google dork searches`);
  const dorkResults = await runDorkSearches(brand);
  console.log(`[SEARCH_ENGINE] Dork total: ${dorkResults.length} results`);
  dedupe(dorkResults);

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

  return top;
}
