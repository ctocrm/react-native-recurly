import { Directory, File, Paths } from "expo-file-system";
import { writeAsStringAsync } from "expo-file-system/legacy";

// Icon sources in priority order
type IconSource = "simple-icons" | "lucide" | "tabler";

interface ScrapedIcon {
  source: IconSource;
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

// Check if a URL is reachable
async function urlExists(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "HEAD" });
    return response.ok;
  } catch {
    return false;
  }
}

// Try Simple Icons (most reliable for brand icons)
async function trySimpleIcons(slug: string): Promise<ScrapedIcon | null> {
  const url = `https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/_data/${slug}.svg`;
  if (await urlExists(url)) {
    return { source: "simple-icons", url, format: "svg" };
  }
  return null;
}

// Try Lucide Icons
async function tryLucide(slug: string): Promise<ScrapedIcon | null> {
  // Lucide provides SVG via their raw endpoint
  const url = `https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/${slug}.svg`;
  if (await urlExists(url)) {
    return { source: "lucide", url, format: "svg" };
  }
  return null;
}

// Try Tabler Icons
async function tryTabler(slug: string): Promise<ScrapedIcon | null> {
  const url = `https://raw.githubusercontent.com/tabler/tabler-icons/master/icons/${slug}.svg`;
  if (await urlExists(url)) {
    return { source: "tabler", url, format: "svg" };
  }
  return null;
}

// Main function to find icon from libraries
export async function findIconFromLibraries(
  brandName: string,
): Promise<ScrapedIcon | null> {
  const slug = nameToSlug(brandName);

  // Try each source in order
  const sources: ((slug: string) => Promise<ScrapedIcon | null>)[] = [
    trySimpleIcons,
    tryLucide,
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

// Download icon and convert to base64
export async function downloadIconAsBase64(
  iconUrl: string,
  format: "svg" | "png",
): Promise<string | null> {
  try {
    const response = await fetch(iconUrl);
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
  } catch {
    // Directory already exists
  }

  const cacheFile = new File(cacheDir, `${iconKey}.txt`);
  await writeAsStringAsync(cacheFile.uri, base64Data, {
    encoding: "base64",
  });

  return cacheFile.uri;
}
