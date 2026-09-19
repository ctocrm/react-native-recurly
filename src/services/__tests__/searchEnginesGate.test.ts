/**
 * J2: discovery search must pause at engine-stage boundaries when the injected
 * gate says so — the crawler passes `waitIfScanActive`, so a discovery flow
 * that started before a scan parks at the next boundary instead of stealing
 * JS/network from the mail legs (2026-09-14: the fastbtc flow starved a
 * 3-message workspace leg for ~2.5 min and nearly drew a false watchdog kill).
 */

import { searchAllSources, searchForLinksToSpider } from "../searchEngines";
import { recordRateLimit } from "../rateLimitTracker";

const okResponse = {
  ok: true,
  status: 200,
  text: async () => "",
  json: async () => ({}),
};

describe("search engine stage gate (J2)", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it(
    "searchAllSources awaits the gate at each engine boundary",
    async () => {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(okResponse as unknown as Response);
      // Skip the dork stage's 3s inter-batch sleeps — the gate before it is
      // still awaited, which is what this test asserts.
      recordRateLimit("https://www.google.com");
      let gateCalls = 0;
      // Empty fetch bodies → 0 results → the short-circuit (>15 results)
      // never fires, so all three stages run: DDG, Bing, dorks.
      await searchAllSources("gatebrand", async () => {
        gateCalls += 1;
      });
      expect(gateCalls).toBe(3);
    },
    20_000,
  );

  it(
    "searchForLinksToSpider awaits the gate before its fetch",
    async () => {
      jest
        .spyOn(global, "fetch")
        .mockResolvedValue(okResponse as unknown as Response);
      let gated = false;
      const links = await searchForLinksToSpider("gatebrand", async () => {
        gated = true;
      });
      expect(gated).toBe(true);
      expect(links).toEqual([]);
    },
    20_000,
  );
});