/**
 * Provenance classification for icon candidates (Tranche C/D).
 *
 * The picker was polluted with unrelated pictures because arbitrary-domain
 * image URLs (any `.webp/.png/...`) and arbitrary spidered pages were accepted.
 * This module answers one question: does this candidate's origin give evidence
 * it belongs to the brand? Pure and unit-testable.
 */
import { normalizeBrand } from "./domainDiscovery";

export type Provenance = "official" | "brand-token" | "library" | "untrusted";

export interface ProvenanceResult {
  prov: Provenance;
  reason: string;
}

/**
 * Hosts that serve brand-keyed assets regardless of the brand (icon libraries /
 * aggregators). These are trusted to be about the queried slug.
 */
const LIBRARY_HOSTS = [
  "cdn.jsdelivr.net",
  "unpkg.com",
  "fastly.jsdelivr.net",
  "icons8.com",
  "img.icons8.com",
  "cdn.tabler.io",
  "lucide.dev",
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Build the set of hosts considered "official" for a brand.
 * Only a discovered / scan-seeded host counts. Deterministic .com guesses
 * are not official.
 */
export function officialHostsForBrand(
  brand: string,
  rankedBestHost?: string | null,
): Set<string> {
  const hosts = new Set<string>();
  if (rankedBestHost) {
    hosts.add(rankedBestHost.replace(/^www\./, "").toLowerCase());
  }
  return hosts;
}

function pathnameOf(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

/** Token must appear as its own path/host segment, not inside a JWT or filename. */
function hasBrandToken(haystack: string, token: string): boolean {
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(
    haystack,
  );
}

function isLibraryHost(host: string): boolean {
  return LIBRARY_HOSTS.some((l) => host === l || host.endsWith(`.${l}`));
}

/**
 * Classify a candidate URL's provenance for a brand.
 * Order matters: official > library > brand-token > untrusted.
 */
export function classifyCandidate(
  brand: string,
  officialHosts: Set<string>,
  url: string,
): ProvenanceResult {
  const host = hostOf(url);
  if (!host) return { prov: "untrusted", reason: "unparseable url" };

  if (officialHosts.has(host)) {
    return { prov: "official", reason: `host ${host} is official` };
  }
  if (isLibraryHost(host)) {
    return { prov: "library", reason: `host ${host} is a brand-keyed library` };
  }

  const { compact, hyphenated } = normalizeBrand(brand);
  const dotted = hyphenated ? hyphenated.replace(/-/g, ".") : "";
  const tokens = [compact, hyphenated, dotted].filter(
    (t) => t && t.length >= 3,
  );
  const haystack = `${host} ${pathnameOf(url)}`.toLowerCase();
  if (tokens.some((token) => hasBrandToken(haystack, token))) {
    return { prov: "brand-token", reason: "url contains brand token" };
  }

  return { prov: "untrusted", reason: `host ${host} has no brand evidence` };
}

/** True when a candidate is acceptable for publication (not untrusted). */
export function isTrustedProvenance(p: Provenance): boolean {
  return p !== "untrusted";
}
