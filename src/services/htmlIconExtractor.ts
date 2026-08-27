/**
 * Follow-links spider: takes a URL from search results, fetches the page,
 * and extracts all icon-related tags (favicons, og:image, twitter:image,
 * JSON-LD logos, Apple touch icons).
 */

import { isPublishableExtractedIcon, isUiChromeImage } from "@/services/iconCandidate";

interface ExtractedIcon {
  url: string;
  format: "svg" | "png" | "ico" | "jpg" | "jpeg" | "webp";
  source: string; // e.g. "favicon", "og_image", "twitter_image", "jsonld"
  width?: number;
  height?: number;
}

const FETCH_TIMEOUT_MS = 6000;

async function fetchPage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
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
    if (!response.ok) return null;
    const text = await response.text();
    return text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function shouldKeepExtracted(url: string, source: string): boolean {
  return isPublishableExtractedIcon(url, source);
}

function detectImageFormat(url: string): ExtractedIcon["format"] {
  const clean = url.toLowerCase().split("?")[0].split("#")[0];
  if (clean.endsWith(".svg")) return "svg";
  if (clean.endsWith(".ico")) return "ico";
  if (clean.endsWith(".jpg") || clean.endsWith(".jpeg")) return "jpeg";
  if (clean.endsWith(".webp")) return "webp";
  return "png";
}

// Decode common HTML entities that appear in attribute values (e.g. og:image
// URLs often carry & in their query string, which must become & or the
// fetch returns HTTP 400). Entity strings are built via concatenation so the
// source formatter doesn't collapse them into their literal characters.
const AMP = "&" + "amp;";
const LT = "&" + "lt;";
const GT = "&" + "gt;";
const QUOT = "&" + "quot;";
const APOS = "&" + "apos;";

