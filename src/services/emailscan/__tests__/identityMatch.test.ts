/**
 * R28 (2026-09-17): rows must match candidates by merchant IDENTITY
 * (slug + mailbox), never by display name. Name variants ("YouTube" vs
 * "Youtube" — product map vs From-host mint, or restore-era names) used to
 * defeat the match and mint duplicate cards instead of repairing. Also
 * covers the schema v18 dedupe migration's keeper rules in spirit: the
 * paper-trailed row wins.
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
    id: "yt1",
    icon: require("@assets/icons/plus.png"),
    icon_key: "youtube",
    name: "YouTube",
    category: "sparse",
    status: "active",
    startDate: "2026-09-16T00:00:00.000Z",
    price: 549.99,
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

function youtubeCandidate(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "workspace:mail",
    merchantKey: "youtube",
    merchant: "Youtube",
    officialDomain: "youtube.com",
    kind: "sparse",
    amount: undefined,
    currency: "USD",
    cadence: undefined,
    billNumber: "INV-77",
    nextDate: undefined,
    amountUnknown: true,
    evidence: [],
    messageIds: ["msg-9"],
    confidence: "medium",
    ...overrides,
  };
}

describe("importFromConnectedMailboxes identity matching (R28)", () => {
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

  it("repairs a name-variant row instead of minting a duplicate card", async () => {
    mockScan.mockResolvedValueOnce({ candidates: [youtubeCandidate()] });
    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [
        existingRow({ name: "YouTube", icon_key: "youtube", id: "row-a" }),
      ],
      addSubscription,
      updateSubscription,
    });
    expect(addSubscription).not.toHaveBeenCalled();
    // The repair path backfills the paper-trail onto the stored row.
    expect(updateSubscription).toHaveBeenCalledWith(
      "row-a",
      expect.objectContaining({ billNumber: "INV-77" }),
    );
  });

  it("matches name variants that slug identically (YouTube vs Youtube)", async () => {
    mockScan.mockResolvedValueOnce({ candidates: [youtubeCandidate()] });
    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [
        existingRow({
          name: "Youtube",
          icon_key: "plus",
          id: "row-b",
          sourceMessageId: "keep-me",
        }),
      ],
      addSubscription,
      updateSubscription,
    });
    expect(addSubscription).not.toHaveBeenCalled();
    // Source email is never overwritten on the stored row.
    if (updateSubscription.mock.calls.length > 0) {
      const patch = updateSubscription.mock.calls[0][1];
      expect(patch.sourceMessageId).toBeUndefined();
    }
  });

  it("still mints a genuinely new merchant", async () => {
    mockScan.mockResolvedValueOnce({ candidates: [youtubeCandidate()] });
    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [
        existingRow({
          name: "Audible",
          icon_key: "audible",
          id: "row-c",
        }),
      ],
      addSubscription,
      updateSubscription,
    });
    expect(addSubscription).toHaveBeenCalledTimes(1);
  });
});
