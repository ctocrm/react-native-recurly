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
      expect(ai).toBe(10080);
      expect(manual).toBe(5080);
      expect(ai).toBeGreaterThan(manual);
      expect(manual).toBeGreaterThan(plain);
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
