import { officialHostsForBrand } from "../domain/provenance";
import {
  admitsWithHostCap,
  canCandidateBeatCached,
  classifyTrustedCandidate,
  hasDiscoveryUrlSignal,
  hasLogoSignal,
  isGenericSocialImage,
  isJunkIconFarmHost,
  isPartnerOrUnrelatedMark,
  isPickerPublishableCandidate,
  isPublishableExtractedIcon,
  isUiChromeImage,
  looksLikeDirectImage,
  provenanceRank,
} from "../iconCandidate";

describe("iconCandidate (hop 3 gates)", () => {
  it("treats extension and logo-token URLs as direct images", () => {
    expect(looksLikeDirectImage("https://cdn.example/a.webp")).toBe(true);
    expect(looksLikeDirectImage("https://cdn.example/brand/logo")).toBe(true);
    expect(looksLikeDirectImage("https://acehardware.com/about")).toBe(false);
  });

  it("flags generic social/share images unless a logo token is present", () => {
    expect(
      isGenericSocialImage("https://proton.me/og-image.jpg", "og_image"),
    ).toBe(true);
    expect(isGenericSocialImage("https://proton.me/logo.svg", "og_image")).toBe(
      false,
    );
  });

  it("requires a logo signal for OG / Twitter / generic JSON-LD image", () => {
    expect(
      isPublishableExtractedIcon(
        "https://proton.me/share-card.jpg",
        "og_image",
      ),
    ).toBe(false);
    expect(
      isPublishableExtractedIcon(
        "https://proton.me/assets/logo.png",
        "og_image",
      ),
    ).toBe(true);
    expect(
      isPublishableExtractedIcon("https://proton.me/hero.jpg", "jsonld_image"),
    ).toBe(false);
    expect(
      isPublishableExtractedIcon(
        "https://proton.me/apple-touch-icon.png",
        "apple_touch_icon",
      ),
    ).toBe(true);
    expect(hasLogoSignal("https://x.com/a/jsonld_logo.svg", "jsonld_logo")).toBe(
      true,
    );
  });

  it("rejects first-party news/OG photos even when tagged official_site", () => {
    expect(
      isGenericSocialImage(
        "https://x.ai/images/news/grok-bot-more-plans-og.webp",
        "official_site",
      ),
    ).toBe(true);
    expect(
      isPublishableExtractedIcon(
        "https://x.ai/images/news/grok-bot-more-plans-og.webp",
        "official_site",
      ),
    ).toBe(false);
    expect(
      isPublishableExtractedIcon(
        "https://x.ai/images/news/grok-bot-more-plans-og.webp 5120w",
        "official_site",
      ),
    ).toBe(false);
    expect(
      isPublishableExtractedIcon("https://x.ai/icon.png", "favicon"),
    ).toBe(true);
    expect(
      isPublishableExtractedIcon(
        "https://x.ai/apple-icon.png",
        "apple_touch_icon",
      ),
    ).toBe(true);
  });

  it("rejects untrusted random-domain images and accepts brand-token URLs", () => {
    const hosts = officialHostsForBrand("netflix", "netflix.com");
    const random = classifyTrustedCandidate(
      "netflix",
      hosts,
      "https://fitliferegime.com/wp-content/uploads/Inchworm.webp",
    );
    expect(random.trusted).toBe(false);
    const token = classifyTrustedCandidate(
      "acehardware",
      officialHostsForBrand("acehardware"),
      "https://cdn.example/logos/acehardware-logo.png",
    );
    expect(token.trusted).toBe(true);
    expect(provenanceRank("official")).toBeGreaterThan(
      provenanceRank("library"),
    );
    expect(provenanceRank("library")).toBeGreaterThan(
      provenanceRank("brand-token"),
    );
  });

  it("does not treat leftover 1–2 letter slugs as brand-token evidence", () => {
    const leftover = classifyTrustedCandidate(
      "ne",
      officialHostsForBrand("ne"),
      "https://dotnet.microsoft.com/favicon.ico",
    );
    expect(leftover.trusted).toBe(false);
    expect(leftover.prov).toBe("untrusted");
  });

  it("rejects header chrome and Ace header SVGs", () => {
    expect(
      isUiChromeImage(
        "https://acehardware.com/on/demandware.static/-/Sites/default/dw/images/header-circle-user-regular.svg",
      ),
    ).toBe(true);
    expect(
      isPublishableExtractedIcon(
        "https://acehardware.com/on/demandware.static/-/Sites/default/dw/images/header-circle-user-regular.svg",
        "img_logo",
      ),
    ).toBe(false);
    expect(
      isUiChromeImage("https://acehardware.com/assets/logo.svg", "img_logo"),
    ).toBe(false);
  });

  it("rejects a partner mark on the official host", () => {
    const hosts = officialHostsForBrand("acehardware", "acehardware.com");
    const partner = classifyTrustedCandidate(
      "acehardware",
      hosts,
      "https://acehardware.com/on/demandware.static/scotts-logo.png",
    );
    expect(partner.trusted).toBe(false);
    const own = classifyTrustedCandidate(
      "acehardware",
      hosts,
      "https://acehardware.com/on/demandware.static/ace-logo.png",
    );
    expect(own.trusted).toBe(true);
  });

  it("keeps Ace first-party PWA icons and still rejects Bing photos", () => {
    const hosts = officialHostsForBrand("acehardware", "acehardware.com");
    expect(
      isPickerPublishableCandidate(
        "acehardware",
        hosts,
        "https://cdn-tp3.mozu.com/24645-37138/resources/images/icons/icon-192x192.png",
        "spider:web_manifest",
      ),
    ).toBe(true);
    expect(
      isPickerPublishableCandidate(
        "acehardware",
        hosts,
        "https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/e0429dbd/yuji.jpg",
        "bing_images",
      ),
    ).toBe(false);
    expect(
      isPickerPublishableCandidate(
        "acehardware",
        hosts,
        "https://acehardware.com/on/demandware.static/scotts-logo.png",
        "spider:img_logo",
      ),
    ).toBe(false);
  });
});

