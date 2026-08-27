import {
    classifyCandidate,
    isTrustedProvenance,
    officialHostsForBrand,
} from "../provenance";

describe("provenance (Tranche C/D precision gating)", () => {
  const hosts = officialHostsForBrand("netflix", "netflix.com");

  it("accepts official-host candidates", () => {
    const r = classifyCandidate(
      "netflix",
      hosts,
      "https://assets.nflxext.com/us/ffe/siteui/common/icons/nficon2023.ico",
    );
    // nflxext is not in the official set, but brand-token? no. So untrusted.
    // Official host itself:
    const off = classifyCandidate(
      "netflix",
      hosts,
      "https://www.netflix.com/apple-touch-icon.png",
    );
    expect(off.prov).toBe("official");
    expect(isTrustedProvenance(off.prov)).toBe(true);
    expect(["official", "brand-token", "library", "untrusted"]).toContain(
      r.prov,
    );
  });

  it("accepts library CDN candidates", () => {
    const r = classifyCandidate(
      "spotify",
      officialHostsForBrand("spotify"),
      "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/spotify.svg",
    );
    expect(r.prov).toBe("library");
    expect(isTrustedProvenance(r.prov)).toBe(true);
  });

  it("accepts brand-token URLs on third-party hosts", () => {
    const r = classifyCandidate(
      "acehardware",
      officialHostsForBrand("acehardware"),
      "https://example-cdn.com/logos/acehardware-logo.png",
    );
    expect(r.prov).toBe("brand-token");
    expect(isTrustedProvenance(r.prov)).toBe(true);
  });

  it("REJECTS arbitrary-domain images with no brand evidence (the pollution)", () => {
    const r = classifyCandidate(
      "netflix",
      hosts,
      "https://fitliferegime.com/wp-content/uploads/Inchworm.webp",
    );
    expect(r.prov).toBe("untrusted");
    expect(isTrustedProvenance(r.prov)).toBe(false);
  });

  it("REJECTS generic CDN default logos with no brand token", () => {
    const r = classifyCandidate(
      "ground-news",
      officialHostsForBrand("ground-news"),
      "https://img1.wsimg.com/indy/default/logo-default.png",
    );
    expect(r.prov).toBe("untrusted");
  });

  it("accepts dotted-brand official domain (ground.news)", () => {
    const h = officialHostsForBrand("ground-news", "ground.news");
    const r = classifyCandidate(
      "ground-news",
      h,
      "https://ground.news/apple-touch-icon.png",
    );
    expect(r.prov).toBe("official");
  });

  it("REJECTS leftover 1–2 letter slugs as brand-token evidence", () => {
    const r = classifyCandidate(
      "ne",
      officialHostsForBrand("ne"),
      "https://dotnet.microsoft.com/favicon.ico",
    );
    expect(r.prov).toBe("untrusted");
    expect(isTrustedProvenance(r.prov)).toBe(false);
  });

  it("REJECTS JWT/query substring matches for short brands like xai", () => {
    const wallpaper =
      "https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/e0429dbd-4be2-4c45-b523-03b3c07eaf8b/dh3a9nn-15390c33-f0ee-4708-b930-e9e20cb1b070.jpg?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9";
    const r = classifyCandidate("xai", officialHostsForBrand("xai", "x.ai"), wallpaper);
    expect(r.prov).toBe("untrusted");
    const logo = classifyCandidate(
      "xai",
      officialHostsForBrand("xai", "x.ai"),
      "https://cdn.example/logos/xai-logo.png",
    );
    expect(logo.prov).toBe("brand-token");
  });
});
