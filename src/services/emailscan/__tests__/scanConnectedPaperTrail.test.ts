/**
 * R22 regression (R18 Phase-C follow-up #2): a rollup-built candidate used to
 * reach the repair path without its paper-trail — Audible kept Source email
 * "—" forever because the repair branch only patched billing/price. A
 * matching candidate must backfill sourceMessageId / billNumber when (and
 * only when) the stored row lacks them; a sparse candidate must never touch
 * a recurring row; nothing is ever overwritten.
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

function existingRow(overrides: Partial<Subscription>): Subscription {
  return {
    id: "aud1",
    icon: require("@assets/icons/plus.png"),
    icon_key: "audible",
    name: "Audible",
    category: "recurring",
    status: "active",
    startDate: "2026-09-07T00:00:00.000Z",
    price: 9.99,
    priceUnknown: false,
    currency: "USD",
    billing: "Monthly",
    frequency: "Monthly",
    paymentMethod: "workspace:mail",
    sourceMessageId: null,
    billNumber: null,
    ...overrides,
  } as Subscription;
}

function recurringCandidate(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "workspace:mail",
    merchantKey: "audible",
    merchant: "Audible",
    officialDomain: "audible.com",
    kind: "recurring",
    amount: 9.99,
    currency: "USD",
    cadence: "monthly",
    billNumber: null,
    nextDate: undefined,
    amountUnknown: false,
    evidence: [],
    messageIds: ["msg-1"],
    confidence: "high",
    ...overrides,
  };
}

describe("importFromConnectedMailboxes paper-trail backfill (R22)", () => {
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

  it("backfills sourceMessageId + billNumber on a matching row that lacks them", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [
        recurringCandidate({ billNumber: "INV-9", messageIds: ["msg-1"] }),
      ],
    });

    const { imported } = await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({})],
      addSubscription,
      updateSubscription,
    });

    expect(addSubscription).not.toHaveBeenCalled();
    expect(updateSubscription).toHaveBeenCalledTimes(1);
    expect(updateSubscription).toHaveBeenCalledWith(
      "aud1",
      expect.objectContaining({
        sourceMessageId: "msg-1",
        billNumber: "INV-9",
        category: "recurring",
      }),
    );
    expect(imported).toBe(1);
  });

  it("never overwrites an existing paper-trail value", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [
        recurringCandidate({ billNumber: "INV-NEW", messageIds: ["msg-2"] }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({ sourceMessageId: "keep-me" })],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.sourceMessageId).toBeUndefined();
    expect(patch.billNumber).toBe("INV-NEW");
  });

  it("a sparse candidate never backfills a recurring row", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [recurringCandidate({ kind: "sparse" })],
    });

    const { imported } = await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({})],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
    expect(addSubscription).not.toHaveBeenCalled();
    expect(imported).toBe(0);
  });
});
