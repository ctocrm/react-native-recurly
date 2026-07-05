/**
 * Multi-engine image search + Google dork search scraper.
 * No API keys required — scrapes HTML results directly.
 * Uses rotating User-Agents and timeouts.
 */

const FETCH_TIMEOUT_MS = 8000;
const MAX_RETRIES = 2;

interface ImageSearchResult {
  url: string;
  format: "svg" | "png" | "ico" | "jpg" | "jpeg" | "gif" | "webp";
  source: string; // which engine or dork found it
  width?: number;
  height?: number;
}

// Rotating User-Agent pool to avoid blocks
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
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
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
      clearTimeout(timer);
      if (response.ok) return response;
    } catch {
      // Retry
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Helper to detect image format from URL
// ---------------------------------------------------------------------------
function detectFormat(url: string): ImageSearchResult["format"] {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  if (clean.endsWith(".svg")) return "svg";
  if (clean.endsWith(".ico")) return "ico";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpeg";
  if (clean.endsWith(".gif")) return "gif";
  if (clean.endsWith(".webp")) return "webp";
  return "png"; // default
}

// ---------------------------------------------------------------------------
// Extract image URLs from HTML using regex (engine-specific patterns)
// ---------------------------------------------------------------------------

// Google Images: extract from img data-src or src attributes within result divs
function extractGoogleImages(html: string, brand: string): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

  // Google puts images in <img> tags with data-src, or in script JSON
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

  // Also try to find image URLs in inline JSON
  const jsonRegex =
    /"(?:src|ou|s)\s*"\s*:\s*"((?:https?:)?\/\/[^"\\]+(?:png|svg|jpg|jpeg|ico|webp)[^"]*)"/gi;
  while ((match = jsonRegex.exec(html)) !== null) {
    const url = match[1].replace(/\\u003d/g, "=").replace(/\\\//g, "/");
    if (!seen.has(url) && !url.includes("gstatic.com")) {
      seen.add(url);
      results.push({
        url,
        format: detectFormat(url),
        source: "google_images",
      });
    }
  }

  return results;
}

// Bing Images: extract from mimg or img elements
function extractBingImages(html: string, brand: string): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

  // Bing uses <img class="mimg" ... src="...">
  const imgRegex =
    /<img[^>]+class\s*=\s*["'][^"']*\bmimg\b[^"']*["'][^>]+src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (!seen.has(url) && !url.includes("bing")) {
      seen.add(url);
      results.push({ url, format: detectFormat(url), source: "bing_images" });
    }
  }

  // Also generic img src
  const genericRegex =
    /<img[^>]+src\s*=\s*["']((?:https?:)?\/\/[^"']+(?:png|svg|jpg|jpeg|ico)[^"']*)["']/gi;
  while ((match = genericRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (
      !seen.has(url) &&
      !url.includes("bing") &&
      !url.includes("th.bing.com")
    ) {
      seen.add(url);
      results.push({ url, format: detectFormat(url), source: "bing_images" });
    }
  }

  return results;
}

// DuckDuckGo: extract from img elements in results
function extractDuckDuckGoImages(
  html: string,
  brand: string,
): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

  // DuckDuckGo stores tiles in <img> with data-src
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

  // Generic img src
  const srcRegex =
    /<img[^>]+src\s*=\s*["']((?:https?:)?\/\/[^"']+(?:png|svg|jpg|jpeg|ico)[^"']*)["']/gi;
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

  return results;
}

// Yandex Images: extract from img tags
function extractYandexImages(html: string, brand: string): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

  // Yandex uses <img class="serp-item__thumb" src="...">
  const imgRegex =
    /<img[^>]+(?:src|data-src)\s*=\s*["']((?:https?:)?\/\/[^"']+(?:png|svg|jpg|jpeg|ico)[^"']*)["']/gi;
  let match: RegExpExecArray | null;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (
      !seen.has(url) &&
      !url.includes("yandex") &&
      !url.includes("yastatic")
    ) {
      seen.add(url);
      results.push({ url, format: detectFormat(url), source: "yandex_images" });
    }
  }

  return results;
}

// Extract image and link URLs from Google search results (for dorks)
function extractGoogleSearchResults(html: string): {
  imageUrls: string[];
  linkUrls: string[];
} {
  const imageUrls: string[] = [];
  const linkUrls: string[] = [];

  // Extract link URLs from <a> tags
  const linkRegex =
    /<a[^>]+href\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = linkRegex.exec(html)) !== null) {
    const url = match[1];
    if (
      !url.includes("google") &&
      !url.includes("accounts") &&
      !url.includes("support")
    ) {
      linkUrls.push(url);
    }
  }

  // Extract image URLs
  const imgRegex =
    /<img[^>]+(?:src|data-src)\s*=\s*["']((?:https?:)?\/\/[^"']+)["'][^>]*>/gi;
  while ((match = imgRegex.exec(html)) !== null) {
    const url = match[1].replace(/^\/\//, "https://");
    if (!url.includes("google") && !url.includes("gstatic")) {
      imageUrls.push(url);
    }
  }

  return { imageUrls, linkUrls };
}

