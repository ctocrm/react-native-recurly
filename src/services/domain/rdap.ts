/**
 * RDAP domain→org corroboration (Phase D).
 *
 * Spec (plan.md "D — RDAP resolver"): resolve the registrant org of the
 * crawl's official domain over RDAP (HTTPS, no key), bootstrapped from the
 * IANA RDAP service registry. CORROBORATION ONLY — the result never changes
 * icon ranks by itself and never replaces an icon; it produces evidence lines
 * for the log / report / brand spot-check flows.
 *
 * Parsers and helpers are pure; the lookup entry point takes an injectable
 * fetch and swallows all network failures (evidence must never break a crawl).
 */

const IANA_BOOTSTRAP_URL = "https://data.iana.org/rdap/dns.json";
const BOOTSTRAP_TTL_MS = 24 * 60 * 60 * 1000;
const RDAP_TIMEOUT_MS = 10_000;

export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** org-name tokens that carry no brand signal. */
const ORG_NOISE_TOKENS = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "gmbh",
  "srl",
  "sas",
  "bv",
  "nv",
  "pty",
  "plc",
  "ag",
  "corp",
  "corporation",
  "company",
  "holdings",
  "group",
  "international",
  "global",
  "solutions",
  "services",
  "technologies",
  "technology",
  "tech",
  "software",
  "systems",
  "the",
  "and",
]);

export interface RdapCorroboration {
  /** Registered domain that was looked up. */
  domain: string;
  /** Registrant org from RDAP, when the registry exposes one. */
  org: string | null;
  /** org↔brand token overlap AND/OR From-host↔registered-domain match. */
  corroborates: boolean;
  reason: string;
  orgTokenOverlap: string[];
  /** null when no From-host was known for this crawl. */
  domainMatchesFromHost: boolean | null;
}

// ---------------------------------------------------------------------------
// IANA bootstrap
// ---------------------------------------------------------------------------

/** dns.json shape: {"services": [["tld", ...], ["https://rdap.../", ...]], ...} */
export function parseRdapBootstrap(json: unknown): Map<string, string[]> {
  const map = new Map<string, string[]>();
  const services = (json as { services?: unknown })?.services;
  if (!Array.isArray(services)) return map;
  for (const service of services) {
    if (!Array.isArray(service) || service.length < 2) continue;
    const [tlds, urls] = service as [unknown, unknown];
    if (!Array.isArray(tlds) || !Array.isArray(urls)) continue;
    for (const tld of tlds) {
      if (typeof tld !== "string" || !tld) continue;
      const key = tld.toLowerCase().replace(/^\./, "");
      const bases = urls.filter((u): u is string => typeof u === "string");
      const existing = map.get(key) ?? [];
      existing.push(...bases);
      map.set(key, existing);
    }
  }
  return map;
}

let bootstrapCache: { map: Map<string, string[]>; at: number } | null = null;
let bootstrapInflight: Promise<Map<string, string[]>> | null = null;

async function getRdapBootstrap(
  fetchImpl: FetchImpl,
): Promise<Map<string, string[]>> {
  if (bootstrapCache && Date.now() - bootstrapCache.at < BOOTSTRAP_TTL_MS) {
    return bootstrapCache.map;
  }
  if (bootstrapInflight) return bootstrapInflight;
  bootstrapInflight = (async () => {
    const res = await fetchImpl(IANA_BOOTSTRAP_URL);
    if (!res.ok) throw new Error(`IANA bootstrap HTTP ${res.status}`);
    const map = parseRdapBootstrap(await res.json());
    if (map.size === 0) throw new Error("IANA bootstrap parsed empty");
    bootstrapCache = { map, at: Date.now() };
    return map;
  })();
  try {
    return await bootstrapInflight;
  } finally {
    bootstrapInflight = null;
  }
}

export function tldOfDomain(domain: string): string {
  const labels = domain
    .toLowerCase()
    .replace(/\.$/, "")
    .split(".")
    .filter(Boolean);
  return labels[labels.length - 1] ?? "";
}

// ---------------------------------------------------------------------------
// Registrable domain (for From-host ↔ registered-domain comparison)
// ---------------------------------------------------------------------------

const TWO_LABEL_SUFFIXES = new Set([
  "co.uk",
  "org.uk",
  "me.uk",
  "com.au",
  "net.au",
  "co.jp",
  "com.br",
  "co.nz",
  "com.mx",
  "co.za",
  "com.sg",
  "com.ar",
  "co.in",
  "co.kr",
  "com.tr",
  "co.il",
  "com.hk",
  "co.th",
]);

/** Naive registrable domain: last two labels (three for common co.uk-style). */
export function registeredDomainOf(host: string): string | null {
  const labels = host
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".")
    .filter(Boolean);
  if (labels.length < 2) return null;
  const last2 = labels.slice(-2).join(".");
  if (TWO_LABEL_SUFFIXES.has(last2) && labels.length >= 3) {
    return labels.slice(-3).join(".");
  }
  return last2;
}

export function domainMatchesHost(
  domain: string,
  host: string | null | undefined,
): boolean {
  if (!host) return false;
  const h = host.toLowerCase().replace(/^www\./, "");
  const d = domain.toLowerCase();
  return h === d || h.endsWith(`.${d}`);
}

// ---------------------------------------------------------------------------
// RDAP response parsing
// ---------------------------------------------------------------------------

