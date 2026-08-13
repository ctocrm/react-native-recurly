/**
 * Provider-independent domain discovery with confidence scoring.
 * Returns normalized domain guesses for a brand with explicit confidence levels.
 *
 * This module uses dynamic imports to avoid circular dependencies with searchEngines.ts.
 */

interface DomainGuess {
  url: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

/**
 * Normalize brand name for domain matching
 */
function normalizeBrand(brand: string): {
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
 * Generate deterministic domain guesses (fallback when search fails)
 */
function generateDeterministicGuesses(brand: string): DomainGuess[] {
  const { compact, hyphenated } = normalizeBrand(brand);
  if (compact.length < 2) return [];

  const guesses: DomainGuess[] = [];

  // Exact match (high confidence)
  guesses.push(
    {
      url: `https://${compact}.com`,
      confidence: "high",
      reason: "exact match",
    },
    {
      url: `https://www.${compact}.com`,
      confidence: "high",
      reason: "exact match",
    },
  );

  // Hyphenated variant (medium confidence)
  if (hyphenated && hyphenated !== compact) {
    guesses.push(
      {
        url: `https://${hyphenated}.com`,
        confidence: "medium",
        reason: "hyphenated variant",
      },
      {
        url: `https://www.${hyphenated}.com`,
        confidence: "medium",
        reason: "hyphenated variant",
      },
    );
  }

  // TLD variants (low confidence)
  for (const tld of ["io", "app", "co", "net", "org", "ca"]) {
    guesses.push(
      {
        url: `https://${compact}.${tld}`,
        confidence: "low",
        reason: `TLD variant: .${tld}`,
      },
      {
        url: `https://www.${compact}.${tld}`,
        confidence: "low",
        reason: `TLD variant: .${tld}`,
      },
    );
  }

  return guesses;
}

/**
 * Check if a domain is a search engine, social media, or aggregator
 */
function isExcludedDomain(hostname: string): boolean {
  const host = hostname.replace(/^www\./, "").toLowerCase();
  return (
    /(?:^|\.)(google|bing|duckduckgo|yandex|baidu)\./.test(host) ||
    /(?:^|\.)(facebook|instagram|linkedin|twitter|x|youtube|tiktok|pinterest|reddit)\./.test(
      host,
    ) ||
    /(?:^|\.)(apple|google|microsoft|amazon|play|store)\.(com|app)$/.test(
      host,
    ) ||
    /(?:^|\.)(wikipedia|crunchbase|linkedin|glassdoor|indeed|producthunt)\./.test(
      host,
    )
  );
}

/**
 * Score a domain based on brand token agreement
 */
function scoreDomainMatch(brand: string, domain: string): number {
  const { compact, hyphenated } = normalizeBrand(brand);
  const host = domain.replace(/^www\./, "").toLowerCase();

  let score = 0;

  // Exact match on compact name
  if (host.startsWith(`${compact}.`) || host === compact) {
    score += 100;
  }
  // Hyphenated match
  else if (
    hyphenated &&
    (host.startsWith(`${hyphenated}.`) || host === hyphenated)
  ) {
    score += 80;
  }
  // Partial match (brand tokens in domain)
  else if (host.includes(compact)) {
    score += 50;
  } else if (hyphenated && host.includes(hyphenated)) {
    score += 40;
  }

  // Penalty for common non-brand TLDs
  if (/\.(io|app|co|dev|tech|ai|gg)$/.test(host)) {
    score -= 10;
  }

  // Bonus for .com
  if (host.endsWith(".com")) {
    score += 10;
  }

  return score;
}

/**
 * Discover official domain using web search (lazy import to avoid circular deps)
 */
export async function discoverOfficialDomain(
  brand: string,
): Promise<DomainGuess[]> {
  console.log(`[DOMAIN_DISCOVERY] Starting domain discovery for "${brand}"`);

  try {
    // Lazy import to break circular dependency with searchEngines
    const { searchForLinksToSpider } = await import("../searchEngines");
    const links = await searchForLinksToSpider(brand);

    if (links.length === 0) {
      console.log(
        `[DOMAIN_DISCOVERY] No links found for "${brand}", falling back to deterministic guesses`,
      );
      return generateDeterministicGuesses(brand);
    }

    // Extract unique domains from links
    const domainCounts = new Map<string, { count: number; urls: string[] }>();

    for (const link of links) {
      try {
        const parsed = new URL(link);
        const host = parsed.hostname.replace(/^www\./, "").toLowerCase();

        // Skip excluded domains (search engines, social, aggregators)
        if (isExcludedDomain(host)) continue;

        const existing = domainCounts.get(host) || { count: 0, urls: [] };
        existing.count++;
        existing.urls.push(link);
        domainCounts.set(host, existing);
      } catch {
        // Invalid URL, skip
      }
    }

    if (domainCounts.size === 0) {
      console.log(
        `[DOMAIN_DISCOVERY] All domains excluded for "${brand}", falling back to deterministic guesses`,
      );
      return generateDeterministicGuesses(brand);
    }

    // Score and rank domains
    const scoredDomains = Array.from(domainCounts.entries())
      .map(([domain, data]) => ({
        domain,
        count: data.count,
        urls: data.urls,
        score: scoreDomainMatch(brand, domain),
      }))
      .sort((a, b) => b.score - a.score || b.count - a.count);

    console.log(
      `[DOMAIN_DISCOVERY] Top domains for "${brand}":`,
      scoredDomains
        .slice(0, 5)
        .map((d) => `${d.domain} (score: ${d.score}, count: ${d.count})`),
    );

    // Convert to DomainGuess format
    const guesses: DomainGuess[] = [];

    for (const { domain, score, count } of scoredDomains) {
      let confidence: "high" | "medium" | "low";
      let reason: string;

      if (score >= 90 && count >= 2) {
        confidence = "high";
        reason = "search result: strong brand match with multiple occurrences";
      } else if (score >= 70 && count >= 1) {
        confidence = "medium";
        reason = "search result: good brand match";
      } else if (score >= 40) {
        confidence = "low";
        reason = "search result: partial brand match";
      } else {
        confidence = "low";
        reason = "search result: weak brand match";
      }

      guesses.push(
        { url: `https://${domain}`, confidence, reason },
        { url: `https://www.${domain}`, confidence, reason },
      );
    }

    // Add deterministic guesses as fallback (lower priority)
    const deterministic = generateDeterministicGuesses(brand);
    for (const d of deterministic) {
      // Only add if not already present
      const exists = guesses.some((g) => g.url === d.url);
      if (!exists) {
        guesses.push({ ...d, reason: `fallback: ${d.reason}` });
      }
    }

    console.log(
      `[DOMAIN_DISCOVERY] Generated ${guesses.length} domain guesses for "${brand}"`,
    );
    return guesses;
  } catch (error) {
    console.log(`[DOMAIN_DISCOVERY] Search failed for "${brand}":`, error);
    // On search failure, return deterministic guesses but mark as fallback
    const fallback = generateDeterministicGuesses(brand);
    return fallback.map((d) => ({
      ...d,
      reason: `fallback (search error): ${d.reason}`,
    }));
  }
}

/**
 * Main export - provider-independent domain discovery with confidence scoring.
 * Uses web search to discover domains with confidence scoring.
 * Falls back to deterministic guesses if search fails.
 */
export async function getOfficialDomainGuesses(
  brand: string,
): Promise<
  { url: string; confidence: "high" | "medium" | "low"; reason: string }[]
> {
  return discoverOfficialDomain(brand);
}
