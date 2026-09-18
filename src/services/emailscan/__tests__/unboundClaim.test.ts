/**
 * R37: a candidate repairs the merchant's unbound (null-mailbox) row
 * instead of minting a twin, and binds scan-born claimed rows to the
 * mailbox. Rows bound to a DIFFERENT mailbox are never claimed.
 */
import { listMailboxesAsync } from "../persist";
import { importFromConnectedMailboxes } from "../scanConnected";

jest.mock("@/services/iconBackgroundCrawler", () => ({
  startIconCrawl: jest.fn().mockResolvedValue(undefined),
  processIconQueue: jest.fn().mockResolvedValue(undefined),
  tryApplyEmailIconDirect: jest.fn().mockResolvedValue(false),
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

function row(overrides: Partial<Subscription>): Subscription {
  return {
    id: "r1",
    icon: require("@assets/icons/plus.png"),
    icon_key: "amazon",
    name: "Amazon",
    category: "sparse",
    status: "active",
    startDate: "2026-09-07T00:00:00.000Z",
    price: 12.5,
    priceUnknown: false,
    currency: "USD",
    billing: "",
    frequency: "",
    paymentMethod: null,
    sourceMessageId: "old-1",
    billNumber: null,
    ...overrides,
  } as Subscription;
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "workspace:mail",
    merchantKey: "amazon",
    merchant: "Amazon",
    officialDomain: "amazon.com",
    kind: "sparse",
    amount: 12.5,
    currency: "USD",
    cadence: undefined,
    billNumber: null,
    nextDate: undefined,
    amountUnknown: false,
    evidence: [],
    messageIds: ["m1", "m2"],
    confidence: "high",
    ...overrides,
  };
}

describe("importFromConnectedMailboxes unbound-row claim (R37)", () => {
  let addSubscription: jest.Mock;
  let updateSubscription: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockedBoxes.mockResolvedValue([
      { mailboxId: "workspace:mail", providerId: "workspace" },
    ]);
    addSubscription = jest.fn();
    updateSubscription = jest.fn();
  });

  it("claims an unbound scan-born row instead of minting a twin", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [candidate({ billNumber: "B-9" })],
    });

    const { imported } = await importFromConnectedMailboxes({
      userId: "u1",
      existing: [row({})],
      addSubscription,
      updateSubscription,
    });

    expect(addSubscription).not.toHaveBeenCalled();
    expect(imported).toBeGreaterThanOrEqual(1);
    // Claimed + bound: the patch carries the mailbox backfill alongside
    // the paper-trail fill.
    const calls = updateSubscription.mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(1);
    const patch = calls[calls.length - 1][1] as Partial<Subscription>;
    expect(patch.billNumber).toBe("B-9");
    expect(patch.paymentMethod).toBe("workspace:mail");
  });

  it("binds a claimed row even when no repair gate fires", async () => {
    // Identical price, no cadence, paper trail already present, single
    // corpus message (cadenceClear needs 2) — no gate should fire, yet the
    // claim must bind the row, not mint.
    mockScan.mockResolvedValueOnce({
      candidates: [candidate({ messageIds: ["m1"] })],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [row({ sourceMessageId: "m1", billNumber: "B-1" })],
      addSubscription,
      updateSubscription,
    });

    expect(addSubscription).not.toHaveBeenCalled();
  });

  it("never claims a row bound to a different mailbox", async () => {
    mockScan.mockResolvedValueOnce({ candidates: [candidate()] });

    const { imported } = await importFromConnectedMailboxes({
      userId: "u1",
      existing: [
        row({ paymentMethod: "gmail:other@gmail.com", sourceMessageId: "m1" }),
      ],
      addSubscription,
      updateSubscription,
    });

    // A different mailbox is an honest separate row: the candidate mints.
    expect(addSubscription).toHaveBeenCalledTimes(1);
    expect(imported).toBe(1);
  });

  it("hand-entered unbound rows stay unbound (no mailbox backfill)", async () => {
    mockScan.mockResolvedValueOnce({ candidates: [candidate()] });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [row({ sourceMessageId: null, price: 99 })],
      addSubscription,
      updateSubscription,
    });

    expect(addSubscription).not.toHaveBeenCalled();
    const patch = updateSubscription.mock.calls[0][1] as Partial<Subscription>;
    expect(patch.paymentMethod).toBeUndefined();
  });
});
