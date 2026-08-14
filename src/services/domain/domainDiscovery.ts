/**
 * Provider-independent official-domain discovery with confidence scoring.
 *
 * PURE module: imports nothing from the crawler/search layer, so it cannot
 * participate in an import cycle (the reverted Tranche B attempt recursed via
 * domainDiscovery -> searchForLinksToSpider -> getOfficialDomainGuesses).
 * Callers supply candidate URLs (e.g. from a web search) and consume ranked,
 * confidence-tagged results plus an explicit rejection list.
 *
 * Addresses Tranche A findings:
 *  - F1 / F11: wrong-brand pollution entered at candidate acceptance; here we
 *    score brand-token agreement and reject search engines / social /
 *    aggregators / wikipedia / app stores instead of trusting "first link".
 *  - F5: provider blocked/rate-limited is distinct from an empty search — the
 *    caller reports the outcome and falls back to deterministic guesses.
 */

export type DomainConfidence = "high" | "medium" | "low";

export interface DomainGuess {
  url: string;
  host: string;
  confidence: DomainConfidence;
  reason: string;
}

export interface RankedDomain extends DomainGuess {
  score: number;
}

export interface DomainRanking {
  /** Best candidate that cleared the confidence threshold, if any. */
  best: RankedDomain | null;
  /** All non-excluded candidates, best first. */
  ranked: RankedDomain[];
  /** Candidates rejected because they are search/social/aggregator/etc. */
  rejected: { url: string; host: string; reason: string }[];
}

/** Normalize a brand into compact (alnum) and hyphenated slugs. */
export function normalizeBrand(brand: string): {
  compact: string;
  hyphenated: string;
} {
  const compact = brand
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "");
  const hyphenated = brand
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return { compact, hyphenated };
}

/**
 * Domains that must never be treated as a brand's official site:
 * search engines, social networks, app stores, code/asset hosts, encyclopedias,
 * and business aggregators. These show up constantly in search results for a
 * brand but are never the brand itself.
 */
export function isExcludedDomain(hostname: string): {
  excluded: boolean;
  reason: string;
} {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  const checks: [RegExp, string][] = [
    [/(?:^|\.)(google|bing|duckduckgo|yandex|baidu|yahoo)\./, "search-engine"],
    [
      /(?:^|\.)(facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|reddit|threads)\./,
      "social-network",
    ],
    [
      /(?:^|\.)(apple|google|microsoft|amazon|samsung)\.(com|app|co)$/,
      "platform-store",
    ],
    [
      /(?:^|\.)(play\.google|apps\.apple|appstore|microsoft\.com\/store)/,
      "app-store",
    ],
    [/(?:^|\.)(wikipedia|wikimedia|wiktionary)\./, "encyclopedia"],
    [
      /(?:^|\.)(github|gitlab|bitbucket|stackoverflow|stackexchange)\./,
      "code-host",
    ],
    [
      /(?:^|\.)(crunchbase|glassdoor|indeed|producthunt|angel\.list|g2\.com|capterra|trustpilot)\./,
      "business-aggregator",
    ],
    [/(?:^|\.)(jsdelivr|unpkg|cdnjs|cloudflare)\./, "cdn-not-brand"],
  ];
  for (const [re, reason] of checks) {
    if (re.test(host)) return { excluded: true, reason };
  }
  return { excluded: false, reason: "" };
}

/**
 * Score how well a domain agrees with the brand tokens.
 * Higher = more likely to be the brand's own site.
 */