function decodeHtmlEntities(s: string): string {
  return s
    .split(AMP)
    .join("&")
    .split(LT)
    .join("<")
    .split(GT)
    .join(">")
    .split(QUOT)
    .join('"')
    .split(APOS)
    .join("'")
    .replace(/&#0*39;/gi, "'")
    .replace(/&#0*34;/gi, '"');
}

function resolveUrl(href: string, baseUrl: string): string {
  const decoded = decodeHtmlEntities(href);
  if (decoded.startsWith("http://") || decoded.startsWith("https://"))
    return decoded;
  try {
    // Use the full page URL as the base so document-relative paths resolve correctly
    return new URL(decoded, baseUrl).href;
  } catch {
    return decoded;
  }
}

function extractManifestUrls(html: string, pageUrl: string): string[] {
  const manifests = new Set<string>();
  const linkTags = html.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of linkTags) {
    const rel = tag.match(/\brel\s*=\s*["']([^"']+)["']/i)?.[1] ?? "";
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (!href || !/(^|\s)manifest(\s|$)/i.test(rel)) continue;
    manifests.add(resolveUrl(href, pageUrl));
  }
  return [...manifests];
}

async function extractIconsFromManifest(
  manifestUrl: string,
): Promise<ExtractedIcon[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(manifestUrl, {
      signal: controller.signal,
      headers: { Accept: "application/manifest+json, application/json, */*" },
    });
    if (!response.ok) return [];
    const manifest = (await response.json()) as {
      icons?: { src?: string; sizes?: string; type?: string }[];
    };
    const icons: ExtractedIcon[] = [];
    for (const icon of manifest.icons ?? []) {
      if (!icon.src) continue;
      const url = resolveUrl(icon.src, manifestUrl);
      const size = icon.sizes
        ?.match(/(\d+)x(\d+)/)
        ?.slice(1)
        .map(Number);
      icons.push({
        url,
        format: detectImageFormat(
          icon.type?.includes("svg") ? `${url}.svg` : url,
        ),
        source: "web_manifest",
        width: size?.[0],
        height: size?.[1],
      });
    }
    return icons;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extract all icon-related URLs from a page's HTML.
 */
export function extractIconsFromHtml(html: string, pageUrl: string): ExtractedIcon[] {
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
    if (!seen.has(rawUrl) && shouldKeepExtracted(rawUrl, "og_image")) {
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
    if (!seen.has(rawUrl) && shouldKeepExtracted(rawUrl, "og_image")) {
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
    if (!seen.has(rawUrl) && shouldKeepExtracted(rawUrl, "twitter_image")) {
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
    if (!seen.has(rawUrl) && shouldKeepExtracted(rawUrl, "twitter_image")) {
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
      const parsed = JSON.parse(match[1].trim());
      // Handle both root arrays and objects
      const items: any[] = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed["@graph"])
          ? parsed["@graph"]
          : [parsed];
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
            if (!seen.has(rawUrl) && shouldKeepExtracted(rawUrl, "jsonld_image")) {
              seen.add(rawUrl);
              icons.push({
                url: rawUrl,
                format: detectImageFormat(rawUrl),
                source: "jsonld_image",
              });
            }
          } else if (item.image.url) {
            const rawUrl = resolveUrl(item.image.url, pageUrl);
            if (!seen.has(rawUrl) && shouldKeepExtracted(rawUrl, "jsonld_image")) {
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

  // 6. Logo-like <img> tags (homepage brand marks often only appear here)
  const imgTagRegex =
    /<img\b[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let imgCount = 0;
  const MAX_LOGO_IMGS = 12;
  while (
    (match = imgTagRegex.exec(html)) !== null &&
    imgCount < MAX_LOGO_IMGS
  ) {
    const tag = match[0].toLowerCase();
    const href = match[1];
    const blob = `${tag} ${href}`.toLowerCase();
    // Require a real logo/brand mark — not header chrome matching class="icon"
    const looksLogo =
      blob.includes("logo") ||
      blob.includes("brand") ||
      blob.includes("apple-touch") ||
      /\/(?:logo|brand|favicon)[^/]*\.(?:svg|png|webp|ico)/i.test(href);
    if (!looksLogo) continue;
    if (isUiChromeImage(href, tag)) continue;
    // Skip obvious non-icons
    if (
      blob.includes("avatar") ||
      blob.includes("hero") ||
      blob.includes("banner") ||
      blob.includes("sprite") ||
      blob.includes("tracking") ||
      blob.includes("1x1")
    ) {
      continue;
    }
    const rawUrl = resolveUrl(href, pageUrl);
    if (!seen.has(rawUrl)) {
      seen.add(rawUrl);
      icons.push({
        url: rawUrl,
        format: detectImageFormat(rawUrl),
        source: "img_logo",
      });
      imgCount++;
    }
  }

  // 7. Common paths — large / vector first (order also helps consumers that take head)
  const commonPaths = [
    "/favicon.svg",
    "/apple-touch-icon.png",
    "/apple-touch-icon-precomposed.png",
    "/apple-touch-icon-180x180.png",
    "/apple-touch-icon-152x152.png",
    "/android-chrome-512x512.png",
    "/android-chrome-192x192.png",
    "/favicon.ico",
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

  // Prefer SVG / apple-touch / large assets over classic favicon.ico
  icons.sort((a, b) => {
    const rank = (x: ExtractedIcon) => {
      let s = 0;
      const u = x.url.toLowerCase();
      if (x.format === "svg") s += 50;
      if (x.source.includes("apple") || u.includes("apple-touch")) s += 40;
      if (u.includes("android-chrome") || u.includes("512x512")) s += 35;
      if (x.source.includes("og")) s += 25;
      if (x.source.includes("twitter")) s += 15;
      if (x.source === "favicon" && x.format === "ico") s -= 10;
      if ((x.width ?? 0) >= 180 || (x.height ?? 0) >= 180) s += 30;
      return s;
    };
    return rank(b) - rank(a);
  });
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

  // Crawl more pages when the caller already capped the list
  const crawlUrls = urls.slice(0, Math.min(urls.length, 40));

  // Process with concurrency limit of 3
  const CONCURRENCY = 3;
  for (let i = 0; i < crawlUrls.length; i += CONCURRENCY) {
    const batch = crawlUrls.slice(i, i + CONCURRENCY);
    const batchResults = await Promise.all(
      batch.map(async (pageUrl) => {
        const html = await fetchPage(pageUrl);
        if (!html) return [];
        const pageIcons = extractIconsFromHtml(html, pageUrl);
        const manifests = extractManifestUrls(html, pageUrl);
        const manifestIcons = (
          await Promise.all(manifests.slice(0, 3).map(extractIconsFromManifest))
        ).flat();
        return [...pageIcons, ...manifestIcons];
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

  // Prefer larger / vector icons across spidered pages
  allIcons.sort((a, b) => {
    const rank = (x: ExtractedIcon) => {
      let s = 0;
      const u = x.url.toLowerCase();
      if (x.format === "svg") s += 50;
      if (u.includes("apple-touch")) s += 40;
      if (u.includes("512x512") || u.includes("android-chrome")) s += 35;
      if (x.source.includes("og")) s += 25;
      if (x.format === "ico") s -= 10;
      return s;
    };
    return rank(b) - rank(a);
  });
  return allIcons;
}
