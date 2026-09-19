/**
 * L2 residual (user-approved design): brand-sent email seeds for an
 * already-icon'd subscription are ACQUIRED into the crawl collection
 * (acquireEmailIconCollection) instead of being dropped — and the
 * acquisition path never starts a web crawl and never touches the cache
 * directly (the quality scorer + report filter decide display). The
 * icon-less direct-apply + crawl-fallback path is regression-guarded.
 */
import { listMailboxesAsync } from "../persist";
import { importFromConnectedMailboxes } from "../scanConnected";

const mockAcquire = jest.fn().mockResolvedValue(undefined);
const mockCrawl = jest.fn().mockResolvedValue(undefined);
const mockDirect = jest.fn().mockResolvedValue(false);

jest.mock("@/services/iconBackgroundCrawler", () => ({
  acquireEmailIconCollection: (...a: unknown[]) => mockAcquire(...(a as [])),
  startIconCrawl: (...a: unknown[]) => mockCrawl(...(a as [])),
  processIconQueue: jest.fn().mockResolvedValue(undefined),
  tryApplyEmailIconDirect: (...a: unknown[]) => mockDirect(...(a as [])),
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

function existingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    icon: 0,
    icon_key: "stripe",
    name: "Stripe",
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
  };
}

function seededCandidate(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "workspace:mail",
    merchantKey: "stripe",
    merchant: "Stripe",
    officialDomain: "stripe.com",
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
    emailIconUrls: ["https://cdn.stripe.com/v3/logo.png"],
    ...overrides,
  };
}

const SEEDS = ["https://cdn.stripe.com/v3/logo.png"];

async function flushChain() {
  // The enqueue helpers chain onto scanCrawlChain and resolve asynchronously
  // after importFromConnectedMailboxes returns.
  await new Promise((resolve) => setTimeout(resolve, 20));
}

describe("email-seed acquisition for already-icon'd subscriptions (L2 residual)", () => {
  let addSubscription: jest.Mock;
  let updateSubscription: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    mockAcquire.mockResolvedValue(undefined);
    mockCrawl.mockResolvedValue(undefined);
    mockDirect.mockResolvedValue(false);
    mockedBoxes.mockResolvedValue([
      { mailboxId: "workspace:mail", providerId: "workspace" },
    ]);
    addSubscription = jest.fn();
    updateSubscription = jest.fn();
  });

  it("acquires brand-sent seeds for an already-icon'd row; no crawl, no direct-apply", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [seededCandidate()],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({ icon_key: "stripe" })],
      addSubscription,
      updateSubscription,
    });
    await flushChain();

    expect(mockAcquire).toHaveBeenCalledWith("stripe", SEEDS);
    expect(mockCrawl).not.toHaveBeenCalled();
    expect(mockDirect).not.toHaveBeenCalled();
  });

  it("a candidate without seeds never triggers acquisition", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [seededCandidate({ emailIconUrls: undefined })],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({ icon_key: "stripe" })],
      addSubscription,
      updateSubscription,
    });
    await flushChain();

    expect(mockAcquire).not.toHaveBeenCalled();
    expect(mockCrawl).not.toHaveBeenCalled();
  });

  it("an icon-less row keeps the direct-apply + crawl-fallback path", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [
        seededCandidate({ merchant: "Audible", merchantKey: "audible" }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({ id: "row-2", icon_key: "plus", name: "Audible" })],
      addSubscription,
      updateSubscription,
    });
    await flushChain();

    expect(mockDirect).toHaveBeenCalledWith(
      "audible",
      SEEDS,
    );
    expect(mockCrawl).toHaveBeenCalledWith(
      "audible",
      "row-2",
      expect.objectContaining({ seedUrls: SEEDS }),
    );
    expect(mockAcquire).not.toHaveBeenCalled();
  });
});
