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
  /(?:og[-_]?image|twitter[-_]?image|opengraph|social[-_]?card|share[-_]?image|card[-_]?image|[-_]og\.(?:webp|png|jpe?g)|\/images\/news\/)/i;
const BRAND_LOGO_RE =
  /(?:^|[/?#_.=-])(logo|logomark|wordmark|brandmark|favicon|apple-touch|android-chrome|mask-icon)(?:$|[/?#_.=-])/i;

/** True when a URL looks like UI chrome (header SVGs, cart, hamburger), not a logo. */
export function isUiChromeImage(url: string, source = ""): boolean {
  const blob = `${source} ${url}`.toLowerCase();
  return (
    blob.includes("header-") ||
    blob.includes("hamburger") ||
    blob.includes("circle-user") ||
    blob.includes("shopping-cart") ||
    blob.includes("cart-") ||
    blob.includes("search-icon") ||
    blob.includes("menu-icon") ||
    blob.includes("nav-icon") ||
    /\/(?:icon-)?(?:user|cart|menu|search|close|chevron|arrow)[-_]/i.test(blob)
  );
}

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

/** Drop OG/Twitter/generic JSON-LD image unless a real logo signal is present.
 *  Also drop first-party news/share photos tagged official_site / img. */
export function isPublishableExtractedIcon(
  url: string,
  source: string,
): boolean {
  if (isUiChromeImage(url, source)) return false;
  if (hasLogoSignal(url, source)) return true;
  if (isSocialOrGenericImageSource(source)) return false;
  if (isGenericSocialImage(url, source)) return false;
  return true;
}

/** Partner/sponsor marks hosted on the official site (Scotts on Ace, etc.). */
const GENERIC_FILE_TOKENS = new Set([
  "logo",
  "icon",
  "favicon",
  "apple",
  "touch",
  "android",
  "chrome",
  "mask",
  "brand",
  "wordmark",
  "logomark",
  "brandmark",
  "precomposed",
  "default",
  "static",
  "images",
  "assets",
  "dark",
  "light",
  "white",
  "black",
  "color",
  "colour",
  "large",
  "small",
]);

function isPartnerOrUnrelatedMark(brand: string, url: string): boolean {
  const compact = brand.toLowerCase().replace(/[^a-z0-9]+/g, "");
  let path = "";
  try {
    path = new URL(url).pathname.toLowerCase();
  } catch {
    path = url.toLowerCase();
  }
  const file = (path.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, "");
  const tokens = file.split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
  return tokens.some((token) => {
    if (GENERIC_FILE_TOKENS.has(token)) return false;
    if (compact.includes(token) || token.includes(compact)) return false;
    return true;
  });
}

export function classifyTrustedCandidate(
  brand: string,
  officialHosts: Set<string>,
  url: string,
): { trusted: boolean; prov: Provenance; reason: string } {
  const classified = classifyCandidate(brand, officialHosts, url);
  if (
    isTrustedProvenance(classified.prov) &&
    isPartnerOrUnrelatedMark(brand, url)
  ) {
    return {
      trusted: false,
      prov: "untrusted",
      reason: "official host asset is a partner/unrelated mark",
    };
  }
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
