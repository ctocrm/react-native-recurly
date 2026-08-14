import {
    generateDeterministicGuesses,
    isExcludedDomain,
    pickOfficialDomain,
    rankOfficialDomainCandidates,
    scoreDomainMatch,
} from "../domainDiscovery";

describe("domainDiscovery (pure, provider-independent)", () => {
  describe("isExcludedDomain", () => {
    it("rejects search engines", () => {
      expect(isExcludedDomain("www.google.com").excluded).toBe(true);
      expect(isExcludedDomain("duckduckgo.com").excluded).toBe(true);
      expect(isExcludedDomain("bing.com").excluded).toBe(true);
    });
    it("rejects social networks", () => {
      expect(isExcludedDomain("www.facebook.com").excluded).toBe(true);
      expect(isExcludedDomain("twitter.com").excluded).toBe(true);
      expect(isExcludedDomain("www.linkedin.com").excluded).toBe(true);
    });
    it("rejects encyclopedias and code hosts (Tranche A F12)", () => {
      expect(isExcludedDomain("en.wikipedia.org").excluded).toBe(true);
      expect(isExcludedDomain("commons.wikimedia.org").excluded).toBe(true);
      expect(isExcludedDomain("github.com").excluded).toBe(true);
    });
    it("rejects app stores and aggregators (Tranche A F1)", () => {
      expect(isExcludedDomain("apps.microsoft.com").excluded).toBe(true);
      expect(isExcludedDomain("play.google.com").excluded).toBe(true);
      expect(isExcludedDomain("www.crunchbase.com").excluded).toBe(true);
    });
    it("accepts a plausible brand domain", () => {
      expect(isExcludedDomain("netflix.com").excluded).toBe(false);
      expect(isExcludedDomain("acehardware.com").excluded).toBe(false);
      expect(isExcludedDomain("ground.news").excluded).toBe(false);
    });
  });

  describe("scoreDomainMatch", () => {
    it("scores exact left-label match highest", () => {
      expect(scoreDomainMatch("netflix", "netflix.com")).toBeGreaterThan(
        scoreDomainMatch("netflix", "whatsonnetflix.com"),
      );
    });
    it("scores brand-prefixed host high", () => {
      expect(
        scoreDomainMatch("acehardware", "acehardware.com"),
      ).toBeGreaterThanOrEqual(80);
    });
    it("scores unrelated host low", () => {
      expect(scoreDomainMatch("le-devoir", "fitliferegime.com")).toBeLessThan(
        40,
      );
    });
  });

  describe("rankOfficialDomainCandidates", () => {
    it("ranks the brand domain above pollution and rejects bad hosts (F1)", () => {
      const ranking = rankOfficialDomainCandidates("netflix", [
        "https://en.wikipedia.org/wiki/Netflix", // encyclopedia -> rejected
        "https://apps.microsoft.com/detail/netflix", // app store -> rejected
        "https://www.whatsonnetflix.com/", // mid-domain match, low
        "https://www.netflix.com/", // exact -> best
      ]);
      expect(ranking.best?.host).toBe("netflix.com");
      expect(ranking.best?.confidence).toBe("high");
      const rejectedHosts = ranking.rejected.map((r) => r.host);
      expect(rejectedHosts).toContain("en.wikipedia.org");
      expect(rejectedHosts).toContain("apps.microsoft.com");
    });

    it("returns null best when nothing clears the threshold", () => {
      const ranking = rankOfficialDomainCandidates("le-devoir", [
        "https://en.wikipedia.org/wiki/Le_Devoir",
        "https://fitliferegime.com/",
      ]);
      expect(ranking.best).toBeNull();
    });
  });

  describe("pickOfficialDomain", () => {
    it("picks the confident brand domain when present", () => {
      const pick = pickOfficialDomain("ground-news", [
        "https://ground.news/",
        "https://en.wikipedia.org/wiki/Ground_News",
      ]);
      expect(pick.url).toContain("ground.news");
      expect(pick.confidence).toBe("high");
    });

    it("falls back to deterministic guess when search yields nothing usable (F5/F12)", () => {
      const pick = pickOfficialDomain("le-devoir", [
        "https://en.wikipedia.org/wiki/Le_Devoir",
      ]);
      // No confident candidate -> deterministic exact match for the brand slug.
      expect(pick.url).toContain("ledevoir.com");
    });
  });

  describe("generateDeterministicGuesses", () => {
    it("produces high-confidence exact matches first", () => {
      const guesses = generateDeterministicGuesses("Netflix");
      expect(guesses[0].url).toBe("https://netflix.com");
      expect(guesses[0].confidence).toBe("high");
    });
    it("returns empty for degenerate brand", () => {
      expect(generateDeterministicGuesses("!!")).toEqual([]);
    });
  });
});
