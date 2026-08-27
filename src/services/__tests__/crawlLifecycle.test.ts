import {
    CrawlGenerationRegistry,
    canAutoAssignCache,
    isUserChosenCacheSource,
    terminalStatusFor,
} from "../crawlLifecycle";

describe("terminalStatusFor (truthful terminal semantics)", () => {
  it("complete only when all saved and no provider failure", () => {
    expect(terminalStatusFor(5, 0, 0)).toBe("complete");
  });
  it("partial when candidates remain retryable", () => {
    expect(terminalStatusFor(5, 3, 0)).toBe("partial");
  });
  it("partial when a provider failed even if some saved", () => {
    expect(terminalStatusFor(5, 0, 1)).toBe("partial");
  });
  it("failed when nothing saved and a provider failed (no false 'complete')", () => {
    expect(terminalStatusFor(0, 0, 2)).toBe("failed");
  });
  it("complete when nothing found but no provider failed (true empty search)", () => {
    expect(terminalStatusFor(0, 0, 0)).toBe("complete");
  });
});

describe("canAutoAssignCache (explicit cache ownership)", () => {
  it("fills an empty cache", () => {
    expect(canAutoAssignCache(false, false)).toBe(true);
  });
  it("heals an invalid cache", () => {
    expect(canAutoAssignCache(true, false)).toBe(true);
  });
  it("upgrades a crawler-owned valid cache", () => {
    expect(canAutoAssignCache(true, true, false)).toBe(true);
  });
  it("NEVER overwrites a user/AI-chosen cache", () => {
    expect(canAutoAssignCache(true, true, true)).toBe(false);
  });
  it("treats a valid cache without an explicit chosen flag as crawler-owned", () => {
    expect(canAutoAssignCache(true, true)).toBe(true);
  });
});

describe("isUserChosenCacheSource", () => {
  it("recognizes picker/AI ownership sources", () => {
    expect(isUserChosenCacheSource("ai_upscale")).toBe(true);
    expect(isUserChosenCacheSource("subscription")).toBe(true);
    expect(isUserChosenCacheSource("user")).toBe(true);
  });
  it("treats crawl sources as crawler-owned", () => {
    expect(isUserChosenCacheSource("official_apple_touch")).toBe(false);
    expect(isUserChosenCacheSource("simple-icons")).toBe(false);
    expect(isUserChosenCacheSource("favicon")).toBe(false);
  });
});

describe("CrawlGenerationRegistry (stale cancellation)", () => {
  it("increments per key and detects stale tokens", () => {
    const reg = new CrawlGenerationRegistry();
    const g1 = reg.begin("netflix");
    expect(reg.isCurrent("netflix", g1)).toBe(true);
    const g2 = reg.begin("netflix");
    expect(g2).toBe(g1 + 1);
    expect(reg.isCurrent("netflix", g1)).toBe(false);
    expect(reg.isCurrent("netflix", g2)).toBe(true);
    // other key unaffected
    expect(reg.isCurrent("spotify", 0)).toBe(true);
  });
});
