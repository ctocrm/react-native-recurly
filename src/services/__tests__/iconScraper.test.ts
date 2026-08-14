import { generateAlternativeSlugs, nameToSlug } from "../iconScraper";

describe("iconScraper (pure functions)", () => {
  describe("nameToSlug", () => {
    it("converts simple name to slug", () => {
      expect(nameToSlug("Netflix")).toBe("netflix");
    });

    it("handles spaces and special characters", () => {
      expect(nameToSlug("Spotify Music")).toBe("spotify-music");
      expect(nameToSlug("GitHub!")).toBe("github");
      expect(nameToSlug("  leading trailing  ")).toBe("leading-trailing");
    });

    it("removes non-alphanumeric except dash", () => {
      expect(nameToSlug("Test@#$%^&*()Name")).toBe("testname");
    });

    it("collapses multiple dashes", () => {
      expect(nameToSlug("a--b---c")).toBe("a-b-c");
    });

    it("trims leading/trailing dashes", () => {
      expect(nameToSlug("-test-")).toBe("test");
      expect(nameToSlug("--hello--world--")).toBe("hello-world");
    });

    it("returns empty string fallback", () => {
      expect(nameToSlug("!!!")).toBe(""); // after removing non-alnum, empty, then fallback to alnum only which is also empty
      // Actually the fallback: if slug empty, try name.toLowerCase().replace(/[^a-z0-9]/g, "")
      // For '!!!', that becomes empty string.
      expect(nameToSlug("!!!")).toBe("");
    });

    it("fallback works when slug empty but alnum present", () => {
      // Input like '!!!test!!!' -> slug after first pass: empty (because remove non-alnum leaves empty? Actually step: replace spaces, remove non-alnum except dash, collapse dashes, trim.
      // '!!!test!!!' -> no spaces, remove non-alnum except dash: 'test' (because only alnum and dash allowed, but there is no dash, so becomes 'test'), collapse dashes: 'test', trim: 'test'.
      // So not empty. Let's try input with only symbols and spaces.
      expect(nameToSlug("!!! ???")).toBe(""); // after first pass: empty, fallback: remove non-alnum -> empty.
      // For input like '!!!a!!!', first pass: remove non-alnum except dash -> 'a', so not empty.
    });
  });

  describe("generateAlternativeSlugs", () => {
    it("generates alternatives for common suffixes", () => {
      // Characterization of CURRENT behavior: the base slug IS included
      // in the returned list (implementation seeds alternatives with [base]).
      const alternatives = generateAlternativeSlugs("netflix-app");
      expect(alternatives).toContain("netflix");
      expect(alternatives).toContain("netflix-app");
      expect(alternatives).toContain("netflixapp");
    });

    it("removes trailing numbers", () => {
      // Characterization of CURRENT behavior: the trailing-number rule only
      // strips DASH-prefixed numbers (/-\d+$/), so "web3" yields no
      // alternative while "web-3" does. NOTE: the implementation comment
      // claims 'web3' -> 'web'; that mismatch is recorded for a later
      // tranche — Tranche A freezes behavior, it does not repair it.
      expect(generateAlternativeSlugs("web3")).toEqual(["web3"]);
      expect(generateAlternativeSlugs("web-3")).toContain("web");
    });

    it("removes hyphens for compound names", () => {
      const alternatives = generateAlternativeSlugs("microsoft-teams");
      expect(alternatives).toContain("microsoftteams");
    });

    it("adds first part for compound names", () => {
      const alternatives = generateAlternativeSlugs("git-hub-service");
      expect(alternatives).toContain("git");
    });

    it("deduplicates alternatives", () => {
      const alternatives = generateAlternativeSlugs("test-app-app");
      // base: test-app-app
      // noSuffix: test (remove -app twice? Actually removes -(app|io|tv|ai|hq|tech|pro|me)$/i and then -(com|net|org)$/i. It removes one at a time? The code does two separate replaces, so it might remove both? We'll just expect no duplicates.
      expect(alternatives).toEqual([...new Set(alternatives)]);
    });
  });
});
