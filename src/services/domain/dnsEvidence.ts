/**
 * J5: DNS liveness evidence via DNS-over-HTTPS (wire-format JSON). Pure
 * `fetch` — no native module. Classic port-43 whois is unreachable from RN,
 * so registry truth comes from RDAP (rdap.ts) and DNS truth from here.
 *
 * Evidence mapping (feeds hostLiveness scoring):
 *  - Status 3 (NXDOMAIN)   → the name no longer exists
 *  - Status 0, no A/AAAA   → no web presence
 *  - no NS                 → delegation removed (domain effectively dead)
 *  - no MX                 → no mail service
 *
 * Google is tried first, Cloudflare is the fallback; if every query fails the
 * evidence is `available: false` and callers must treat the host as UNKNOWN
 * (never as dead — a probe outage must not pop defunct warnings).
 */

export interface DohAnswer {
  name?: string;
  type?: number;
  data?: string;
}

export interface DnsEvidence {
  /** false when every DoH query failed — evidence is unavailable. */
  available: boolean;
  nxdomain: boolean;
  hasA: boolean;
  hasAAAA: boolean;
  hasMX: boolean;
  hasNS: boolean;
}

const DNS_JSON_HEADER = { Accept: "application/dns-json" };

const RESOLVERS: ((name: string, type: string) => string)[] = [
  (name, type) =>
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
  (name, type) =>
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
];

const TYPE_A = 1;
const TYPE_AAAA = 28;
const TYPE_MX = 15;
const TYPE_NS = 2;

async function dohQuery(
  name: string,
  type: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response>,
): Promise<{ status: number; answers: DohAnswer[] } | null> {
  for (const build of RESOLVERS) {
    try {
      const res = await fetchImpl(build(name, type), {
        headers: DNS_JSON_HEADER,
      });
      if (!res.ok) continue;
      const json = (await res.json()) as {
        Status?: number;
        Answer?: DohAnswer[];
      };
      return {
        status: typeof json.Status === "number" ? json.Status : 0,
        answers: Array.isArray(json.Answer) ? json.Answer : [],
      };
    } catch {
      // try the next resolver
    }
  }
  return null;
}

export async function fetchDnsEvidence(
  domain: string,
  fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = fetch,
): Promise<DnsEvidence> {
  const evidence: DnsEvidence = {
    available: true,
    nxdomain: false,
    hasA: false,
    hasAAAA: false,
    hasMX: false,
    hasNS: false,
  };
  let successes = 0;
  for (const [type, key] of [
    ["A", "hasA"],
    ["AAAA", "hasAAAA"],
    ["MX", "hasMX"],
    ["NS", "hasNS"],
  ] as const) {
    const res = await dohQuery(domain, type, fetchImpl);
    if (!res) continue;
    successes += 1;
    if (res.status === 3) evidence.nxdomain = true;
    const wanted =
      type === "A" ? TYPE_A : type === "AAAA" ? TYPE_AAAA : type === "MX" ? TYPE_MX : TYPE_NS;
    if (res.answers.some((a) => a.type === wanted)) {
      evidence[key] = true;
    }
  }
  evidence.available = successes > 0;
  return evidence;
}
