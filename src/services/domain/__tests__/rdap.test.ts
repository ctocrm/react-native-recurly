import {
  brandTokenOverlap,
  domainMatchesHost,
  lookupRdapOrg,
  parseRdapBootstrap,
  rdapCorroborateBrand,
  registeredDomainOf,
  registrantOrgFromRdap,
  tldOfDomain,
  type FetchImpl,
} from "../rdap";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const BOOTSTRAP = {
  version: "1.0",
  services: [
    [["com", "net"], ["https://rdap.verisign.com/com/v1/"]],
    [["io"], ["https://rdap.identitydigital.services/rdap/"]],
    [["co"], ["https://rdap.nic.co/domain/"]],
    [["uk"], ["https://rdap.nominet.uk/"]],
  ],
};

const ZOHO_RDAP = {
  ldhName: "zoho.com",
  entities: [
    {
      roles: ["registrant"],
      vcardArray: [
        "vcard",
        [
          ["version", {}, "text", "4.0"],
          ["org", {}, "text", "ZOHO Corporation"],
          ["fn", {}, "text", "Zoho Private Ltd"],
        ],
      ],
    },
  ],
};

describe("rdap (Phase D corroboration evidence)", () => {
  describe("parseRdapBootstrap", () => {
    it("maps tlds to rdap bases, normalizing leading dots", () => {
      const map = parseRdapBootstrap(BOOTSTRAP);
      expect(map.get("com")).toEqual(["https://rdap.verisign.com/com/v1/"]);
      expect(map.get("io")).toHaveLength(1);
      expect(map.get("co")).toHaveLength(1);
      expect(map.get("uk")).toHaveLength(1);
    });
    it("returns an empty map for malformed input", () => {
      expect(parseRdapBootstrap({}).size).toBe(0);
      expect(parseRdapBootstrap(null).size).toBe(0);
      expect(parseRdapBootstrap({ services: "nope" }).size).toBe(0);
    });
  });

  describe("tldOfDomain / registeredDomainOf / domainMatchesHost", () => {
    it("extracts the bootstrap tld", () => {
      expect(tldOfDomain("zoho.com")).toBe("com");
      expect(tldOfDomain("x.AI")).toBe("ai");
      expect(tldOfDomain("bit.io")).toBe("io");
    });
    it("reduces hosts to the registrable domain", () => {
      expect(registeredDomainOf("accounts.zoho.com")).toBe("zoho.com");
      expect(registeredDomainOf("WWW.Foo.Co.UK")).toBe("foo.co.uk");
      expect(registeredDomainOf("localhost")).toBeNull();
    });
    it("matches From-hosts against the registered domain", () => {
      expect(domainMatchesHost("zoho.com", "zoho.com")).toBe(true);
      expect(domainMatchesHost("zoho.com", "mail.zoho.com")).toBe(true);
      expect(domainMatchesHost("zoho.com", "www.zoho.com")).toBe(true);
      expect(domainMatchesHost("zoho.com", "zohomail.com")).toBe(false);
      expect(domainMatchesHost("zoho.com", null)).toBe(false);
    });
  });

  describe("registrantOrgFromRdap", () => {
    it("reads the registrant vcard org", () => {
      expect(registrantOrgFromRdap(ZOHO_RDAP)).toBe("ZOHO Corporation");
    });
    it("falls back to registrant fn when org is absent", () => {
      expect(
        registrantOrgFromRdap({
          entities: [
            {
              roles: ["registrant"],
              vcardArray: ["vcard", [["fn", {}, "text", "Linode, LLC"]]],
            },
          ],
        }),
      ).toBe("Linode, LLC");
    });
    it("finds nested registrant entities", () => {
      expect(
        registrantOrgFromRdap({
          entities: [
            {
              roles: ["administrative"],
              entities: [
                {
                  roles: ["registrant"],
                  vcardArray: ["vcard", [["org", {}, "text", "Nested Ltd"]]],
                },
              ],
            },
          ],
        }),
      ).toBe("Nested Ltd");
    });
    it("returns null without a registrant", () => {
      expect(
        registrantOrgFromRdap({ entities: [{ roles: ["admin"] }] }),
      ).toBeNull();
      expect(registrantOrgFromRdap({})).toBeNull();
    });
  });

  describe("brandTokenOverlap", () => {
    it("matches compound slugs against org tokens", () => {
      expect(brandTokenOverlap("zohoaccounts", "ZOHO Corporation")).toEqual([
        "zoho",
      ]);
      expect(brandTokenOverlap("openai", "OpenAI Holdings, LLC")).toEqual([
        "openai",
      ]);
    });
    it("never counts tokens under 3 chars", () => {
      expect(brandTokenOverlap("xai", "X Development LLC")).toEqual([]);
    });
    it("returns empty on unrelated orgs", () => {
      expect(brandTokenOverlap("linode", "Proton AG")).toEqual([]);
      expect(brandTokenOverlap("linode", null)).toEqual([]);
    });
  });

  describe("lookupRdapOrg", () => {
    it("bootstraps once then queries the tld's rdap base", async () => {
      const calls: string[] = [];
      const impl: FetchImpl = async (url) => {
        calls.push(url);
        if (url.includes("iana.org")) return jsonResponse(BOOTSTRAP);
        if (url.startsWith("https://rdap.verisign.com/com/v1/")) {
          return jsonResponse(ZOHO_RDAP);
        }
        throw new Error(`unexpected ${url}`);
      };
      const first = await lookupRdapOrg("zoho.com", impl);
      expect(first).toEqual({ org: "ZOHO Corporation" });
      const second = await lookupRdapOrg("zoho.com", impl);
      expect(second).toEqual({ org: "ZOHO Corporation" });
      const bootstrapCalls = calls.filter((u) => u.includes("iana.org"));
      expect(bootstrapCalls).toHaveLength(1);
      expect(calls).toContain(
        "https://rdap.verisign.com/com/v1/domain/zoho.com",
      );
    });
    it("selects oddball tld bases (.io / .co)", async () => {
      const calls: string[] = [];
      const impl: FetchImpl = async (url) => {
        calls.push(url);
        if (url.includes("iana.org")) return jsonResponse(BOOTSTRAP);
        return jsonResponse({ entities: [] });
      };
      await lookupRdapOrg("nektos.io", impl);
      await lookupRdapOrg("porkbun.co", impl);
      expect(
        calls.some(
          (u) => u.includes("identitydigital") && u.includes("nektos.io"),
        ),
      ).toBe(true);
      expect(
        calls.some((u) => u.startsWith("https://rdap.nic.co/domain/")),
      ).toBe(true);
    });
    it("returns null org for 404 without throwing", async () => {
      const impl: FetchImpl = async (url) => {
        if (url.includes("iana.org")) return jsonResponse(BOOTSTRAP);
        return jsonResponse({ errorCode: 404 }, 404);
      };
      await expect(lookupRdapOrg("nobody.com", impl)).resolves.toEqual({
        org: null,
      });
    });
    it("returns null on network failure or unknown tld", async () => {
      const failing: FetchImpl = async () => {
        throw new Error("offline");
      };
      await expect(lookupRdapOrg("zoho.com", failing)).resolves.toBeNull();
      const bootstrapOnly: FetchImpl = async (url) => {
        if (url.includes("iana.org")) return jsonResponse(BOOTSTRAP);
        throw new Error("should not be called");
      };
      await expect(
        lookupRdapOrg("example.museumtld", bootstrapOnly),
      ).resolves.toBeNull();
    });
  });

  describe("rdapCorroborateBrand", () => {
    const implFor =
      (rdapBody: unknown): FetchImpl =>
      async (url) => {
        if (url.includes("iana.org")) return jsonResponse(BOOTSTRAP);
        return jsonResponse(rdapBody);
      };

    it("corroborates via org overlap and logs the evidence line", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const result = await rdapCorroborateBrand(
        "zohoaccounts",
        "accounts.zoho.com",
        "mail.zoho.com",
        implFor(ZOHO_RDAP),
      );
      expect(result?.corroborates).toBe(true);
      expect(result?.orgTokenOverlap).toEqual(["zoho"]);
      expect(result?.domainMatchesFromHost).toBe(true);
      expect(result?.reason).toContain("org tokens match");
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("[RDAP] lookup zoho.com"),
      );
      logSpy.mockRestore();
    });
    it("corroborates via From-host match even without org overlap", async () => {
      const result = await rdapCorroborateBrand(
        "linode",
        "linode.com",
        "billing.linode.com",
        implFor({
          entities: [
            {
              roles: ["registrant"],
              vcardArray: [
                "vcard",
                [["org", {}, "text", "Akamai Technologies"]],
              ],
            },
          ],
        }),
      );
      expect(result?.corroborates).toBe(true);
      expect(result?.orgTokenOverlap).toEqual([]);
    });
    it("reports non-corroboration when nothing matches", async () => {
      const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
      const result = await rdapCorroborateBrand(
        "linode",
        "linode.com",
        null,
        implFor(ZOHO_RDAP),
      );
      expect(result?.corroborates).toBe(false);
      expect(result?.domainMatchesFromHost).toBeNull();
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("corroborates=no"),
      );
      logSpy.mockRestore();
    });
    it("returns null when the lookup infrastructure fails", async () => {
      const failing: FetchImpl = async () => {
        throw new Error("offline");
      };
      await expect(
        rdapCorroborateBrand("linode", "linode.com", null, failing),
      ).resolves.toBeNull();
    });
  });
});
