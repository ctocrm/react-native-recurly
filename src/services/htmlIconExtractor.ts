/**
 * Follow-links spider: takes a URL from search results, fetches the page,
 * and extracts all icon-related tags (favicons, og:image, twitter:image,
 * JSON-LD logos, Apple touch icons).
 */

interface ExtractedIcon {
  url: string;
  format: "svg" | "png" | "ico" | "jpg" | "jpeg" | "webp";
  source: string; // e.g. "favicon", "og_image", "twitter_image", "jsonld"
  width?: number;
  height?: number;
}

const FETCH_TIMEOUT_MS = 6000;

async function fetchPage(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    clearTimeout(timer);
    if (!response.ok) return null;
    const text = await response.text();
    return text;
  } catch {
    return null;
  }
}

function detectImageFormat(url: string): ExtractedIcon["format"] {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  if (clean.endsWith(".svg")) return "svg";
  if (clean.endsWith(".ico")) return "ico";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpeg";
  if (clean.endsWith(".webp")) return "webp";
  return "png";
}

function resolveUrl(href: string, baseUrl: string): string {
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  try {
    const base = new URL(baseUrl);
    return new URL(href, base.origin).href;
  } catch {
    return href;
  }
}

/**
 * Extract all icon-related URLs from a page's HTML.
 */
function extractIconsFromHtml(html: string, pageUrl: string): ExtractedIcon[] {
  const icons: ExtractedIcon[] = [];
  const seen = new Set<string>();

  // 1. Favicon link tags (<link rel="icon" href="...">, <link rel="shortcut icon">)
  const faviconRegex =
    /<link[^>]+rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = faviconRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "favicon",
      });
    }
  }

  // Also handle reversed attribute order
  const faviconRevRegex =
    /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["'](?:shortcut\s+)?icon["'][^>]*>/gi;
  while ((match = faviconRevRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "favicon",
      });
    }
  }

  // 2. Apple touch icons
  const appleRegex =
    /<link[^>]+rel\s*=\s*["']apple-touch-icon["'][^>]+href\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = appleRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "apple_touch_icon",
      });
    }
  }

  const appleRevRegex =
    /<link[^>]+href\s*=\s*["']([^"']+)["'][^>]+rel\s*=\s*["']apple-touch-icon["'][^>]*>/gi;
  while ((match = appleRevRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "apple_touch_icon",
      });
    }
  }

  // 3. Open Graph image (<meta property="og:image" content="...">)
  const ogRegex =
    /<meta[^>]+(?:property|name)\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = ogRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "og_image",
      });
    }
  }

  const ogRevRegex =
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:property|name)\s*=\s*["']og:image["'][^>]*>/gi;
  while ((match = ogRevRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "og_image",
      });
    }
  }

  // 4. Twitter card image (<meta name="twitter:image" content="...">)
  const twitterRegex =
    /<meta[^>]+(?:name|property)\s*=\s*["']twitter:image["'][^>]+content\s*=\s*["']([^"']+)["'][^>]*>/gi;
  while ((match = twitterRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "twitter_image",
      });
    }
  }

  const twitterRevRegex =
    /<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]+(?:name|property)\s*=\s*["']twitter:image["'][^>]*>/gi;
  while ((match = twitterRevRegex.exec(html)) !== null) {
    const rawUrl = resolveUrl(match[1], pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "twitter_image",
      });
    }
  }

  // 5. JSON-LD structured data with logo URLs
  const jsonldRegex =
    /<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = jsonldRegex.exec(html)) !== null) {
    try {
      const json = JSON.parse(match[1].trim());
      // Handle @graph arrays
      const items = Array.isArray(json["@graph"]) ? json["@graph"] : [json];
      for (const item of items) {
        // Look for logo in Organization schema
        if (item.logo) {
          if (typeof item.logo === "string") {
            const rawUrl = resolveUrl(item.logo, pageUrl);
            if (!seen.has(rawUrl)) {
              seen.add(rawUrl);
              icons.push({
                url: rawUrl,
                format: detectImageFormat(rawUrl),
                source: "jsonld_logo",
              });
            }
          } else if (item.logo.url) {
            const rawUrl = resolveUrl(item.logo.url, pageUrl);
            if (!seen.has(rawUrl)) {
              seen.add(rawUrl);
              icons.push({
                url: rawUrl,
                format: detectImageFormat(rawUrl),
                source: "jsonld_logo",
              });
            }
          }
        }
        // Look for image
        if (item.image) {
          if (typeof item.image === "string") {
            const rawUrl = resolveUrl(item.image, pageUrl);
            if (!seen.has(rawUrl)) {
              seen.add(rawUrl);
              icons.push({
                url: rawUrl,
                format: detectImageFormat(rawUrl),
                source: "jsonld_image",
              });
            }
          } else if (item.image.url) {
            const rawUrl = resolveUrl(item.image.url, pageUrl);
            if (!seen.has(rawUrl)) {
              seen.add(rawUrl);
              icons.push({
                url: rawUrl,
                format: detectImageFormat(rawUrl),
                source: "jsonld_image",
              });
            }
          }
        }
      }
    } catch {
      // Invalid JSON-LD, skip
    }
  }

  // 6. Common favicon paths in <head>
  const commonPaths = [
    "/favicon.ico",
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/apple-touch-icon-152x152.png",
    "/android-chrome-192x192.png",
    "/android-chrome-512x512.png",
  ];

  try {
    const base = new URL(pageUrl);
    for (const path of commonPaths) {
      const rawUrl = `${base.origin}${path}`;
      if (!seen.has(rawUrl)) {
        seen.add(rawUrl);
        icons.push({
          url: rawUrl,
          format: detectImageFormat(rawUrl),
          source: "common_path",
        });
      }
    }
  } catch {
    // Invalid page URL
  }

  return icons;
}

/**
 * Process a list of URLs from search results - fetch each page and extract icons.
 * Limits concurrency to avoid overwhelming the network.
 */
export async function extractIconsFromUrls(
  urls: string[],
  brand: string,
): Promise<ExtractedIcon[]> {
  const allIcons: ExtractedIcon[] = [];
  const seenUrls = new Set<string>();

  // Take top 10 URLs to crawl (most relevant ones)
  const crawlUrls = urls.slice(0, 10);

  // Process with concurrency limit of 3
  const CONCURRENCY = 3;
  for (let i = 0; i < crawlUrls.length; i += CONCURRENCY) {
    const batch = crawlUrls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (pageUrl) => {
        const html = await fetchPage(pageUrl);
        if (!html) return [];
        return extractIconsFromHtml(html, pageUrl);
      }),
    );

    for (const icons of batchResults) {
      for (const icon of icons) {
        if (!seenUrls.has(icon.url)) {
          seenUrls.add(icon.url);
          allIcons.push(icon);
        }
      }
    }
  }

  return allIcons;
}
