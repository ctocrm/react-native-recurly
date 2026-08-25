/**
 * Shared candidate gates for crawl discovery (Hop 3).
 * Pure and unit-testable: provenance + logo-signal, not image quality.
 */

import {
  classifyCandidate,
  isTrustedProvenance,
  type Provenance,
} from "@/services/domain/provenance";

const IMAGE_EXT_RE = /\.(svg|png|jpg|jpeg|ico|webp|gif)(\?|#|$)/i;
const LOGO_TOKEN_RE =
  /(?:^|[/?#_.=-])(logo|icon|favicon|brand|apple-touch|android-chrome|mask-icon)(?:$|[/?#_.=-])/i;
const GENERIC_SOCIAL_RE =
  /(?:og[-_]?image|twitter[-_]?image|opengraph|social[-_]?card|share[-_]?image|card[-_]?image)/i;
const BRAND_LOGO_RE =
  /(?:^|[/?#_.=-])(logo|logomark|wordmark|brandmark|favicon|apple-touch|android-chrome|mask-icon)(?:$|[/?#_.=-])/i;

export function looksLikeDirectImage(url: string): boolean {
  const lower = url.toLowerCase();
  if (IMAGE_EXT_RE.test(lower)) return true;
  if (LOGO_TOKEN_RE.test(lower)) return true;
  return false;
}

/** True when URL/source looks like a social/share photo, not a logo. */
export function isGenericSocialImage(url: string, source = ""): boolean {
  const blob = `${source} ${url}`.toLowerCase();
  if (BRAND_LOGO_RE.test(blob)) return false;
  return GENERIC_SOCIAL_RE.test(blob);
}

/** OG / Twitter / generic JSON-LD image need an explicit logo signal. */
export function hasLogoSignal(url: string, source = ""): boolean {
  const blob = `${source} ${url}`.toLowerCase();
  if (BRAND_LOGO_RE.test(blob)) return true;
  if (blob.includes("jsonld_logo")) return true;
  if (blob.includes("apple_touch") || blob.includes("apple-touch")) return true;
  if (blob.includes("android-chrome") || blob.includes("mask-icon")) return true;
  if (
    /(?:^|:)(favicon|img_logo|official_favicon|official_apple|official_pwa)/.test(
      blob,
    )
  ) {
    return true;
  }
  return false;
}

export function isSocialOrGenericImageSource(source: string): boolean {
  const src = source.toLowerCase();
  return (
    src.includes("og_image") ||
    src.includes("og-image") ||
    src.includes("twitter_image") ||
    src.includes("twitter-image") ||
    src.includes("jsonld_image")
  );
}

/** Drop OG/Twitter/generic JSON-LD image unless a real logo signal is present. */
export function isPublishableExtractedIcon(
  url: string,
  source: string,
): boolean {
  if (!isSocialOrGenericImageSource(source)) return true;
  return hasLogoSignal(url, source);
}

export function classifyTrustedCandidate(
  brand: string,
  officialHosts: Set<string>,
  url: string,
): { trusted: boolean; prov: Provenance; reason: string } {
  const classified = classifyCandidate(brand, officialHosts, url);
  return {
    trusted: isTrustedProvenance(classified.prov),
    prov: classified.prov,
    reason: classified.reason,
  };
}

/** Provenance rank used before visual quality when choosing / fetching. */
export function provenanceRank(prov: Provenance | string): number {
  switch (prov) {
    case "official":
      return 3;
    case "library":
      return 2;
    case "brand-token":
      return 1;
    default:
      return 0;
  }
}
