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
  if (blob.startsWith("email_")) return true;
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

export function isPartnerOrUnrelatedMark(brand: string, url: string): boolean {
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
    if (/^\d+$/.test(token) || /^\d+x\d+$/i.test(token)) return false;
    if (compact.includes(token) || token.includes(compact)) return false;
    // Distinct alphabetic brand token that is not this subscription.
    if (!/[a-z]{4,}/.test(token)) return false;
    return true;
  });
}

/** Homepage / PWA / apple-touch extracts — first-party even on a CDN host. */
export function isFirstPartyIconSource(source: string): boolean {
  const src = source.toLowerCase();
  if (src.startsWith("official")) return true;
  // Phase C: seeds extracted from the brand's own email are brand-sent.
  if (src.startsWith("email_")) return true;
  if (!src.startsWith("spider:")) return false;
  return /web_manifest|apple|favicon|img_logo|jsonld_logo|pwa|mask/.test(src);
}

/**
 * G1 (2026-09-10, data-driven from the G0 baseline): stock-PNG-farm hosts that
 * ship scraped/ripped "brand logo" packs. Every host below was observed
 * fetching junk for real brands in the G0 window (docs/plan.md 2026-09-10 row:
 * pngmart/logodownload/logos-world/pngimg/pngall/freeiconspng/latestlogo all
 * downloaded brand-named files that failed inspection). R4's wallpaper/wiki
 * list lives in the crawler; these farm hosts are the G0 extension so both
 * admission paths can share one list.
 */
const JUNK_FARM_HOST_RE =
  /(^|\.)(pngmart|logodownload|logos-world|pngimg|pngall|freeiconspng|latestlogo|creazilla|freebiesupply|pluspng|kindpng|pngegg|seekpng|favpng|toppng|clipartmax|pngwing|cleanpng|stickpng|pngkey|freepik|vhv)\./i;

/** True when the URL's host is a known non-brand icon/PNG farm. */
export function isJunkIconFarmHost(url: string): boolean {
  try {
    return JUNK_FARM_HOST_RE.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * G1: brand-token provenance on an unknown host is only credible when the URL
 * itself looks like a logo asset. `media.reclaimthenet.org/2023/11/tuta.jpg`
 * matched the brand token but is a news photo — G0 saw it auto-assigned.
 */
export function hasDiscoveryUrlSignal(url: string): boolean {
  return LOGO_TOKEN_RE.test(url.toLowerCase());
}

/**
 * G1: per-host admission cap. G0 watched blackcircles.ca consume 90 fetches
 * for one brand. Official/library hosts are exempt (a brand's own site may
 * legitimately serve several asset variants). Pure: caller owns the counts map.
 */
export const DISCOVERY_PER_HOST_CAP = 3;

export function admitsWithHostCap(
  url: string,
  officialHosts: Set<string>,
  counts: Map<string, number>,
  cap: number = DISCOVERY_PER_HOST_CAP,
): boolean {
  let host: string | null = null;
  try {
    host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return false;
  }
  if (officialHosts.has(host)) return true;
  const seen = counts.get(host) ?? 0;
  if (seen >= cap) return false;
  counts.set(host, seen + 1);
  return true;
}

/**
 * G1: source-string rank for the drain's pre-fetch skip. A queued candidate
 * whose source cannot outrank the currently cached icon's source is never
 * fetched — G0 measured 22+ wasted "Skip downgrade (bing_images not better
 * than bing_images)" cycles that each paid a full download to learn this.
 * Ordering mirrors scoreIconQuality's provenance-first weighting.
 */
export function discoverySourceRank(source: string | null | undefined): number {
  const src = (source || "").toLowerCase();
  if (!src) return 0;
  if (src.startsWith("official") || src === "subscription" || src === "ai_upscale")
    return 6;
  // Phase C: brand-sent mail assets. The brand itself sent the image, so they
  // outrank all web discovery (bing_images/web_search = 1) but never beat a
  // cached official-site extract (6) — the site is the canonical mark source.
  if (src.startsWith("email_")) return 5;
  if (src === "favicon" || src === "official_favicon") return 5;
  if (
    src === "icons8" ||
    src === "simple-icons" ||
    src === "devicons" ||
    src === "tabler" ||
    src === "boxicons"
  )
    return 5;
  if (
    src.startsWith("spider:") &&
    /web_manifest|apple|jsonld_logo|img_logo|pwa|mask/.test(src)
  )
    return 4;
  if (src === "spider:favicon") return 3;
  if (src.startsWith("spider:")) return 1;
  // Generic web discovery (bing_images, web_search, ddg, google_images, …)
  return 1;
}

export function canCandidateBeatCached(
  candidateSource: string,
  cachedSource: string | null | undefined,
): boolean {
  return (
    discoverySourceRank(candidateSource) > discoverySourceRank(cachedSource)
  );
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

/** Picker/card: first-party extracts stay; Bing/random stay out; partner marks stay out. */
export function isPickerPublishableCandidate(
  brand: string,
  officialHosts: Set<string>,
  url: string,
  source = "",
): boolean {
  if (isUiChromeImage(url, source)) return false;
  if (url && isPartnerOrUnrelatedMark(brand, url)) return false;
  if (isFirstPartyIconSource(source)) return true;
  if (!url) return false;
  return classifyTrustedCandidate(brand, officialHosts, url).trusted;
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
