import { cacheIconToFileSystem, downloadIconAsBase64 } from "./iconScraper";

interface FaviconResult {
  url: string;
  format: "svg" | "png" | "ico";
}

const FETCH_TIMEOUT_MS = 5000;
const MAX_CONCURRENT_DOMAINS = 3;

// Timeout-aware fetch
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      return response;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// Generate likely domain names from brand name
function generateLikelyDomains(brandName: string): string[] {
  const cleaned = brandName
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/\s+/g, "");

  return [
    `https://${cleaned}.com`,
    `https://${cleaned}.io`,
    `https://www.${cleaned}.com`,
    `https://${cleaned}plus.com`, // For services like Disney+
    `https://www.${cleaned}plus.com`,
  ];
}

// Extract domain from URL
function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

// Check favicon at common paths
async function tryCommonFaviconPaths(
  domain: string,
): Promise<FaviconResult | null> {
  const paths = [
    `/favicon.ico`,
    `/favicon.svg`,
    `/apple-touch-icon.png`,
    `/apple-touch-icon-152x152.png`,
    `/android-chrome-192x192.png`,
    `/android-chrome-512x512.png`,
  ];

  for (const path of paths) {
    const url = `https://${domain}${path}`;
    const response = await fetchWithTimeout(url, { method: "HEAD" });
    if (response?.ok) {
      const format = path.endsWith(".svg")
        ? "svg"
        : path.endsWith(".png")
          ? "png"
          : "ico";
      return { url, format };
    }
  }

  return null;
}

// Scrape HTML for favicon links - order-agnostic attribute matching
async function scrapeHtmlForFavicons(
  domain: string,
): Promise<FaviconResult | null> {
  const response = await fetchWithTimeout(`https://${domain}`, {
    headers: { "User-Agent": "SubTrack/1.0" },
  });
  if (!response?.ok) return null;

  const html = await response.text();

  // Find all <link> tags and check attributes independently
  const linkTagRegex = /<link\s+[^>]*\/?>/gi;
  let match: RegExpExecArray | null;

  while ((match = linkTagRegex.exec(html)) !== null) {
    const tag = match[0];

    // Extract rel and href independently (order-agnostic)
    const relMatch = tag.match(/rel\s*=\s*["']([^"']*)["']/i);
    const hrefMatch = tag.match(/href\s*=\s*["']([^"']*)["']/i);

    if (!relMatch || !hrefMatch) continue;

    const rel = relMatch[1].toLowerCase();

    // Check for icon/shortcut icon
    if (rel === "icon" || rel === "shortcut icon") {
      let href = hrefMatch[1];
      if (!href.startsWith("http")) {
        href = new URL(href, `https://${domain}`).toString();
      }
      return { url: href, format: "png" };
    }

    // Check for apple-touch-icon
    if (rel === "apple-touch-icon") {
      let href = hrefMatch[1];
      if (!href.startsWith("http")) {
        href = new URL(href, `https://${domain}`).toString();
      }
      return { url: href, format: "png" };
    }
  }

  return null;
}

// Check a single domain for favicon
async function checkDomain(domain: string): Promise<FaviconResult | null> {
  // Try common paths first
  const common = await tryCommonFaviconPaths(extractDomain(domain));
  if (common) return common;

  // Then try HTML scraping
  const scraped = await scrapeHtmlForFavicons(extractDomain(domain));
  if (scraped) return scraped;

  return null;
}

// Main favicon extraction function with bounded concurrency
export async function extractFavicon(
  brandName: string,
): Promise<FaviconResult | null> {
  const domains = generateLikelyDomains(brandName);

  // Process domains with bounded concurrency, short-circuit on first success
  let nextIndex = 0;
  let resolved = false;

  const tryNext = async (): Promise<FaviconResult | null> => {
    while (nextIndex < domains.length && !resolved) {
      const idx = nextIndex++;
      const result = await checkDomain(domains[idx]);
      if (result && !resolved) {
        resolved = true;
        return result;
      }
    }
    return null;
  };

  // Start MAX_CONCURRENT_DOMAINS workers
  const workers = Array.from({ length: MAX_CONCURRENT_DOMAINS }, () =>
    tryNext(),
  );
  const results = await Promise.all(workers);
  return results.find((r) => r !== null) ?? null;
}

// Download favicon as base64 - delegates to shared helper from iconScraper
export async function downloadFaviconAsBase64(
  faviconUrl: string,
  format: "svg" | "png" | "ico",
): Promise<string | null> {
  return downloadIconAsBase64(faviconUrl, format === "svg" ? "svg" : "png");
}

// Cache favicon to file system - delegates to shared helper from iconScraper
export async function cacheFavicon(
  iconKey: string,
  base64Data: string,
): Promise<string> {
  return cacheIconToFileSystem(iconKey, base64Data);
}
