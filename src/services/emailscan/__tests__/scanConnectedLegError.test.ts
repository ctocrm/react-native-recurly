/**
 * LESSONS 26 regression (R20 release gate, 2026-09-08): the per-leg catch in
 * importFromConnectedMailboxes used to swallow a leg's error without logging
 * it — the workspace leg logged `fetcherFor` + a token refresh and then
 * vanished from the 66-minute gate log: no summary, no error line anywhere.
 * The error must (a) still be returned in `errors` and (b) reach the console
 * so logcat shows which leg failed and why. A failing leg must not stop the
 * remaining legs.
 */
import {
  MailConnectError,
  createMailProvider,
} from "../providers";
import { listMailboxesAsync } from "../persist";
import { importFromConnectedMailboxes } from "../scanConnected";

jest.mock("@/services/iconBackgroundCrawler", () => ({
  startIconCrawl: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../persist", () => ({
  listMailboxesAsync: jest.fn(),
}));

type ScanResult = { candidates: unknown[] };

const mockScan = jest.fn<Promise<ScanResult>, []>();

jest.mock("../providers", () => ({
  MailConnectError: class MailConnectError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MailConnectError";
    }
  },
  MailScanUnverifiedError: class MailScanUnverifiedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "MailScanUnverifiedError";
    }
  },
  createMailProvider: jest.fn(() => ({ scan: mockScan })),
}));

const mockedBoxes = listMailboxesAsync as jest.Mock;
const mockedCreate = createMailProvider as jest.Mock;

describe("importFromConnectedMailboxes per-leg failure logging (LESSONS 26)", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockedBoxes.mockResolvedValue([
      { mailboxId: "box-ws", providerId: "workspace" },
      { mailboxId: "box-outlook", providerId: "outlook" },
    ]);
    mockedCreate.mockImplementation(
      (providerId: string) =>
        ({
          providerId,
          scan: mockScan,
        }) as never,
    );
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("logs AND returns a failed leg's error, then keeps scanning the next leg", async () => {
    mockScan.mockImplementationOnce(() =>
      Promise.reject(new MailConnectError("Not connected")),
    );
    mockScan.mockResolvedValueOnce({ candidates: [] });

    const { imported, errors } = await importFromConnectedMailboxes({
      userId: "u1",
      existing: [],
      addSubscription: jest.fn(),
    });

    // (a) the error is still surfaced in the result
    expect(errors).toEqual(["box-ws: Not connected"]);
    expect(imported).toBe(0);

    // (b) the error reached the console — the R20 silent-swallow hole
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [line, payload] = warnSpy.mock.calls[0];
    expect(String(line)).toContain("[MailScan] leg failed workspace box-ws");
    expect(String(line)).toContain("Not connected");
    expect(payload).toBeInstanceOf(MailConnectError);

    // (c) the failing leg did not stop the next leg
    expect(mockScan).toHaveBeenCalledTimes(2);
    expect(mockedCreate).toHaveBeenNthCalledWith(1, "workspace", "u1");
    expect(mockedCreate).toHaveBeenNthCalledWith(2, "outlook", "u1");
  });

  it("logs non-provider errors too instead of swallowing them", async () => {
    mockScan.mockImplementationOnce(() =>
      Promise.reject(new Error("Graph listing threw fast")),
    );
    mockScan.mockResolvedValueOnce({ candidates: [] });

    const { errors } = await importFromConnectedMailboxes({
      userId: "u1",
      existing: [],
      addSubscription: jest.fn(),
    });

    expect(errors).toEqual(["box-ws: Graph listing threw fast"]);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0][0])).toContain(
      "leg failed workspace box-ws: Graph listing threw fast",
    );
  });
});
