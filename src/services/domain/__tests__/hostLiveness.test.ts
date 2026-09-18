/**
 * J5: dead-host strategy gates — RDAP registration status (404 = strongest
 * signal), DoH evidence mapping, tier scoring, event/decision store.
 * All network goes through injected fetchImpl fixtures; the DB is mocked.
 */

import { lookupRdapRegistration } from "../rdap";
import { fetchDnsEvidence } from "../dnsEvidence";
import {
  assessHostLiveness,
  hostLivenessScore,
  isDefunctConfident,
  isKnownDeadHost,
  isKnownUnreachableHost,
  recordHostLiveness,
  setHostDecision,
  subscribeHostLiveness,
  consumeHostLivenessEvent,
} from "../hostLiveness";

jest.mock("@/services/database", () => {
  const prefs = new Map<string, string>();
  return {
    getPreference: jest.fn(async (key: string) => prefs.get(key) ?? null),
    setPreference: jest.fn(
      async (key: string, value: string) => {
        prefs.set(key, value);
      },
    ),
  };
});

const bootstrapResponse = {
  ok: true,
  status: 200,
  json: async () => ({
    services: [[["ca"], ["https://rdap.cira.ca/"]]],
  }),
};

function fixtureFetch(
  routes: { match: RegExp; respond: () => Response }[],
): (url: string, init?: RequestInit) => Promise<Response> {
  return async (url: string) => {
    if (/data\.iana\.org\/rdap\/dns\.json/.test(url)) {
      return bootstrapResponse as unknown as Response;
    }
    for (const route of routes) {
      if (route.match.test(url)) return route.respond();
    }
    throw new Error(`unrouted fetch: ${url}`);
  };
}

function doh(status: number, answers: { type: number }[]): Response {
  return {
    ok: true,
    status,
    json: async () => ({ Status: status, Answer: answers }),
  } as unknown as Response;
}

describe("lookupRdapRegistration (J5)", () => {
  it("maps RDAP 404 to unregistered", async () => {
    const fetchImpl = fixtureFetch([
      {
        match: /rdap\.cira\.ca\/domain\/zerosupporthosting\.ca/,
        respond: () => ({ ok: false, status: 404 }),
      } as never,
    ]);
    const reg = await lookupRdapRegistration(
      "zerosupporthosting.ca",
      fetchImpl as never,
    );
    expect(reg.status).toBe("unregistered");
  });

  it("maps RDAP 200 to registered with the registrant org", async () => {
    const fetchImpl = fixtureFetch([
      {
        match: /rdap\.cira\.ca\/domain\/zohoaccounts\.ca/,
        respond: () =>
          ({
            ok: true,
            status: 200,
            json: async () => ({
              entities: [
                {
                  roles: ["registrant"],
                  vcardArray: [
                    "vcard",
                    [["org", {}, "text", "Zoho Canada Corporation"]],
                  ],
                },
              ],
            }),
          }) as unknown as Response,
      } as never,
    ]);
    const reg = await lookupRdapRegistration(
      "zohoaccounts.ca",
      fetchImpl as never,
    );
    expect(reg.status).toBe("registered");
    expect(reg.org).toContain("Zoho");
  });

  it("maps RDAP 500 to unknown (never dead on probe failure)", async () => {
    const fetchImpl = fixtureFetch([
      {
        match: /rdap\.cira\.ca\/domain\/example\.ca/,
        respond: () => ({ ok: false, status: 500 }),
      } as never,
    ]);
    const reg = await lookupRdapRegistration("example.ca", fetchImpl as never);
    expect(reg.status).toBe("unknown");
  });
});

