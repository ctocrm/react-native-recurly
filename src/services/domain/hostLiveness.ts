/**
 * J5: dead-host strategy — DNS/RDAP liveness evidence → confidence score →
 * user decision. The tiers and their meaning were locked with the user:
 *
 *  - unregistered   (RDAP 404)                    score ~95 — domain gone;
 *      the only labels that justify a "defunct" popup are unregistered /
 *      nxdomain / delegation-gone. zerosupporthosting.ca is the user's own
 *      closed company: unregistered, and the popup must say so.
 *  - nxdomain      (DNS Status 3)                 score ~90
 *  - delegation-gone (registered, no NS)          score ~85
 *  - no-services   (registered, no A/AAAA, no MX) score ~70 — NOT necessarily
 *      defunct (zohoaccounts.ca is registered by Zoho and mail-only): soft
 *      "no website found" wording, never "defunct".
 *  - unreachable   (DNS fine, HTTP dead)          score ~35 — may be blocking.
 *  - unknown       (probes failed)                score 0 — crawl behaves as
 *      before; a probe outage must never pop defunct warnings.
 *
 * Never auto-delete: a dead website ≠ a stopped charge. The user decides
 * (Keep / Mark as Canceled / Delete) and the decision is persisted so the
 * warning never re-fires.
 */

import { lookupRdapRegistration } from "./rdap";
import { fetchDnsEvidence, type DnsEvidence } from "./dnsEvidence";
import { getPreference, setPreference } from "@/services/database";

export type HostLivenessLabel =
  | "unregistered"
  | "nxdomain"
  | "delegation-gone"
  | "no-services"
  | "unreachable"
  | "alive"
  | "unknown";

export interface HostLivenessInputs {
  registration: {
    status: "registered" | "unregistered" | "unknown";
    org: string | null;
  };
  dns: DnsEvidence;
  /** Caller context: every crawl fetch to this host failed. */
  httpDead?: boolean;
}

export interface HostLivenessAssessment {
  domain: string;
  label: HostLivenessLabel;
  score: number;
  evidence: string[];
}

/** True when the score is high enough to justify the defunct popup. */
export function isDefunctConfident(score: number): boolean {
  return score >= 85;
}

export function hostLivenessScore(inputs: HostLivenessInputs): {
  label: HostLivenessLabel;
  score: number;
} {
  const { registration, dns, httpDead } = inputs;
  if (registration.status === "unregistered") {
    return { label: "unregistered", score: 95 };
  }
  if (dns.available && dns.nxdomain) {
    return { label: "nxdomain", score: 90 };
  }
  if (dns.available && !dns.hasNS) {
    return { label: "delegation-gone", score: 85 };
  }
  if (dns.available && !dns.hasA && !dns.hasAAAA && !dns.hasMX) {
    return { label: "no-services", score: 70 };
  }
  if (httpDead) {
    return { label: "unreachable", score: 35 };
  }
  if (dns.available) {
    return { label: "alive", score: 5 };
  }
  return { label: "unknown", score: 0 };
}

export async function assessHostLiveness(
  domain: string,
  opts: {
    fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>;
    httpDead?: boolean;
  } = {},
): Promise<HostLivenessAssessment> {
  const registration = await lookupRdapRegistration(domain, opts.fetchImpl);
  const dns = await fetchDnsEvidence(domain, opts.fetchImpl);
  const { label, score } = hostLivenessScore({
    registration,
    dns,
    httpDead: opts.httpDead,
  });
  const evidence: string[] = [];
  if (registration.status === "registered" && registration.org) {
    evidence.push(`registry org: ${registration.org}`);
  }
  if (registration.status === "unregistered") {
    evidence.push("registry: domain not registered (RDAP 404)");
  }
  if (dns.available) {
    if (dns.nxdomain) evidence.push("DNS: NXDOMAIN");
    evidence.push(
      `DNS: A=${dns.hasA ? "yes" : "no"} AAAA=${dns.hasAAAA ? "yes" : "no"} MX=${dns.hasMX ? "yes" : "no"} NS=${dns.hasNS ? "yes" : "no"}`,
    );
  } else {
    evidence.push("DNS probes unavailable");
  }
  if (opts.httpDead) evidence.push("all crawl fetches to this host failed");
  return { domain, label, score, evidence };
}

// ---------------------------------------------------------------------------
// Assessment events (UI popup) + persisted decisions (no re-popup)
// ---------------------------------------------------------------------------

export interface HostLivenessEvent {
  domain: string;
  iconKey: string;
  label: HostLivenessLabel;
  score: number;
  evidence: string[];
  at: number;
}

type Listener = (event: HostLivenessEvent) => void;

let pendingEvent: HostLivenessEvent | null = null;
const listeners = new Set<Listener>();

function setPendingEvent(event: HostLivenessEvent): void {
  pendingEvent = event;
  for (const listener of listeners) {
    try {
      listener(event);
    } catch (err) {
      console.log(
        "[CRAWL] host-liveness listener FAILED",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export function subscribeHostLiveness(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function consumeHostLivenessEvent(): HostLivenessEvent | null {
  return pendingEvent;
}

export const HOST_DECISIONS_PREF_KEY = "host_liveness_decisions";
export const HOST_LIVENESS_CACHE_PREF_KEY = "host_liveness_cache";

export type HostDecision = "keep" | "canceled" | "deleted";

type DecisionMap = Record<
  string,
  { decision: HostDecision; score: number; at: number }
>;

export async function getHostDecisions(): Promise<DecisionMap> {
  try {
    const raw = await getPreference(HOST_DECISIONS_PREF_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as DecisionMap;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export async function setHostDecision(
  domain: string,
  decision: HostDecision,
  score: number,
): Promise<void> {
  try {
    const map = await getHostDecisions();
    map[domain] = { decision, score, at: Date.now() };
    await setPreference(HOST_DECISIONS_PREF_KEY, JSON.stringify(map));
  } catch (err) {
    console.log(
      "[CRAWL] host decision persist FAILED",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Known dead (cached score ≥85)? Skip expensive web discovery for it. */
export async function isKnownDeadHost(domain: string): Promise<boolean> {
  try {
    const raw = await getPreference(HOST_LIVENESS_CACHE_PREF_KEY);
    if (!raw) return false;
    const cache = JSON.parse(raw) as Record<string, { score: number }>;
    return (cache[domain]?.score ?? 0) >= 85;
  } catch {
    return false;
  }
}

/** Cache the assessment (short-circuit fuel) and fire the UI event. */
export async function recordHostLiveness(
  domain: string,
  iconKey: string,
  assessment: HostLivenessAssessment,
): Promise<void> {
  try {
    const raw = await getPreference(HOST_LIVENESS_CACHE_PREF_KEY);
    const cache = raw
      ? (JSON.parse(raw) as Record<
          string,
          { label: string; score: number; at: number }
        >)
      : {};
    cache[domain] = {
      label: assessment.label,
      score: assessment.score,
      at: Date.now(),
    };
    await setPreference(HOST_LIVENESS_CACHE_PREF_KEY, JSON.stringify(cache));
  } catch {
    // cache is best-effort; never breaks the crawl
  }
  const decisions = await getHostDecisions();
  if (isDefunctConfident(assessment.score) && !decisions[domain]) {
    setPendingEvent({
      domain,
      iconKey,
      label: assessment.label,
      score: assessment.score,
      evidence: assessment.evidence,
      at: Date.now(),
    });
  }
}

