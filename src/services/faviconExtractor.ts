import { Directory, File, Paths } from "expo-file-system";
import { writeAsStringAsync } from "expo-file-system/legacy";

interface FaviconResult {
  url: string;
  format: "svg" | "png" | "ico";
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
    try {
      const response = await fetch(url, { method: "HEAD" });
      if (response.ok) {
        const format = path.endsWith(".svg")
          ? "svg"
          : path.endsWith(".png")
            ? "png"
            : "ico";
        return { url, format };
      }
    } catch {
      // Continue to next path
    }
  }

  return null;
}

// Scrape HTML for favicon links
async function scrapeHtmlForFavicons(
  domain: string,
): Promise<FaviconResult | null> {
  try {
    const response = await fetch(`https://${domain}`, {
      headers: { "User-Agent": "SubTrack/1.0" },
    });

    if (!response.ok) return null;

    const html = await response.text();

    // Find <link rel="icon" or <link rel="shortcut icon">
    const iconMatch = html.match(
      /<link[^>]+rel=["'](?:icon|shortcut icon)["'][^>]+href=["']([^"']+)["']/i,
    );

    if (iconMatch && iconMatch[1]) {
      let href = iconMatch[1];
      // Resolve relative URLs
      if (!href.startsWith("http")) {
        href = new URL(href, `https://${domain}`).toString();
      }
      return { url: href, format: "png" };
    }

    // Find apple-touch-icon
    const appleMatch = html.match(
      /<link[^>]+rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)["']/i,
    );

    if (appleMatch && appleMatch[1]) {
      let href = appleMatch[1];
      if (!href.startsWith("http")) {
        href = new URL(href, `https://${domain}`).toString();
      }
      return { url: href, format: "png" };
    }

    return null;
  } catch {
    return null;
  }
}

// Main favicon extraction function
export async function extractFavicon(
  brandName: string,
): Promise<FaviconResult | null> {
  const domains = generateLikelyDomains(brandName);

  for (const domain of domains) {
    // Try common paths first
    const common = await tryCommonFaviconPaths(extractDomain(domain));
    if (common) return common;

    // Then try HTML scraping
    const scraped = await scrapeHtmlForFavicons(extractDomain(domain));
    if (scraped) return scraped;
  }

  return null;
}

// Download favicon as base64
export async function downloadFaviconAsBase64(
  faviconUrl: string,
  format: "svg" | "png" | "ico",
): Promise<string | null> {
  try {
    const response = await fetch(faviconUrl);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
  } catch (error) {
    console.error("Failed to download favicon:", error);
    return null;
  }
}

// Cache favicon to file system
export async function cacheFavicon(
  iconKey: string,
  base64Data: string,
): Promise<string> {
  const cacheDir = new Directory(Paths.cache, "icons");
  try {
    await cacheDir.create({ intermediates: true });
  } catch {
    // Directory already exists
  }

  const cacheFile = new File(cacheDir, `${iconKey}.txt`);
  await writeAsStringAsync(cacheFile.uri, base64Data, {
    encoding: "base64",
  });

  return cacheFile.uri;
}
