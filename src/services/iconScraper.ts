import { Directory, File, Paths } from "expo-file-system";
import { writeAsStringAsync } from "expo-file-system/legacy";

interface ScrapedIcon {
  source: "simple-icons" | "tabler" | "devicons" | "boxicons" | "icons8";
  url: string;
  format: "svg" | "png";
}

/**
 * Convert brand name to slug for icon search.
 * FIXED: Handles edge cases like trailing dashes, multiple dashes,
 * empty strings, special characters, and common name normalization.
 */
export function nameToSlug(name: string): string {
  let slug = name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-") // spaces to dashes
    .replace(/[^a-z0-9-]/g, "") // remove non-alphanumeric except dash
    .replace(/-+/g, "-") // collapse multiple dashes
    .replace(/^-+|-+$/g, ""); // trim leading/trailing dashes

  // If slug is empty after sanitization, try fallback
  if (!slug) {
    slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  return slug;
}

/**
 * Generate alternative slugs for fuzzy matching.
 * Useful when the brand name has common variations.
 */
export function generateAlternativeSlugs(name: string): string[] {
  const base = nameToSlug(name);
  const alternatives: string[] = [base];

  // Remove common suffixes
  const noSuffix = base
    .replace(/-(app|io|tv|ai|hq|tech|pro|me)$/i, "")
    .replace(/-(com|net|org)$/i, "");
  if (noSuffix !== base) alternatives.push(noSuffix);

  // Remove trailing numbers (e.g. "web3" -> "web")
  const noTrailingNumber = base.replace(/-\d+$/, "");
  if (noTrailingNumber !== base) alternatives.push(noTrailingNumber);

  // Try without hyphens for compound names (e.g. "microsoft-teams" -> "microsoftteams")
  const noHyphen = base.replace(/-/g, "");
  if (noHyphen !== base) alternatives.push(noHyphen);

  // Add just the first part for compound names
  const firstPart = base.split("-")[0];
  if (firstPart && firstPart !== base) alternatives.push(firstPart);

  return [...new Set(alternatives)];
}

// Shared timeout-aware fetch helper
const FETCH_TIMEOUT_MS = 5000;

async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<Response> {
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
}

// Check if a URL is reachable
async function urlExists(url: string): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Try multiple slug variations against a URL template.
 * Returns the first matching ScrapedIcon, or null if none match.
 */
async function tryTemplateVariations(
  templateFn: (slug: string) => string,
  slugs: string[],
  source: ScrapedIcon["source"],
  format: "svg" | "png",
): Promise<ScrapedIcon | null> {
  for (const slug of slugs) {
    const url = templateFn(slug);
    if (await urlExists(url)) {
      return { source, url, format };
    }
  }
  return null;
}

// Try Simple Icons (most reliable for brand icons)
async function trySimpleIcons(
  slug: string,
  altSlugs: string[],
): Promise<ScrapedIcon | null> {
  const allSlugs = [slug, ...altSlugs];
  return tryTemplateVariations(
    (s) =>
      `https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/${s}.svg`,
    allSlugs,
    "simple-icons",
    "svg",
  );
}

// Try Tabler Icons
async function tryTabler(
  slug: string,
  altSlugs: string[],
): Promise<ScrapedIcon | null> {
  const allSlugs = [slug, ...altSlugs];
  return tryTemplateVariations(
    (s) =>
      `https://raw.githubusercontent.com/tabler/tabler-icons/refs/heads/main/icons/outline/${s}.svg`,
    allSlugs,
    "tabler",
    "svg",
  );
}

// Try Devicons (developer icons)
async function tryDevicons(
  slug: string,
  altSlugs: string[],
): Promise<ScrapedIcon | null> {
  const allSlugs = [slug, ...altSlugs, `${slug}-original`];

  for (const s of allSlugs) {
    // Try folder = s, filename = s
    const url = `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${s}/${s}.svg`;
    if (await urlExists(url)) {
      return { source: "devicons", url, format: "svg" };
    }
    // Try folder = s, filename = {s}-original
    const url2 = `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${s}/${s}-original.svg`;
    if (await urlExists(url2)) {
      return { source: "devicons", url: url2, format: "svg" };
    }
    // Try folder = s, filename = {s}-original-wordmark
    const url3 = `https://cdn.jsdelivr.net/gh/devicons/devicon/icons/${s}/${s}-original-wordmark.svg`;
    if (await urlExists(url3)) {
      return { source: "devicons", url: url3, format: "svg" };
    }
  }
  return null;
}

// Try Boxicons
async function tryBoxicons(
  slug: string,
  altSlugs: string[],
): Promise<ScrapedIcon | null> {
  const allSlugs = [slug, ...altSlugs];
  for (const s of allSlugs) {
    const url = `https://cdn.jsdelivr.net/gh/atisawd/boxicons@master/svg/logos/bxl-${s}.svg`;
    if (await urlExists(url)) {
      return { source: "boxicons", url, format: "svg" };
    }
    const url2 = `https://cdn.jsdelivr.net/gh/atisawd/boxicons@master/svg/regular/bx-${s}.svg`;
    if (await urlExists(url2)) {
      return { source: "boxicons", url: url2, format: "svg" };
    }
  }
  return null;
}

// Try Icons8 (line awesome alternative)
async function tryIcons8(
  slug: string,
  altSlugs: string[],
): Promise<ScrapedIcon | null> {
  const allSlugs = [slug, ...altSlugs];
  for (const s of allSlugs) {
    const url = `https://img.icons8.com/color/512/${s}.png`;
    if (await urlExists(url)) {
      return { source: "icons8", url, format: "png" };
    }
  }
  return null;
}

// Main function to find icon from libraries (returns first match)
export async function findIconFromLibraries(
  brandName: string,
): Promise<ScrapedIcon | null> {
  const slug = nameToSlug(brandName);
  const altSlugs = generateAlternativeSlugs(brandName).filter(
    (s) => s !== slug,
  );

  console.log(
    `[ICON_SCRAPER] findIconFromLibraries: "${brandName}" -> slug="${slug}", alternatives=[${altSlugs.join(", ")}]`,
  );

  const sources: ((
    slug: string,
    altSlugs: string[],
  ) => Promise<ScrapedIcon | null>)[] = [
    trySimpleIcons,
    tryTabler,
    tryDevicons,
    tryBoxicons,
    tryIcons8,
  ];

  for (const fetchSource of sources) {
    const result = await fetchSource(slug, altSlugs);
    if (result) {
      console.log(`[ICON_SCRAPER] Found icon: ${result.source} ${result.url}`);
      return result;
    }
  }

  console.log(`[ICON_SCRAPER] No library icon found for "${brandName}"`);
  return null;
}

// Find ALL icon sources for the icon picker (returns all found icons)
export async function findAllIconSources(
  brandName: string,
): Promise<ScrapedIcon[]> {
  const slug = nameToSlug(brandName);
  const altSlugs = generateAlternativeSlugs(brandName).filter(
    (s) => s !== slug,
  );
  const results: ScrapedIcon[] = [];

  console.log(
    `[ICON_SCRAPER] findAllIconSources: "${brandName}" -> slug="${slug}", alternatives=[${altSlugs.join(", ")}]`,
  );

  // Try each source in parallel and collect all successful results
  const sources: ((
    slug: string,
    altSlugs: string[],
  ) => Promise<ScrapedIcon | null>)[] = [
    trySimpleIcons,
    tryTabler,
    tryDevicons,
    tryBoxicons,
    tryIcons8,
  ];

  const outcomes = await Promise.all(
    sources.map((fetchSource) => fetchSource(slug, altSlugs)),
  );
  for (const result of outcomes) {
    if (result) {
      results.push(result);
      console.log(`[ICON_SCRAPER] Found icon: ${result.source} ${result.url}`);
    }
  }

  console.log(
    `[ICON_SCRAPER] findAllIconSources: Found ${results.length} icons for "${brandName}"`,
  );
  return results;
}

// Download icon and convert to base64
export async function downloadIconAsBase64(
  iconUrl: string,
  format: "svg" | "png",
): Promise<string | null> {
  try {
    const response = await fetchWithTimeout(iconUrl);
    if (!response.ok) return null;

    const arrayBuffer = await response.arrayBuffer();
    // Convert ArrayBuffer to base64
    const uint8Array = new Uint8Array(arrayBuffer);
    let binary = "";
    for (let i = 0; i < uint8Array.byteLength; i++) {
      binary += String.fromCharCode(uint8Array[i]);
    }
    const base64 = btoa(binary);

    return base64;
  } catch (error) {
    console.error("Failed to download icon:", error);
    return null;
  }
}

// Save icon to cache directory
export async function cacheIconToFileSystem(
  iconKey: string,
  base64Data: string,
): Promise<string> {
  const cacheDir = new Directory(Paths.cache, "icons");
  try {
    await cacheDir.create({ intermediates: true });
  } catch (error: any) {
    // Only ignore the expected "already exists" error
    if (!(
      error &&
      typeof error.message === "string" &&
      error.message.includes("EEXIST")
    )) {
      throw error;
    }
  }

  const cacheFile = new File(cacheDir, `${iconKey}.txt`);
  await writeAsStringAsync(cacheFile.uri, base64Data, {
    encoding: "base64",
  });

  return cacheFile.uri;
}
