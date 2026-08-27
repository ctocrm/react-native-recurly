import {
  officialDomainFromAddress,
  officialHostFromCompoundSlug,
  sanitizeOfficialHost,
} from "../officialDomain";

describe("officialDomain (Hop 1 scan seed)", () => {
  it("keeps proton.me from a Proton From address", () => {
    expect(officialDomainFromAddress("Proton <noreply@proton.me>")).toBe(
      "proton.me",
    );
  });

  it("peels mailer labels down to the brand host", () => {
    expect(sanitizeOfficialHost("mail.proton.me")).toBe("proton.me");
    expect(sanitizeOfficialHost("billing.linear.app")).toBe("linear.app");
  });

  it("rejects ESP and payment-processor hosts", () => {
    expect(sanitizeOfficialHost("em1234.mailgun.org")).toBeNull();
    expect(sanitizeOfficialHost("stripe.com")).toBeNull();
    expect(officialDomainFromAddress("Stripe <receipts@stripe.com>")).toBeNull();
  });

  it("keeps dotted brand TLDs", () => {
    expect(officialDomainFromAddress("hello@linear.app")).toBe("linear.app");
    expect(officialDomainFromAddress("billing@x.ai")).toBe("x.ai");
    expect(officialDomainFromAddress("GitHub <noreply@github.com>")).toBe(
      "github.com",
    );
  });

  it("reconstructs x.ai from crawl slug xai", () => {
    expect(officialHostFromCompoundSlug("xai")).toBe("x.ai");
    expect(officialHostFromCompoundSlug("okai")).toBe("ok.ai");
    expect(officialHostFromCompoundSlug("proton")).toBeNull();
    expect(officialHostFromCompoundSlug("home")).toBeNull();
    expect(officialHostFromCompoundSlug("figma")).toBeNull();
    expect(officialHostFromCompoundSlug("netflix")).toBeNull();
  });
});