/**
 * Registrant org from an RDAP domain response: the entity whose roles include
 * "registrant", reading its vCard "org" (falling back to "fn"). Registrant
 * entities may be nested one level inside other entities.
 */
export function registrantOrgFromRdap(json: unknown): string | null {
  const entities = (json as { entities?: unknown })?.entities;
  if (!Array.isArray(entities)) return null;

  const readVcardText = (
    entity: Record<string, unknown>,
    field: string,
  ): string | null => {
    const vcardArray = entity.vcardArray;
    if (!Array.isArray(vcardArray) || !Array.isArray(vcardArray[1])) return null;
    for (const entry of vcardArray[1] as unknown[]) {
      if (
        Array.isArray(entry) &&
        entry[0] === field &&
        typeof entry[3] === "string" &&
        entry[3].trim()
      ) {
        return entry[3].trim();
      }
    }
    return null;
  };

  const visit = (list: unknown[]): string | null => {
    for (const item of list) {
      const entity = item as {
        roles?: unknown;
        entities?: unknown;
        vcardArray?: unknown;
      };
      if (Array.isArray(entity.roles) && entity.roles.includes("registrant")) {
        const org =
          readVcardText(entity as Record<string, unknown>, "org") ??
          readVcardText(entity as Record<string, unknown>, "fn");
        if (org) return org;
      }
      if (Array.isArray(entity.entities)) {
        const nested = visit(entity.entities);
        if (nested) return nested;
      }
    }
    return null;
  };

  return visit(entities);
}

// ---------------------------------------------------------------------------
// Brand ↔ org token overlap
// ---------------------------------------------------------------------------

function normalizeName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Tokens shared between the merchant name and the registrant org. Compares in
 * BOTH directions against the normalized strings so compound slugs match too
 * ("zohoaccounts".includes("zoho")). Tokens under 3 chars never count, so a
 * one-letter brand ("x.ai") cannot false-positive on short org tokens.
 */
export function brandTokenOverlap(brand: string, org: string | null): string[] {
  if (!org) return [];
  const brandNorm = normalizeName(brand);
  const orgNorm = normalizeName(org);
  if (!brandNorm || !orgNorm) return [];
  const orgTokens = orgNorm
    .split(" ")
    .filter((t) => t.length >= 3 && !ORG_NOISE_TOKENS.has(t));
  const brandTokens = brandNorm
    .split(" ")
    .filter((t) => t.length >= 3 && !ORG_NOISE_TOKENS.has(t));
  const hits = new Set<string>();
  for (const token of orgTokens) {
    if (brandNorm.includes(token)) hits.add(token);
  }
  for (const token of brandTokens) {
    if (orgNorm.includes(token)) hits.add(token);
  }
  return [...hits];
}

// ---------------------------------------------------------------------------
// Lookup + corroboration entry points
// ---------------------------------------------------------------------------

/** Resolve the registrant org for a domain; null on bootstrap/network failure. */
export async function lookupRdapOrg(
  domain: string,
  fetchImpl: FetchImpl = fetch,
): Promise<{ org: string | null } | null> {
  try {
    const bases = await getRdapBootstrap(fetchImpl);
    const baseList = bases.get(tldOfDomain(domain));
    if (!baseList || baseList.length === 0) return null;
    const base = baseList[0].replace(/\/?$/, "/");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), RDAP_TIMEOUT_MS);
    try {
      const res = await fetchImpl(
        `${base}domain/${encodeURIComponent(domain)}`,
        {
          signal: controller.signal,
          headers: { Accept: "application/rdap+json" },
        },
      );
      if (!res.ok) return { org: null };
      return { org: registrantOrgFromRdap(await res.json()) };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

/**
 * Corroborate a crawl's official domain against the merchant name and (when
 * the crawl was scan-seeded) the email From-host. Logs the evidence line and
 * returns null on infrastructure failure — evidence never breaks a crawl and
 * never changes ranks by itself.
 */
export async function rdapCorroborateBrand(
  brand: string,
  officialHost: string,
  fromHost: string | null,
  fetchImpl: FetchImpl = fetch,
): Promise<RdapCorroboration | null> {
  const domain = registeredDomainOf(officialHost);
  if (!domain) return null;
  const lookup = await lookupRdapOrg(domain, fetchImpl);
  if (!lookup) {
    console.log(`[RDAP] lookup ${domain} unavailable (bootstrap/network)`);
    return null;
  }
  const org = lookup.org;
  const orgTokenOverlap = brandTokenOverlap(brand, org);
  const domainMatchesFromHost = fromHost
    ? domainMatchesHost(domain, fromHost)
    : null;
  const corroborates =
    orgTokenOverlap.length > 0 || domainMatchesFromHost === true;
  const parts: string[] = [];
  if (orgTokenOverlap.length > 0) {
    parts.push(`org tokens match: ${orgTokenOverlap.join(", ")}`);
  } else {
    parts.push("no org-brand token overlap");
  }
  parts.push(
    domainMatchesFromHost === null
      ? "no From-host known"
      : domainMatchesFromHost
        ? "From-host matches registered domain"
        : "From-host does NOT match registered domain",
  );
  const reason = parts.join("; ");
  console.log(
    `[RDAP] lookup ${domain} org="${org ?? "?"}" brand="${brand}" corroborates=${corroborates ? "yes" : "no"} (${reason})`,
  );
  return {
    domain,
    org,
    corroborates,
    reason,
    orgTokenOverlap,
    domainMatchesFromHost,
  };
}
