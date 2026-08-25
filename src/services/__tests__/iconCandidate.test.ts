import { officialHostsForBrand } from "../domain/provenance";
import {
  classifyTrustedCandidate,
  hasLogoSignal,
  isGenericSocialImage,
  isPublishableExtractedIcon,
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
    expect(
      isGenericSocialImage("https://proton.me/logo.svg", "og_image"),
    ).toBe(false);
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
      isPublishableExtractedIcon(
        "https://proton.me/hero.jpg",
        "jsonld_image",
      ),
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
    expect(provenanceRank("official")).toBeGreaterThan(provenanceRank("library"));
    expect(provenanceRank("library")).toBeGreaterThan(
      provenanceRank("brand-token"),
    );
  });
});
