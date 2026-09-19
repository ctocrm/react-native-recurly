/**
 * Scan-date bug: a scanned row's Started date must be the earliest
 * RECEIVED email date in its corpus, never the day the scan ran. Covers
 * rollup firstSeen, the free->money collapse merge, the honest mint, and
 * the startDateRepair heal for rows already stamped with the scan day.
 */
import { collapseFreeIntoMoney, rollupCandidates } from "../rollup";
import { candidateToSubscription } from "../importCandidate";
import { importFromConnectedMailboxes } from "../scanConnected";
import { listMailboxesAsync } from "../persist";
import type { ClassifiedMessage, ScanCandidate } from "../types";

let seq = 0;
function hit(
  date: string,
  overrides: Partial<ClassifiedMessage> = {},
): ClassifiedMessage {
  seq += 1;
  return {
    message: {
      mailboxId: "workspace:mail",
      messageId: "msg-" + seq,
      from: "billing@hightimes.com",
      subject: "Your receipt",
      date,
    },
    subjectClass: "sparse",
    merchantKey: "hightimes",
    merchantName: "Hightimes",
    kind: "recurring",
    amount: 59.99,
    amountUnknown: false,
    needsBody: false,
    evidence: [],
    confidence: "high",
    ...overrides,
  };
}

describe("rollup firstSeen (earliest received email date)", () => {
  it("is the MIN hit date regardless of input order", () => {
    const candidates = rollupCandidates([
      hit("2026-09-01T10:00:00.000Z"),
      hit("2026-05-12T08:00:00.000Z"),
      hit("2026-07-20T09:00:00.000Z"),
    ]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].firstSeen).toBe("2026-05-12T08:00:00.000Z");
  });

  it("a single-message candidate carries that message's date", () => {
    const candidates = rollupCandidates([hit("2026-05-12T08:00:00.000Z")]);
    expect(candidates[0].firstSeen).toBe("2026-05-12T08:00:00.000Z");
  });
});

describe("collapseFreeIntoMoney firstSeen merge", () => {
  it("an absorbed older free welcome pulls the money row earlier", () => {
    const money = rollupCandidates([hit("2026-06-01T00:00:00.000Z")])[0];
    const free = rollupCandidates([
      hit("2026-05-12T00:00:00.000Z", { kind: "free", amount: undefined }),
    ])[0];
    const merged = collapseFreeIntoMoney([free, money]);
    expect(merged).toHaveLength(1);
    expect(merged[0].kind).toBe("recurring");
    expect(merged[0].firstSeen).toBe("2026-05-12T00:00:00.000Z");
  });

  it("never moves a money row later than its own evidence", () => {
    const money = rollupCandidates([hit("2026-06-01T00:00:00.000Z")])[0];
    const free = rollupCandidates([
      hit("2026-07-15T00:00:00.000Z", { kind: "free", amount: undefined }),
    ])[0];
    const merged = collapseFreeIntoMoney([free, money]);
    expect(merged[0].firstSeen).toBe("2026-06-01T00:00:00.000Z");
  });
});

describe("candidateToSubscription start date", () => {
  it("mints startDate from the corpus's earliest received email", () => {
    const candidate: ScanCandidate = {
      mailboxId: "workspace:mail",
      merchantKey: "hightimes",
      merchant: "Hightimes",
      kind: "recurring",
      amount: 59.99,
      currency: "USD",
      amountUnknown: false,
      evidence: [],
      messageIds: ["m1"],
      confidence: "high",
      firstSeen: "2026-05-12T08:00:00.000Z",
    };
    expect(candidateToSubscription(candidate).startDate).toBe(
      "2026-05-12T08:00:00.000Z",
    );
  });

  it("falls back to the wall-clock only when no usable date exists", () => {
    const candidate: ScanCandidate = {
      mailboxId: "workspace:mail",
      merchantKey: "hightimes",
      merchant: "Hightimes",
      kind: "sparse",
      amountUnknown: true,
      evidence: [],
      messageIds: ["m1"],
      confidence: "low",
    };
    const start = candidateToSubscription(candidate).startDate ?? "";
    expect(Math.abs(Date.now() - new Date(start).getTime())).toBeLessThan(
      60_000,
    );
  });
});

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

const SCAN_DAY = "2026-09-16T00:00:00.000Z";
const CORPUS_START = "2026-05-12T00:00:00.000Z";

function existingRow(overrides: Partial<Subscription>): Subscription {
  return {
    id: "hightimes1",
    icon: require("@assets/icons/plus.png"),
    icon_key: "hightimes",
    name: "Hightimes",
    category: "recurring",
    status: "active",
    startDate: SCAN_DAY,
    price: 59.99,
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

function candidateFixture(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "workspace:mail",
    merchantKey: "hightimes",
    merchant: "Hightimes",
    officialDomain: "hightimes.com",
    kind: "recurring",
    amount: 59.99,
    currency: "USD",
    cadence: "monthly",
    billNumber: null,
    nextDate: undefined,
    amountUnknown: false,
    evidence: [],
    messageIds: ["m1", "m2"],
    confidence: "high",
    firstSeen: CORPUS_START,
    ...overrides,
  };
}

describe("importFromConnectedMailboxes startDateRepair (scan-date bug)", () => {
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

  it("heals a scan-day stamp back to the corpus's earliest email", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [candidateFixture()],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({})],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.startDate).toBe(CORPUS_START);
  });

  it("a fresh mint starts at the earliest email, not the scan day", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [candidateFixture()],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [],
      addSubscription,
      updateSubscription,
    });

    expect(addSubscription).toHaveBeenCalledTimes(1);
    expect(addSubscription.mock.calls[0][0].startDate).toBe(CORPUS_START);
    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it("a hand-entered row's start still heals from mail evidence (2026-09-18 directive)", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [candidateFixture()],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [
        existingRow({ sourceMessageId: null, billNumber: "INV-7" }),
      ],
      addSubscription,
      updateSubscription,
    });

    // The paper trail backfills (R18) AND the start heals to the earliest
    // received email — Started is evidence-derived for every matched row.
    // Price and cadence protections are separate gates, untouched here.
    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.sourceMessageId).toBe("m1");
    expect(patch.startDate).toBe(CORPUS_START);
  });

  it("never moves a start LATER — a stored earlier start stays", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [candidateFixture()],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({ startDate: "2026-01-02T00:00:00.000Z" })],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it("a candidate whose evidence is NEWER than the stored start never repairs", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [
        candidateFixture({ firstSeen: "2026-10-01T00:00:00.000Z" }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow({})],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
  });
});
