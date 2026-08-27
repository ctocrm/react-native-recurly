/**
 * Prefer first-party / library provenance, then larger / vector sources.
 * Visual quality never outranks an untrusted or social-share image.
 */

import {
  classifyCandidate,
  officialHostsForBrand,
  type Provenance,
} from "@/services/domain/provenance";
import {
  isFirstPartyIconSource,
  isGenericSocialImage,
  provenanceRank,
} from "@/services/iconCandidate";

export type IconQualityInput = {
  source: string;
  format: string;
  originalUrl?: string | null;
  originalWidth?: number | null;
  originalHeight?: number | null;
  /** base64 length as weak size proxy when dimensions unknown */
  imageDataLength?: number;
  /** Optional crawl brand so provenance can be ranked first. */
  brand?: string;
  officialHost?: string | null;
};

function provenanceFor(icon: IconQualityInput): Provenance {
  const url = icon.originalUrl || "";
  const src = icon.source || "";
  if (isFirstPartyIconSource(src)) {
    if (!url) return "official";
    const hosts = officialHostsForBrand(icon.brand || "", icon.officialHost);
    const classified = classifyCandidate(icon.brand || "", hosts, url);
    // Homepage/PWA extracts on a brand CDN are still first-party, not Bing junk.
    return classified.prov === "untrusted" ? "official" : classified.prov;
  }
  if (!url) {
    const lower = src.toLowerCase();
    if (
      lower === "simple-icons" ||
      lower === "devicons" ||
      lower === "tabler" ||
      lower === "boxicons" ||
      lower === "icons8"
    ) {
      return "library";
    }
    if (lower.startsWith("official") || lower.includes("apple")) return "official";
    if (lower === "subscription" || lower === "ai_upscale") return "official";
    return "untrusted";
  }
  const hosts = officialHostsForBrand(icon.brand || "", icon.officialHost);
  return classifyCandidate(icon.brand || "", hosts, url).prov;
}

/** Higher = better for display without AI upscale. */
export function scoreIconQuality(icon: IconQualityInput): number {
  let score = 0;
  const src = (icon.source || "").toLowerCase();
  const fmt = (icon.format || "").toLowerCase();
  const url = (icon.originalUrl || "").toLowerCase();

  // Provenance first: official/library/brand-token beat visual quality.
  score += provenanceRank(provenanceFor(icon)) * 2000;

  // Social/share photos are not logos even on a first-party host.
  if (isGenericSocialImage(url, src) && !src.includes("logo")) {
    score -= 800;
  }

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
  if (src.includes("jsonld_logo") || (src.includes("logo") && !src.includes("jsonld_image"))) {
    score += 180;
  }
  if (src === "official_favicon" || src === "favicon") score += 20;
  if (src.startsWith("spider:")) {
    if (src.includes("apple")) score += 300;
    else if (src.includes("jsonld_logo") || src.includes("logo")) score += 160;
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
>(urls: T[], brand?: string, officialHost?: string | null): T[] {
  return [...urls].sort(
    (a, b) =>
      scoreIconQuality({
        source: b.source,
        format: b.format,
        originalUrl: b.url,
        brand,
        officialHost,
      }) -
      scoreIconQuality({
        source: a.source,
        format: a.format,
        originalUrl: a.url,
        brand,
        officialHost,
      }),
  );
}