// ---------------------------------------------------------------------------
// Search Engine Queries
// ---------------------------------------------------------------------------

export async function searchGoogleImages(
  brand: string,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(`${brand} logo`);
  const url = `https://www.google.com/images?q=${query}&tbm=isch&hl=en`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractGoogleImages(html, brand);
}

export async function searchBingImages(
  brand: string,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(`${brand} logo`);
  const url = `https://www.bing.com/images/search?q=${query}&hl=en`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractBingImages(html, brand);
}

export async function searchDuckDuckGoImages(
  brand: string,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(`${brand} logo`);
  const url = `https://duckduckgo.com/?q=${query}&iax=images&ia=images`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractDuckDuckGoImages(html, brand);
}

export async function searchYandexImages(
  brand: string,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(`${brand} logo`);
  const url = `https://yandex.com/images/search?text=${query}`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractYandexImages(html, brand);
}

// ---------------------------------------------------------------------------
// Google Dork Queries
// ---------------------------------------------------------------------------

const DORK_QUERIES = [
  `intitle:"{brand}" "logo" filetype:svg`,
  `site:github.com "{brand}" "logo" "svg"`,
  `inurl:icon "{brand}" svg`,
  `site:simpleicons.org "{brand}"`,
  `site:worldvectorlogo.com "{brand}"`,
  `site:seeklogo.com "{brand}"`,
  `inurl:press "{brand}" logo`,
  `inurl:brand "{brand}" logo`,
  `"{brand}" "logo.svg"`,
  `site:icons8.com "{brand}"`,
  `site:iconfinder.com "{brand}"`,
  `site:flaticon.com "{brand}" logo`,
  `site:thenounproject.com "{brand}"`,
  `"{brand}" "favicon.ico"`,
  `inurl:"{brand}" "apple-touch-icon"`,
];

/**
 * Run all Google dork searches for a brand.
 * Each dork is a Google search URL that we scrape for results.
 */
export async function runDorkSearches(
  brand: string,
): Promise<ImageSearchResult[]> {
  const allResults: ImageSearchResult[] = [];
  const seen = new Set<string>();

  const queries = DORK_QUERIES.map((q) => q.replace(/\{brand\}/g, brand));

  // Process dorks with concurrency limit (2 at a time to avoid detection)
  for (let i = 0; i < queries.length; i += 2) {
    const batch = queries.slice(i, i + 2);
    const batchResults = await Promise.all(
      batch.map(async (dorkQuery) => {
        const encodedQuery = encodeURIComponent(dorkQuery);
        const url = `https://www.google.com/search?q=${encodedQuery}&hl=en`;
        const response = await fetchWithTimeout(url, { method: "GET" }, 10000);
        if (!response) return [];

        const html = await response.text();
        const { imageUrls, linkUrls } = extractGoogleSearchResults(html);

        const results: ImageSearchResult[] = [];

        // Add image URLs
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

        // Extract logo URLs from link URLs
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

        return results;
      }),
    );

    for (const results of batchResults) {
      allResults.push(...results);
    }

    // Small delay between batches to avoid rate limiting
    if (i + 2 < queries.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// All-in-one: search all engines and dorks
// ---------------------------------------------------------------------------

export async function searchAllSources(
  brand: string,
): Promise<ImageSearchResult[]> {
  const allResults: ImageSearchResult[] = [];
  const seenUrls = new Set<string>();

  // Run all engine searches + dorks in parallel
  const [googleRes, bingRes, ddgRes, yandexRes, dorkRes] = await Promise.all([
    searchGoogleImages(brand),
    searchBingImages(brand),
    searchDuckDuckGoImages(brand),
    searchYandexImages(brand),
    runDorkSearches(brand),
  ]);

  // Deduplicate by URL
  const dedupe = (results: ImageSearchResult[]) => {
    for (const r of results) {
      // Normalize URL
      const cleanUrl = r.url.replace(/^\/\//, "https://").split("?")[0];
      if (!seenUrls.has(cleanUrl)) {
        seenUrls.add(cleanUrl);
        allResults.push({ ...r, url: cleanUrl });
      }
    }
  };

  dedupe(googleRes);
  dedupe(bingRes);
  dedupe(ddgRes);
  dedupe(yandexRes);
  dedupe(dorkRes);

  // Prioritize SVG and PNG results, sort by preference
  const sorted = allResults.sort((a, b) => {
    const aScore = a.format === "svg" ? 3 : a.format === "png" ? 2 : 1;
    const bScore = b.format === "svg" ? 3 : b.format === "png" ? 2 : 1;
    return bScore - aScore;
  });

  // Limit to top 50 results to avoid overwhelming the download step
  return sorted.slice(0, 50);
}
