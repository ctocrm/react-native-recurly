/**
 * R34: cadence un-stamp. Legacy default-cadence stamps ("Uber $47.25
 * Monthly") must clear when the merchant's own corpus (≥2 messages)
 * evidences NO cadence — cadenceRepair can never clear them because it only
 * writes non-Monthly cadences. Hand-entered rows keep their cadence;
 * recurring rows are never cleared; a paper-trail backfill alone must not
 * rewrite billing.
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
    id: "uber1",
    icon: require("@assets/icons/plus.png"),
    icon_key: "uber",
    name: "Uber",
    category: "sparse",
    status: "active",
    startDate: "2026-09-07T00:00:00.000Z",
    price: 47.25,
    priceUnknown: false,
    currency: "USD",
    billing: "Monthly",
    frequency: "Monthly",
    paymentMethod: "workspace:mail",
    sourceMessageId: "old-msg",
    billNumber: null,
    ...overrides,
  } as Subscription;
}

function sparseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "workspace:mail",
    merchantKey: "uber",
    merchant: "Uber",
    officialDomain: "uber.com",
    kind: "sparse",
    amount: 47.25,
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

describe("importFromConnectedMailboxes cadence un-stamp (R34)", () => {
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

  it("clears a legacy Monthly stamp when the corpus has no cadence (≥2 msgs)", async () => {
    mockScan.mockResolvedValueOnce({ candidates: [sparseCandidate()] });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({})],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.billing).toBe("");
    expect(patch.frequency).toBe("");
    expect(patch.category).toBe("sparse");
  });

  it("needs ≥2 corpus messages — a single message never un-stamps", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [sparseCandidate({ messageIds: ["m1"] })],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({})],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it("a hand-entered row keeps its cadence (paper-trail may still backfill)", async () => {
    mockScan.mockResolvedValueOnce({ candidates: [sparseCandidate()] });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({ sourceMessageId: null })],
      addSubscription,
      updateSubscription,
    });

    // The backfill is legitimate — but billing/frequency must stay Monthly.
    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.billing).toBeUndefined();
    expect(patch.frequency).toBeUndefined();
  });

  it("a recurring row is never un-stamped by a cadence-less candidate", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [sparseCandidate({ kind: "recurring" })],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({ category: "recurring" })],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it("a paper-trail backfill alone never rewrites (or wipes) billing", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [
        sparseCandidate({
          merchantKey: "porkbun",
          merchant: "Porkbun",
          billNumber: "INV-9",
          messageIds: ["m1", "m2"],
        }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [
        // Porkbun shape: a hand-entered Yearly cadence that a scan-born
        // paper-trail backfill must not wipe.
        existingRow({
          name: "Porkbun",
          icon_key: "porkbun",
          billing: "Yearly",
          frequency: "Yearly",
          sourceMessageId: null,
          billNumber: null,
        }),
      ],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.billNumber).toBe("INV-9");
    expect(patch.sourceMessageId).toBe("m1");
    expect(patch.billing).toBeUndefined();
    expect(patch.frequency).toBeUndefined();
  });
});
