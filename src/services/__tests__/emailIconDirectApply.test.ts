/**
 * Phase L (email-icon immediate populate): tryApplyEmailIconDirect fetches
 * ≤3 best-first brand-sent email logo URLs, records them with `email_*`
 * provenance, and promotes through the same report-stick auto-assign the
 * crawl uses (downloadImageAsBase64 promotes on every successful save).
 * It returns true ONLY when the card icon cache ends up holding a valid
 * email-sourced icon — the caller (enqueueScanIconCrawl, at drain) skips
 * the web crawl on true and falls back to the seeded crawl otherwise.
 *
 * The real crawler module runs here; only the database, rate-limit tracker,
 * report service, loading registry, and react-native Image.getSize are
 * mocked, with a simulated rows/cache store that mirrors DB semantics
 * (crawl result rows replace by original URL; cache read-back reflects
 * setCachedIcon writes).
 */
import UPNG from "upng-js";
import {
  getCachedIcon,
  getCrawlResults,
  saveCrawlResult,
  setCachedIcon,
} from "@/services/database";
import { tryApplyEmailIconDirect } from "../iconBackgroundCrawler";

jest.mock("@/services/database", () => ({
  beginIconCrawlSession: jest.fn(),
  dequeueIcon: jest.fn(),
  enqueueIconScrape: jest.fn(),
  getCachedIcon: jest.fn(),
  getCrawlResults: jest.fn(),
  getIconCrawlSession: jest.fn(),
  getQueuedIcons: jest.fn(),
  markUrlAsCrawled: jest.fn(),
  saveCrawlResult: jest.fn(),
  setCachedIcon: jest.fn(),
  updateIconCrawlSession: jest.fn(),
}));

jest.mock("@/services/rateLimitTracker", () => ({
  isDomainRateLimited: jest.fn().mockResolvedValue(false),
  recordRateLimit: jest.fn(),
  recordSuccess: jest.fn(),
}));

jest.mock("@/services/iconReportService", () => ({
  getReportsForIcon: jest.fn().mockResolvedValue([]),
  hashImageData: jest.fn(() => "hash"),
}));

jest.mock("@/services/iconLoadingRegistry", () => ({
  notifyCacheUpdate: jest.fn(),
  setIconCrawlProgress: jest.fn(),
  setIconLoading: jest.fn(),
}));

jest.mock("react-native", () => {
  // Do NOT spread the RN namespace — its lazy component getters throw when
  // materialized eagerly. Mutate the real module object (jest gives each
  // test file its own registry copy) so only Image.getSize is overridden.
  const RN = jest.requireActual("react-native") as Record<string, any>;
  const Image = RN.Image as Record<string, any>;
  Image.getSize = (_uri: string, ok: (w: number, h: number) => void) =>
    ok(64, 64);
  return RN;
});

const mockedCached = getCachedIcon as jest.Mock;
const mockedRows = getCrawlResults as jest.Mock;
const mockedSave = saveCrawlResult as jest.Mock;
const mockedSetCached = setCachedIcon as jest.Mock;

/** A 64x64 opaque dark PNG built from deterministic pseudo-noise: solid fills
 * compress to ~120 bytes and trip MIN_DECODED_BYTES (300); noise encodes to
 * several KB while staying a valid, visible, non-white icon. */
function makePng(size = 64): { bytes: Uint8Array; base64: string } {
  const rgba = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = (i * 37) % 200;
    rgba[i * 4 + 1] = (i * 53) % 200;
    rgba[i * 4 + 2] = (i * 71) % 200;
    rgba[i * 4 + 3] = 255;
  }
  const encoded = UPNG.encode([rgba.buffer as ArrayBuffer], size, size, 0);
  const bytes = new Uint8Array(encoded as ArrayBuffer);
  const base64 = Buffer.from(bytes).toString("base64");
  return { bytes, base64 };
}

const png = makePng();

function okImageResponse() {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "image/png" },
    arrayBuffer: async () =>
      png.bytes.buffer.slice(
        png.bytes.byteOffset,
        png.bytes.byteOffset + png.bytes.byteLength,
      ),
  };
}

