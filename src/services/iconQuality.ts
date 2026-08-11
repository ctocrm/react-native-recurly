/**
 * Prefer larger / vector sources over tiny favicons when choosing what to
 * show on the card and what to fetch first. No training — app-only ranking.
 */

export type IconQualityInput = {
  source: string;
  format: string;
  originalUrl?: string | null;
  originalWidth?: number | null;
  originalHeight?: number | null;
  /** base64 length as weak size proxy when dimensions unknown */
  imageDataLength?: number;
};

/** Higher = better for display without AI upscale. */
export function scoreIconQuality(icon: IconQualityInput): number {
  let score = 0;
  const src = (icon.source || "").toLowerCase();
  const fmt = (icon.format || "").toLowerCase();
  const url = (icon.originalUrl || "").toLowerCase();

  // Format: vector beats raster; ico is usually tiny
  if (fmt === "svg" || url.endsWith(".svg") || url.includes(".svg?")) {
    score += 500;
  } else if (fmt === "png" || fmt === "webp") {
    score += 80;
  } else if (fmt === "jpg" || fmt === "jpeg") {
    score += 40;
  } else if (fmt === "ico") {
    score -= 40;
  }

  // Known high-quality libraries / brand SVGs
  if (
    src === "simple-icons" ||
    src === "devicons" ||
    src === "tabler" ||
    src === "boxicons" ||
    src === "icons8"
  ) {
    score += 400;
  }

  // Spider / HTML extract sources
  if (src.includes("apple") || url.includes("apple-touch")) score += 350;
  if (url.includes("android-chrome") || url.includes("192x192") || url.includes("512x512"))
    score += 320;
  if (src.includes("og_image") || src.includes("og-image")) score += 200;
  if (src.includes("twitter")) score += 150;
  if (src.includes("jsonld") || src.includes("logo")) score += 180;
  if (src === "official_favicon" || src === "favicon") score += 20;
  if (src.startsWith("spider:")) {
    // spider inherits inner source name after colon
    if (src.includes("apple")) score += 300;
    else if (src.includes("og")) score += 180;
    else if (src.includes("favicon")) score += 10;
    else score += 50;
  }

  // Pixel dimensions (original, pre any display upscale)
  const w = icon.originalWidth ?? 0;
  const h = icon.originalHeight ?? 0;
  const maxDim = Math.max(w, h);
  if (maxDim >= 512) score += 300;
  else if (maxDim >= 256) score += 250;
  else if (maxDim >= 180) score += 200;
  else if (maxDim >= 128) score += 150;
  else if (maxDim >= 64) score += 80;
  else if (maxDim > 0 && maxDim < 32) score -= 80;

  // Weak proxy if no dimensions
  if (!maxDim && icon.imageDataLength) {
    if (icon.imageDataLength > 80_000) score += 100;
    else if (icon.imageDataLength > 20_000) score += 50;
    else if (icon.imageDataLength < 2_000) score -= 30;
  }

  // User AI result always wins for card preference when present
  if (src === "ai_upscale") score += 10_000;
  if (src === "subscription") score += 5_000;

  return score;
}

export function pickBestIcon<T extends IconQualityInput>(icons: T[]): T | null {
  if (icons.length === 0) return null;
  return icons.reduce((best, cur) =>
    scoreIconQuality(cur) > scoreIconQuality(best) ? cur : best,
  );
}

/** Sort fetch queue: high quality first so immediate batch is not all tiny icos. */
export function sortUrlsByQuality<
  T extends { url: string; source: string; format: string },
>(urls: T[]): T[] {
  return [...urls].sort(
    (a, b) =>
      scoreIconQuality({
        source: b.source,
        format: b.format,
        originalUrl: b.url,
      }) -
      scoreIconQuality({
        source: a.source,
        format: a.format,
        originalUrl: a.url,
      }),
  );
}