export function scoreDomainMatch(brand: string, hostname: string): number {
  const { compact, hyphenated } = normalizeBrand(brand);
  // Dotted variant: a brand's space/hyphen often maps to a domain dot
  // ("ground news" / "ground-news" -> ground.news). Tranche A F11.
  const dotted = hyphenated ? hyphenated.replace(/-/g, ".") : "";
  const host = hostname.replace(/^www\./, "").toLowerCase();
  if (!compact) return 0;

  let score = 0;
  const bare = host.split(".")[0]; // left-most label

  // Left-most label exactly equals the brand slug: strongest signal.
  if (bare === compact) score += 100;
  else if (hyphenated && bare === hyphenated) score += 90;
  else if (dotted && (host === dotted || host.startsWith(`${dotted}.`)))
    score += 95; // whole domain equals the dotted brand ("ground.news")
  else if (host.startsWith(`${compact}.`)) score += 80;
  else if (hyphenated && host.startsWith(`${hyphenated}.`)) score += 70;
  else if (host.includes(compact))
    score += 40; // brand appears mid-domain
  else if (hyphenated && host.includes(hyphenated)) score += 30;

  // TLD quality: .com is the common default for brands.
  if (host.endsWith(".com")) score += 10;
  else if (/\.(io|app|co|ai|dev|net|org)$/.test(host)) score += 4;

  return score;
}

function confidenceFor(score: number): DomainConfidence {
  if (score >= 80) return "high";
  if (score >= 40) return "medium";
  return "low";
}

/** Deterministic guesses used when search is blocked or empty. */
export function generateDeterministicGuesses(brand: string): DomainGuess[] {
  const { compact, hyphenated } = normalizeBrand(brand);
  if (compact.length < 2) return [];
  const guesses: DomainGuess[] = [
    {
      url: `https://${compact}.com`,
      host: `${compact}.com`,
      confidence: "high",
      reason: "deterministic exact match",
    },
    {
      url: `https://www.${compact}.com`,
      host: `www.${compact}.com`,
      confidence: "high",
      reason: "deterministic exact match",
    },
  ];
  if (hyphenated && hyphenated !== compact) {
    guesses.push(
      {
        url: `https://${hyphenated}.com`,
        host: `${hyphenated}.com`,
        confidence: "medium",
        reason: "deterministic hyphenated",
      },
      {
        url: `https://www.${hyphenated}.com`,
        host: `www.${hyphenated}.com`,
        confidence: "medium",
        reason: "deterministic hyphenated",
      },
    );
  }
  return guesses;
}

/**
 * Rank caller-supplied candidate URLs for a brand.
 * Excludes search/social/aggregator/etc. hosts, scores the rest by brand
 * agreement, and returns the best candidate above the confidence threshold.
 * Pure: no network, no crawler imports.
 */
export function rankOfficialDomainCandidates(
  brand: string,
  candidateUrls: string[],
  options: { minScore?: number } = {},
): DomainRanking {
  const minScore = options.minScore ?? 40;
  const ranked: RankedDomain[] = [];
  const rejected: DomainRanking["rejected"] = [];
  const seenHosts = new Set<string>();

  for (const raw of candidateUrls) {
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);

    const ex = isExcludedDomain(host);
    if (ex.excluded) {
      rejected.push({ url: url.toString(), host, reason: ex.reason });
      continue;
    }

    const score = scoreDomainMatch(brand, host);
    ranked.push({
      url: `${url.protocol}//${url.host}`,
      host,
      score,
      confidence: confidenceFor(score),
      reason: `brand-match score=${score}`,
    });
  }

  ranked.sort((a, b) => b.score - a.score);
  const best =
    ranked.length > 0 && ranked[0].score >= minScore ? ranked[0] : null;
  return { best, ranked, rejected };
}

/**
 * Pick the official domain for a brand from candidate URLs, falling back to
 * deterministic guesses when nothing clears the threshold.
 */
export function pickOfficialDomain(
  brand: string,
  candidateUrls: string[],
): { url: string; confidence: DomainConfidence; reason: string } {
  const { best } = rankOfficialDomainCandidates(brand, candidateUrls);
  if (best) {
    return { url: best.url, confidence: best.confidence, reason: best.reason };
  }
  const fallback = generateDeterministicGuesses(brand)[0];
  if (fallback) {
    return {
      url: fallback.url,
      confidence: fallback.confidence,
      reason: `${fallback.reason} (no confident search candidate)`,
    };
  }
  return { url: "", confidence: "low", reason: "no candidates" };
}