describe("tryApplyEmailIconDirect (Phase L)", () => {
  let rows: Record<string, unknown>[];
  let cached: Record<string, unknown> | null;
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    rows = [];
    cached = null;
    mockedRows.mockImplementation(async () => rows);
    mockedCached.mockImplementation(async () => cached);
    mockedSave.mockImplementation(
      async (
        _key: string,
        imageData: string,
        source: string,
        format: string,
        url: string,
        w?: number,
        h?: number,
      ) => {
        rows = rows.filter((r) => r.originalUrl !== url);
        rows.push({
          icon_key: "mondly",
          imageData,
          source,
          format,
          originalUrl: url,
          originalWidth: w ?? null,
          originalHeight: h ?? null,
        });
      },
    );
    mockedSetCached.mockImplementation(
      async (
        _key: string,
        imageData: string,
        source: string,
        format: string,
        originalUrl: string | null,
      ) => {
        cached = { imageData, format, source, originalUrl };
      },
    );
    fetchMock = jest
      .spyOn(global, "fetch")
      .mockImplementation(async () => okImageResponse() as unknown as Response);
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  it("returns false and does no work without email seeds", async () => {
    await expect(tryApplyEmailIconDirect("mondly")).resolves.toBe(false);
    await expect(tryApplyEmailIconDirect("mondly", [])).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockedSave).not.toHaveBeenCalled();
  });

  it("returns false without fetching when the card already holds a valid icon", async () => {
    cached = {
      imageData: png.base64,
      format: "png",
      source: "bing_images",
      originalUrl: "https://x.example/a.png",
    };
    await expect(
      tryApplyEmailIconDirect("mondly", [
        "https://www.mondly.com/mail/logo.png",
      ]),
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("applies ≤3 best-first seeds with email_logo provenance and skips the crawl", async () => {
    const urls = [
      "https://www.mondly.com/mail/logo-1.png",
      "https://www.mondly.com/mail/logo-2.png",
      "https://www.mondly.com/mail/logo-3.png",
      "https://www.mondly.com/mail/logo-4.png",
      "https://www.mondly.com/mail/logo-5.png",
    ];
    await expect(tryApplyEmailIconDirect("mondly", urls)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(mockedSave).toHaveBeenCalledWith(
      "mondly",
      "",
      "email_logo",
      "png",
      urls[0],
    );
    // The promote pass ran and the card icon is email-sourced.
    expect(mockedSetCached).toHaveBeenCalled();
    expect(cached).toMatchObject({ source: "email_logo", format: "png" });
  });

  it("marks signature-path URLs as email_signature", async () => {
    // "-sig." delimited path → email_signature provenance. The filename keeps
    // the brand token and its non-brand token ("sig") is <4 chars, so the
    // isPartnerOrUnrelatedMark filter (same one the crawl's promote uses)
    // does not treat the mark as unrelated.
    await expect(
      tryApplyEmailIconDirect("mondly", [
        "https://www.mondly.com/img/mondly-sig.png",
      ]),
    ).resolves.toBe(true);
    expect(mockedSave).toHaveBeenCalledWith(
      "mondly",
      "",
      "email_signature",
      "png",
      "https://www.mondly.com/img/mondly-sig.png",
    );
    expect(cached).toMatchObject({ source: "email_signature" });
  });

  it("returns false (caller falls back to the crawl) when every download fails", async () => {
    fetchMock.mockImplementation(
      async () =>
        ({
          ok: false,
          status: 404,
          headers: { get: () => null },
          arrayBuffer: async () => new ArrayBuffer(0),
        }) as unknown as Response,
    );
    await expect(
      tryApplyEmailIconDirect("mondly", [
        "https://www.mondly.com/mail/logo.png",
      ]),
    ).resolves.toBe(false);
    // Candidate rows were still recorded for the fallback crawl to dedupe/retry.
    expect(rows).toHaveLength(1);
    expect(cached).toBeNull();
  });
});