describe("fetchDnsEvidence (J5)", () => {
  it("maps NXDOMAIN across all query types", async () => {
    const fetchImpl = fixtureFetch([
      { match: /type=A/, respond: () => doh(3, []) } as never,
      { match: /type=AAAA/, respond: () => doh(3, []) } as never,
      { match: /type=MX/, respond: () => doh(3, []) } as never,
      { match: /type=NS/, respond: () => doh(3, []) } as never,
    ]);
    const ev = await fetchDnsEvidence("gone.example", fetchImpl as never);
    expect(ev.available).toBe(true);
    expect(ev.nxdomain).toBe(true);
    expect(ev.hasA).toBe(false);
    expect(ev.hasNS).toBe(false);
  });

  it("detects present records on a live domain", async () => {
    const fetchImpl = fixtureFetch([
      { match: /type=A&|type=A$/, respond: () => doh(0, [{ type: 1 }]) } as never,
      { match: /type=AAAA/, respond: () => doh(0, []) } as never,
      { match: /type=MX/, respond: () => doh(0, [{ type: 15 }]) } as never,
      { match: /type=NS/, respond: () => doh(0, [{ type: 2 }]) } as never,
    ]);
    const ev = await fetchDnsEvidence("alive.example", fetchImpl as never);
    expect(ev.hasA).toBe(true);
    expect(ev.hasMX).toBe(true);
    expect(ev.hasNS).toBe(true);
    expect(ev.hasAAAA).toBe(false);
    expect(ev.nxdomain).toBe(false);
  });

  it("falls back to the second resolver when the first fails", async () => {
    const seen: string[] = [];
    const fetchImpl = async (url: string) => {
      seen.push(url);
      if (/dns\.google/.test(url)) throw new Error("primary down");
      return doh(0, [{ type: 1 }]) as unknown as Response;
    };
    const ev = await fetchDnsEvidence("fallback.example", fetchImpl as never);
    expect(seen.some((u) => /cloudflare-dns\.com/.test(u))).toBe(true);
    expect(ev.available).toBe(true);
    expect(ev.hasA).toBe(true);
  });

  it("reports unavailable when every resolver fails", async () => {
    const fetchImpl = async () => {
      throw new Error("offline");
    };
    const ev = await fetchDnsEvidence("offline.example", fetchImpl as never);
    expect(ev.available).toBe(false);
  });
});

describe("hostLivenessScore tiers (J5)", () => {
  const base = {
    registration: { status: "unknown" as const, org: null },
    dns: {
      available: true,
      nxdomain: false,
      hasA: true,
      hasAAAA: false,
      hasMX: true,
      hasNS: true,
    },
  };

  it("tier 1: unregistered (RDAP 404) → 95, defunct-confident", () => {
    const r = hostLivenessScore({
      ...base,
      registration: { status: "unregistered", org: null },
    });
    expect(r).toEqual({ label: "unregistered", score: 95 });
    expect(isDefunctConfident(r.score)).toBe(true);
  });

  it("tier 2: nxdomain → 90", () => {
    const r = hostLivenessScore({
      ...base,
      dns: { ...base.dns, hasA: false, nxdomain: true },
    });
    expect(r).toEqual({ label: "nxdomain", score: 90 });
  });

  it("tier 3: delegation gone (no NS) → 85, defunct-confident", () => {
    const r = hostLivenessScore({
      ...base,
      dns: { ...base.dns, hasNS: false },
    });
    expect(r).toEqual({ label: "delegation-gone", score: 85 });
    expect(isDefunctConfident(r.score)).toBe(true);
  });

  it("tier 4: registered, no services → 70 (soft wording, NOT defunct)", () => {
    const r = hostLivenessScore({
      ...base,
      dns: {
        available: true,
        nxdomain: false,
        hasA: false,
        hasAAAA: false,
        hasMX: false,
        hasNS: true,
      },
    });
    expect(r).toEqual({ label: "no-services", score: 70 });
    expect(isDefunctConfident(r.score)).toBe(false);
  });

  it("tier 5: DNS fine but HTTP dead → 35", () => {
    expect(hostLivenessScore({ ...base, httpDead: true })).toEqual({
      label: "unreachable",
      score: 35,
    });
  });

  it("alive → 5; probes failing → unknown 0", () => {
    expect(hostLivenessScore(base)).toEqual({ label: "alive", score: 5 });
    expect(
      hostLivenessScore({
        registration: { status: "unknown", org: null },
        dns: {
          available: false,
          nxdomain: false,
          hasA: false,
          hasAAAA: false,
          hasMX: false,
          hasNS: false,
        },
      }),
    ).toEqual({ label: "unknown", score: 0 });
  });
});

