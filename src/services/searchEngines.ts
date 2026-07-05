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
      if (response.ok) return response;
    } catch {
      // Retry
    } finally {
      clearTimeout(timer);
    }
  }
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

// Extract image URLs from HTML
function extractGoogleImages(html: string, brand: string): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

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

  const jsonRegex =
    /"(?:src|ou|s)\s*"\s*:\s*"((?:https?:)?\/\/[^"\\]+(?:png|svg|jpg|jpeg|ico|webp)[^"]*)"/gi;
  while ((match = jsonRegex.exec(html)) !== null) {
    const url = match[1].replace(/\\u003d/g, "=").replace(/\\\//g, "/");
    if (!seen.has(url) && !url.includes("gstatic.com")) {
      seen.add(url);
      results.push({ url, format: detectFormat(url), source: "google_images" });
    }
  }

  return results;
}

function extractBingImages(html: string, brand: string): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

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

function extractDuckDuckGoImages(
  html: string,
  brand: string,
): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

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

function extractYandexImages(html: string, brand: string): ImageSearchResult[] {
  const results: ImageSearchResult[] = [];
  const seen = new Set<string>();

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

function extractGoogleSearchResults(html: string): {
  imageUrls: string[];
  linkUrls: string[];
} {
  const imageUrls: string[] = [];
  const linkUrls: string[] = [];

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

// Search variations for comprehensive coverage
const SEARCH_VARIATIONS = [
  (b: string) => `${b} logo`,
  (b: string) => `${b} icon`,
  (b: string) => `${b} logo svg`,
  (b: string) => `${b} icon svg`,
  (b: string) => `${b} logo transparent png`,
  (b: string) => `${b} icon transparent png`,
  (b: string) => `${b} logo 512x512`,
  (b: string) => `${b} logo hd`,
  (b: string) => `${b} brand logo`,
  (b: string) => `${b} official logo`,
];

export async function searchGoogleImages(
  brand: string,
  index: number = 0,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  const url = `https://www.google.com/images?q=${query}&tbm=isch&hl=en`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractGoogleImages(html, brand);
}

export async function searchBingImages(
  brand: string,
  index: number = 0,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  const url = `https://www.bing.com/images/search?q=${query}&hl=en`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractBingImages(html, brand);
}

export async function searchDuckDuckGoImages(
  brand: string,
  index: number = 0,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  const url = `https://duckduckgo.com/?q=${query}&iax=images&ia=images`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractDuckDuckGoImages(html, brand);
}

export async function searchYandexImages(
  brand: string,
  index: number = 0,
): Promise<ImageSearchResult[]> {
  const query = encodeURIComponent(
    SEARCH_VARIATIONS[index % SEARCH_VARIATIONS.length](brand),
  );
  const url = `https://yandex.com/images/search?text=${query}`;
  const response = await fetchWithTimeout(url, { method: "GET" });
  if (!response) return [];
  const html = await response.text();
  return extractYandexImages(html, brand);
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
  `site:github.com "{brand}" "svg"`,
  `inurl:icon "{brand}" filetype:svg`,
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
  `{brand} logo 256x256`,
  // Official brand assets
  `site:{brand}.com "asset" "logo" "download"`,
  `inurl:press "{brand}" logo filetype:png`,
  `inurl:brand "{brand}" logo filetype:svg`,
  `"{brand}" "logo.svg"`,
  `{brand} brand guidelines logo`,
  // Alternative icon packs
  `site:cdnjs.com "{brand} icon"`,
  `site:unpkg.com "{brand} icon"`,
  // Favicon searches
  `{brand} favicon.ico`,
  `inurl:{brand} "apple-touch-icon"`,
  `inurl:{brand} "favicon"`,
];

export async function runDorkSearches(
  brand: string,
): Promise<ImageSearchResult[]> {
  const allResults: ImageSearchResult[] = [];
  const seen = new Set<string>();

  const queries = DORK_QUERIES.map((q) => q.replace(/\{brand\}/g, brand));

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

        return results;
      }),
    );

    for (const results of batchResults) {
      allResults.push(...results);
    }

    if (i + 2 < queries.length) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  return allResults;
}

export async function searchAllSources(
  brand: string,
): Promise<ImageSearchResult[]> {
  const allResults: ImageSearchResult[] = [];
  const seenUrls = new Set<string>();

  // Run multiple searches per engine with different variations
  const [googleRes, bingRes, ddgRes, yandexRes, dorkRes] = await Promise.all([
    Promise.all(
      SEARCH_VARIATIONS.slice(0, 3).map((_, i) => searchGoogleImages(brand, i)),
    ).then((results) => results.flat()),
    Promise.all(
      SEARCH_VARIATIONS.slice(0, 2).map((_, i) => searchBingImages(brand, i)),
    ).then((results) => results.flat()),
    searchDuckDuckGoImages(brand, 0),
    searchYandexImages(brand, 0),
    runDorkSearches(brand),
  ]);

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

  dedupe(googleRes);
  dedupe(bingRes);
  dedupe(ddgRes);
  dedupe(yandexRes);
  dedupe(dorkRes);

  const sorted = allResults.sort((a, b) => {
    const aScore = a.format === "svg" ? 3 : a.format === "png" ? 2 : 1;
    const bScore = b.format === "svg" ? 3 : b.format === "png" ? 2 : 1;
    return bScore - aScore;
  });

  return sorted.slice(0, 50);
}
