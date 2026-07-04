import { Directory, File, Paths } from "expo-file-system";
import { writeAsStringAsync } from "expo-file-system/legacy";

interface ScrapedIcon {
  source: "simple-icons" | "tabler";
  url: string;
  format: "svg" | "png";
}

// Convert brand name to slug for icon search
export function nameToSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-");
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

// Try Simple Icons (most reliable for brand icons)
async function trySimpleIcons(slug: string): Promise<ScrapedIcon | null> {
  const url = `https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/${slug}.svg`;
  if (await urlExists(url)) {
    return { source: "simple-icons", url, format: "svg" };
  }
  return null;
}

// Try Tabler Icons
async function tryTabler(slug: string): Promise<ScrapedIcon | null> {
  const url = `https://raw.githubusercontent.com/tabler/tabler-icons/refs/heads/main/icons/outline/${slug}.svg`;
  if (await urlExists(url)) {
    return { source: "tabler", url, format: "svg" };
  }
  return null;
}

// Main function to find icon from libraries (returns first match)
export async function findIconFromLibraries(
  brandName: string,
): Promise<ScrapedIcon | null> {
  const slug = nameToSlug(brandName);

  // Try each source in order - skip Lucide for brand icons (it doesn't host brand logos)
  const sources: ((slug: string) => Promise<ScrapedIcon | null>)[] = [
    trySimpleIcons,
    tryTabler,
  ];

  for (const fetchSource of sources) {
    const result = await fetchSource(slug);
    if (result) {
      return result;
    }
  }

  return null;
}

// Find ALL icon sources for the icon picker (returns all found icons)
export async function findAllIconSources(
  brandName: string,
): Promise<ScrapedIcon[]> {
  const slug = nameToSlug(brandName);
  const results: ScrapedIcon[] = [];

  // Try each source and collect all successful results
  const sources: ((slug: string) => Promise<ScrapedIcon | null>)[] = [
    trySimpleIcons,
    tryTabler,
  ];

  for (const fetchSource of sources) {
    const result = await fetchSource(slug);
    if (result) {
      results.push(result);
    }
  }

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