describe("assessHostLiveness end-to-end (J5)", () => {
  it("zerosupporthosting case: RDAP 404 + NXDOMAIN → unregistered/95 with evidence", async () => {
    const fetchImpl = fixtureFetch([
      {
        match: /rdap\.cira\.ca\/domain\/zerosupporthosting\.ca/,
        respond: () => ({ ok: false, status: 404 }),
      } as never,
      {
        match: /dns\.google|cloudflare-dns/,
        respond: () => doh(3, []),
      } as never,
    ]);
    const a = await assessHostLiveness("zerosupporthosting.ca", {
      fetchImpl: fetchImpl as never,
      httpDead: true,
    });
    expect(a.label).toBe("unregistered");
    expect(a.score).toBe(95);
    expect(a.evidence.some((e) => e.includes("RDAP 404"))).toBe(true);
  });
});

describe("recordHostLiveness event + decisions (J5)", () => {
  it("raises a defunct-confident event once; a decision suppresses re-fire", async () => {
    const events: string[] = [];
    const off = subscribeHostLiveness((e) =>
      events.push(`${e.domain}:${e.score}`),
    );
    consumeHostLivenessEvent();
    await recordHostLiveness("gone.example", "gone", {
      domain: "gone.example",
      label: "unregistered",
      score: 95,
      evidence: ["RDAP 404"],
    });
    expect(events).toEqual(["gone.example:95"]);
    await setHostDecision("gone.example", "keep", 95);
    await recordHostLiveness("gone.example", "gone", {
      domain: "gone.example",
      label: "unregistered",
      score: 95,
      evidence: ["RDAP 404"],
    });
    expect(events).toEqual(["gone.example:95"]);
    off();
  });

  it("never fires for sub-threshold scores", async () => {
    let fired = 0;
    const off = subscribeHostLiveness(() => {
      fired += 1;
    });
    consumeHostLivenessEvent();
    await recordHostLiveness("soft.example", "soft", {
      domain: "soft.example",
      label: "no-services",
      score: 70,
      evidence: [],
    });
    expect(fired).toBe(0);
    off();
  });

  it("isKnownDeadHost reflects the cached score threshold", async () => {
    await recordHostLiveness("cached.example", "cached", {
      domain: "cached.example",
      label: "no-services",
      score: 70,
      evidence: [],
    });
    expect(await isKnownDeadHost("cached.example")).toBe(false);
    await recordHostLiveness("dead.example", "dead", {
      domain: "dead.example",
      label: "unregistered",
      score: 95,
      evidence: [],
    });
    expect(await isKnownDeadHost("dead.example")).toBe(true);
    expect(await isKnownDeadHost("never-probed.example")).toBe(false);
  });
});

describe("R30 (J5b) tier-5 unreachable short-circuit window", () => {
  it("a fresh unreachable verdict short-circuits crawls", async () => {
    await recordHostLiveness("blocked.example", "blocked", {
      domain: "blocked.example",
      label: "unreachable",
      score: 35,
      evidence: [],
    });
    expect(await isKnownUnreachableHost("blocked.example")).toBe(true);
    // Tier-5 is NOT defunct — the ≥85 gate must stay closed for it.
    expect(await isKnownDeadHost("blocked.example")).toBe(false);
  });

  it("an expired window re-earns one full crawl attempt", async () => {
    await recordHostLiveness("stale-blocked.example", "stale", {
      domain: "stale-blocked.example",
      label: "unreachable",
      score: 35,
      evidence: [],
    });
    expect(
      await isKnownUnreachableHost("stale-blocked.example", -1),
    ).toBe(false);
  });

  it("non-unreachable labels never hit the tier-5 gate", async () => {
    await recordHostLiveness("alive.example", "alive", {
      domain: "alive.example",
      label: "alive",
      score: 5,
      evidence: [],
    });
    expect(await isKnownUnreachableHost("alive.example")).toBe(false);
    await recordHostLiveness("gone.example", "gone", {
      domain: "gone.example",
      label: "unregistered",
      score: 95,
      evidence: [],
    });
    // Defunct hosts route through isKnownDeadHost, not the tier-5 window.
    expect(await isKnownUnreachableHost("gone.example")).toBe(false);
  });
});


