import { officialHostsForBrand } from "../domain/provenance";
import {
  classifyTrustedCandidate,
  hasLogoSignal,
  isGenericSocialImage,
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
