import {
  pickBestIcon,
  scoreIconQuality,
  sortUrlsByQuality,
} from "../iconQuality";

describe("iconQuality (pure functions)", () => {
  describe("scoreIconQuality", () => {
    it("scores SVG highest", () => {
      expect(
        scoreIconQuality({
          source: "unknown",
          format: "svg",
          originalUrl: "https://example.com/icon.svg",
        }),
      ).toBeGreaterThan(
        scoreIconQuality({
          source: "unknown",
          format: "png",
          originalUrl: "https://example.com/icon.png",
        }),
      );
    });

    it("scores known libraries high", () => {
      const base = {
        format: "svg",
        originalUrl: "https://example.com/icon.svg",
      };
      expect(
        scoreIconQuality({ source: "simple-icons", ...base }),
      ).toBeGreaterThan(scoreIconQuality({ source: "random", ...base }));
    });

    it("scores apple-touch and android-chrome high", () => {
      expect(
        scoreIconQuality({
          source: "",
          format: "png",
          originalUrl: "https://example.com/apple-touch-icon.png",
        }),
      ).toBeGreaterThan(
        scoreIconQuality({
          source: "",
          format: "png",
          originalUrl: "https://example.com/favicon.ico",
        }),
      );
      expect(
        scoreIconQuality({
          source: "",
          format: "png",
          originalUrl: "https://example.com/android-chrome-192x192.png",
        }),
      ).toBeGreaterThan(
        scoreIconQuality({
          source: "",
          format: "png",
          originalUrl: "https://example.com/favicon.ico",
        }),
      );
    });

    it("scores by dimensions", () => {
      const base = {
        source: "",
        format: "png",
        originalUrl: "https://example.com/icon.png",
      };
      expect(
        scoreIconQuality({ originalWidth: 512, originalHeight: 512, ...base }),
      ).toBeGreaterThan(
        scoreIconQuality({ originalWidth: 64, originalHeight: 64, ...base }),
      );
      expect(
        scoreIconQuality({ originalWidth: 16, originalHeight: 16, ...base }),
      ).toBeLessThan(
        scoreIconQuality({ originalWidth: 32, originalHeight: 32, ...base }),
      );
    });

    it("scores ai_upscale and subscription highest", () => {
      // Characterization of CURRENT behavior (Tranche A baseline):
      // ai_upscale gets +10000, subscription gets +5000, so the
      // current ordering is ai_upscale > subscription > everything else.
      const ai = scoreIconQuality({
        source: "ai_upscale",
        format: "png",
        originalUrl: "https://example.com/icon.png",
      });
      const manual = scoreIconQuality({
        source: "subscription",
        format: "png",
        originalUrl: "https://example.com/icon.png",
      });
      const plain = scoreIconQuality({
        source: "web_search",
        format: "png",
        originalUrl: "https://example.com/icon.png",
      });
      expect(ai).toBeGreaterThan(manual);
      expect(manual).toBeGreaterThan(plain);
    });

    it("ranks official provenance above a large untrusted social image", () => {
      const officialTiny = scoreIconQuality({
        source: "official_apple_touch",
        format: "png",
        originalUrl: "https://proton.me/apple-touch-icon.png",
        brand: "proton",
        officialHost: "proton.me",
        originalWidth: 32,
        originalHeight: 32,
      });
      const socialHuge = scoreIconQuality({
        source: "og_image",
        format: "png",
        originalUrl: "https://random.example/og-image.png",
        brand: "proton",
        officialHost: "proton.me",
        originalWidth: 1200,
        originalHeight: 630,
      });
      expect(officialTiny).toBeGreaterThan(socialHuge);
    });

    it("ranks a first-party icon above a first-party news OG photo", () => {
      const officialIcon = scoreIconQuality({
        source: "official_favicon",
        format: "png",
        originalUrl: "https://x.ai/icon.png",
        brand: "xai",
        officialHost: "x.ai",
        originalWidth: 512,
        originalHeight: 512,
      });
      const newsOg = scoreIconQuality({
        source: "official_site",
        format: "webp",
        originalUrl: "https://x.ai/images/news/grok-bot-more-plans-og.webp",
        brand: "xai",
        officialHost: "x.ai",
        originalWidth: 1200,
        originalHeight: 630,
      });
      expect(officialIcon).toBeGreaterThan(newsOg);
    });

    it("ranks official x.ai apple-touch above a huge Bing wallpaper", () => {
      const official = scoreIconQuality({
        source: "official_apple_touch",
        format: "png",
        originalUrl: "https://x.ai/apple-icon.png",
        brand: "xai",
        officialHost: "x.ai",
        originalWidth: 180,
        originalHeight: 180,
      });
      const bing = scoreIconQuality({
        source: "bing_images",
        format: "jpg",
        originalUrl:
          "https://images-wixmp-ed30a86b8c4ca887773594c2.wixmp.com/f/e0429dbd/yuji.jpg?token=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9",
        brand: "xai",
        officialHost: "x.ai",
        originalWidth: 1920,
        originalHeight: 1076,
      });
      expect(official).toBeGreaterThan(bing);
    });

    it("does not prefer a tiny favicon over a large official logo", () => {
      const lockup = scoreIconQuality({
        source: "official_img_logo",
        format: "png",
        originalUrl: "https://acehardware.com/assets/ace-logo.png",
        brand: "acehardware",
        officialHost: "acehardware.com",
        originalWidth: 512,
        originalHeight: 512,
        imageDataLength: 40_000,
      });
      const favicon = scoreIconQuality({
        source: "favicon",
        format: "ico",
        originalUrl: "https://acehardware.com/favicon.ico",
        brand: "acehardware",
        officialHost: "acehardware.com",
        originalWidth: 16,
        originalHeight: 16,
        imageDataLength: 800,
      });
      expect(lockup).toBeGreaterThan(favicon);
    });

    it("ranks Ace homepage PWA icons above a leftover tiny favicon", () => {
      const pwa = scoreIconQuality({
        source: "spider:web_manifest",
        format: "png",
        originalUrl:
          "https://cdn-tp3.mozu.com/24645-37138/resources/images/icons/icon-192x192.png",
        brand: "acehardware",
        officialHost: "acehardware.com",
        originalWidth: 192,
        originalHeight: 192,
        imageDataLength: 18_480,
      });
      const favicon = scoreIconQuality({
        source: "favicon",
        format: "ico",
        originalUrl: "https://acehardware.com/favicon.ico",
        brand: "acehardware",
        officialHost: "acehardware.com",
        originalWidth: 16,
        originalHeight: 16,
        imageDataLength: 800,
      });
      expect(pwa).toBeGreaterThan(favicon);
    });
  });

  describe("pickBestIcon", () => {
    it("picks the highest scored icon", () => {
      const icons = [
        { source: "unknown", format: "png", originalUrl: "url1" },
        { source: "simple-icons", format: "svg", originalUrl: "url2" }, // should win
        { source: "unknown", format: "png", originalUrl: "url3" },
      ];
      const best = pickBestIcon(icons);
      expect(best?.source).toBe("simple-icons");
    });

    it("returns null for empty array", () => {
      expect(pickBestIcon([])).toBeNull();
    });
  });

  describe("sortUrlsByQuality", () => {
    it("sorts by quality descending", () => {
      const urls = [
        {
          url: "https://example.com/favicon.ico",
          source: "web_search",
          format: "ico",
        },
        {
          url: "https://example.com/apple-touch-icon.png",
          source: "web_search",
          format: "png",
        },
        {
          url: "https://example.com/icon.svg",
          source: "simple-icons",
          format: "svg",
        },
      ];
      const sorted = sortUrlsByQuality(urls);
      expect(sorted[0].source).toBe("simple-icons"); // SVG should be first
      expect(sorted[1].source).toBe("web_search"); // apple-touch second
      expect(sorted[2].source).toBe("web_search"); // ico last
    });
  });
});