describe("iconCandidate (G1 admission filters, data-driven from G0)", () => {
  it("rejects the junk PNG farms observed fetching brand-named files in G0", () => {
    for (const url of [
      "https://www.pngmart.com/files/23/Gmail-Logo-PNG.png",
      "https://logodownload.org/wp-content/uploads/2021/04/coinbase-logo.png",
      "https://logos-world.net/wp-content/uploads/2023/02/Coinbase-Logo.png",
      "https://www.pngimg.com/uploads/uber/uber_PNG15.png",
      "https://www.pngall.com/wp-content/uploads/4/LinkedIn-Logo.png",
      "https://www.freeiconspng.com/uploads/linkedin-logo-3.png",
      "https://latestlogo.com/wp-content/uploads/2023/02/x-logo.png",
      "https://cdn.creazilla.com/icons/3433780/airbnb-icon-md.png",
      "https://cdn.freebiesupply.com/images/large/2x/airbnb-logo.png",
      "https://www.stickpng.com/assets/icons/uber",
    ]) {
      expect(isJunkIconFarmHost(url)).toBe(true);
    }
  });

  it("keeps official, library, and ordinary-brand hosts", () => {
    expect(isJunkIconFarmHost("https://github.com/apple-touch-icon.png")).toBe(
      false,
    );
    expect(isJunkIconFarmHost("https://i.dell.com/assets/logo.png")).toBe(false);
    expect(
      isJunkIconFarmHost("https://img.icons8.com/color/512/github.png"),
    ).toBe(false);
    expect(
      isJunkIconFarmHost("https://www.thestreet.com/.image/t_share/some.png"),
    ).toBe(false);
  });

  it("requires a URL logo signal for brand-token discovery candidates", () => {
    // G0: a news photo matched the brand token and was auto-assigned.
    expect(
      hasDiscoveryUrlSignal("https://media.reclaimthenet.org/2023/11/tuta.jpg"),
    ).toBe(false);
    expect(hasDiscoveryUrlSignal("https://www.porkbun.design/logo.svg")).toBe(
      true,
    );
    expect(
      hasDiscoveryUrlSignal("https://cdn.example/tuta/apple-touch-icon.png"),
    ).toBe(true);
  });

  it("caps non-official hosts at 3 admits per crawl (official exempt)", () => {
    const officialHosts = new Set(["example.com"]);
    const counts = new Map<string, number>();
    expect(admitsWithHostCap("https://a.io/1.png", officialHosts, counts)).toBe(
      true,
    );
    expect(admitsWithHostCap("https://a.io/2.png", officialHosts, counts)).toBe(
      true,
    );
    expect(admitsWithHostCap("https://a.io/3.png", officialHosts, counts)).toBe(
      true,
    );
    expect(admitsWithHostCap("https://a.io/4.png", officialHosts, counts)).toBe(
      false,
    );
    // www variants count toward the same host
    expect(
      admitsWithHostCap("https://www.a.io/5.png", officialHosts, counts),
    ).toBe(false);
    // official host is exempt from the cap
    expect(
      admitsWithHostCap("https://example.com/a.png", officialHosts, counts),
    ).toBe(true);
    expect(
      admitsWithHostCap("https://www.example.com/b.png", officialHosts, counts),
    ).toBe(true);
    // unparseable URLs are not admitted
    expect(admitsWithHostCap("not-a-url", officialHosts, counts)).toBe(false);
  });

  it("never re-fetches a candidate whose source cannot beat the cache", () => {
    // The G0 pathology: bing_images refetched to compare against bing_images.
    expect(canCandidateBeatCached("bing_images", "bing_images")).toBe(false);
    expect(canCandidateBeatCached("web_search", "bing_images")).toBe(false);
    expect(canCandidateBeatCached("bing_images", null)).toBe(true);
    expect(canCandidateBeatCached("web_search", "")).toBe(true);
    // library / official sources outrank generic discovery
    expect(canCandidateBeatCached("icons8", "bing_images")).toBe(true);
    expect(canCandidateBeatCached("official_domain", "bing_images")).toBe(true);
    expect(canCandidateBeatCached("bing_images", "official_favicon")).toBe(
      false,
    );
    expect(canCandidateBeatCached("favicon", "icons8")).toBe(false);
    // first-party spider extracts outrank generic discovery
    expect(canCandidateBeatCached("spider:web_manifest", "bing_images")).toBe(
      true,
    );
    expect(
      canCandidateBeatCached("spider:favicon", "spider:web_manifest"),
    ).toBe(false);
    // an unknown source cannot beat anything with a rank
    expect(canCandidateBeatCached("", "favicon")).toBe(false);
  });
});

describe("isPartnerOrUnrelatedMark (I1)", () => {
  it("flags the tuta.com EU-SME-alliance partner badge", () => {
    expect(
      isPartnerOrUnrelatedMark(
        "tuta",
        "https://tuta.com/assets/european_digital_sme_alliance_logo.DVqbPoKQ.png",
      ),
    ).toBe(true);
  });

  it("flags Forbes logo hosted on porkbun.com", () => {
    expect(
      isPartnerOrUnrelatedMark(
        "porkbun",
        "https://porkbun.com/images/Forbes_logo.png",
      ),
    ).toBe(true);
  });

  it("keeps the brand's own favicon and wordmark assets", () => {
    expect(
      isPartnerOrUnrelatedMark(
        "tuta",
        "https://tuta.com/favicon/logo-favicon-192.png",
      ),
    ).toBe(false);
    expect(
      isPartnerOrUnrelatedMark(
        "porkbun",
        "https://porkbun.com/images/porkbun-logo-1200x1200.png",
      ),
    ).toBe(false);
  });
});
