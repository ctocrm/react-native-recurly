/**
 * Self-heal gates (2026-09-11 placeholder flood): after an icon_cache wipe,
 * every existing subscription used to stay on the "+" placeholder forever
 * because nothing re-enqueued crawls for rows that already existed. The
 * self-heal pass must (a) start a chained crawl per missing key, (b) skip
 * keys already queued, (c) park while a scan runs and resume on scan end,
 * (d) be single-flighted, and (e) keep going when one key's crawl fails.
 */
import { beginScan, endScan, isScanActive } from "../scanState";
import { selfHealMissingIcons } from "../iconSelfHeal";
import { getQueuedIcons, listIconKeysMissingCache } from "@/services/database";
import { startIconCrawl } from "@/services/iconBackgroundCrawler";

jest.mock("@/services/database", () => ({
  listIconKeysMissingCache: jest.fn(),
  getQueuedIcons: jest.fn(),
}));

jest.mock("@/services/iconBackgroundCrawler", () => ({
  startIconCrawl: jest.fn(),
}));

const mockMissing = listIconKeysMissingCache as jest.Mock;
const mockQueued = getQueuedIcons as jest.Mock;
const mockStart = startIconCrawl as jest.Mock;

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("selfHealMissingIcons", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    while (isScanActive()) endScan();
    mockQueued.mockResolvedValue([]);
  });

  it("starts a chained crawl for every missing key", async () => {
    mockMissing.mockResolvedValue(["audible", "mondly", "zohoaccounts"]);
    mockStart.mockResolvedValue(undefined);

    const started = await selfHealMissingIcons();

    expect(started).toBe(3);
    expect(mockStart).toHaveBeenCalledTimes(3);
    const order = mockStart.mock.invocationCallOrder;
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
  });

  it("skips keys that already have a queue entry", async () => {
    mockMissing.mockResolvedValue(["audible", "mondly"]);
    mockQueued.mockResolvedValue([
      { icon_key: "mondly", subscription_id: null, attempt_count: 0 },
    ]);
    mockStart.mockResolvedValue(undefined);

    const started = await selfHealMissingIcons();

    expect(started).toBe(1);
    expect(mockStart).toHaveBeenCalledTimes(1);
    expect(mockStart).toHaveBeenCalledWith("audible");
  });

  it("is a no-op when every subscription has a cached icon", async () => {
    mockMissing.mockResolvedValue([]);

    const started = await selfHealMissingIcons();

    expect(started).toBe(0);
    expect(mockStart).not.toHaveBeenCalled();
  });

  it("parks while a scan is active and resumes when the scan ends", async () => {
    mockMissing.mockResolvedValue(["audible"]);
    mockStart.mockResolvedValue(undefined);

    beginScan();
    const pass = selfHealMissingIcons();
    await flush();
    expect(mockStart).not.toHaveBeenCalled(); // parked mid-scan

    endScan();
    await expect(pass).resolves.toBe(1);
    expect(mockStart).toHaveBeenCalledWith("audible");
  });

  it("is single-flighted: a second concurrent pass is a no-op", async () => {
    mockMissing.mockResolvedValue(["audible", "mondly"]);
    let release!: () => void;
    mockStart.mockReturnValue(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const first = selfHealMissingIcons();
    await flush();
    const second = selfHealMissingIcons();
    await expect(second).resolves.toBe(0);
    expect(mockStart).toHaveBeenCalledTimes(1); // only the first pass crawls

    release();
    await expect(first).resolves.toBe(2);
  });

  it("keeps the chain going when one key's crawl fails", async () => {
    mockMissing.mockResolvedValue(["bad", "good"]);
    mockStart.mockImplementation((key: string) =>
      key === "bad" ? Promise.reject(new Error("boom")) : Promise.resolve(),
    );
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});

    const started = await selfHealMissingIcons();

    expect(started).toBe(2);
    expect(mockStart).toHaveBeenCalledWith("bad");
    expect(mockStart).toHaveBeenCalledWith("good");
    warnSpy.mockRestore();
  });
});
