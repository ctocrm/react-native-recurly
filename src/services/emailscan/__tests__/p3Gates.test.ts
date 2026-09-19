/**
 * R38 P3 gates:
 *  1. Marketing-shaped subjects never mint RECURRING on generic proof
 *     alone (Order markup with real price/orderStatus is STRONG proof and
 *     keeps the recurring read).
 *  2. $0 license receipts never anchor a cadence ("renewal price",
 *     "domain registration") — the $0→free import rule owns the flip.
 *  3. ONE proven-payment message clears a legacy sparse stamp (R34 ≥2 rule
 *     loosened; hand-entered rows protected; never recurring rows).
 */
import { classifyMessage } from "../classifier";
import { importFromConnectedMailboxes } from "../scanConnected";
import { listMailboxesAsync } from "../persist";
import type { NormalizedMessage } from "../types";

function msg(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    mailboxId: "workspace:david@bohbotweb.com",
    messageId: "p3-" + Math.random().toString(36).slice(2, 8),
    from: "Acme <billing@acme.com>",
    subject: "Renew your subscription today — save 50%",
    date: "2026-09-01T00:00:00.000Z",
    text: "Your payment method was updated for your renewal.",
    ...overrides,
  };
}

describe("P3.1 — marketing never mints recurring on generic proof", () => {
  const hints = { listUnsubscribe: true, gmailCategory: "CATEGORY_PROMOTIONS" };

  it("demotes a SUBJECT-tier ad-shaped recurring subject to sparse", () => {
    // Ad pricing grammar in the SUBJECT ("just $4.99") with generic proof
    // only — the offer-shaped class P3 targets.
    const hit = classifyMessage(
      msg({ subject: "Your subscription renewal — just $4.99/mo" }),
    );
    expect(hit.kind).toBe("sparse");
    expect(hit.evidence).toContain("demote:marketing-no-strong-proof");
  });

  it("body CTA noise and bulk hints alone never demote a legit renewal", () => {
    // R38 audit regression guard: the pre-audit >=2 score rule demoted this
    // exact class (R27 deliberately preserves light marketing + generic
    // proof as recurring).
    const hit = classifyMessage(
      msg({
        subject: "Your subscription renews tomorrow",
        text: "Learn more about your plan. Your payment method was updated. Unsubscribe anytime.",
        hints: undefined,
      }),
    );
    expect(hit.kind).toBe("recurring");
    expect(hit.evidence).not.toContain("demote:marketing-no-strong-proof");
  });

  it("an Order payload with a real price keeps the recurring read", () => {
    const hit = classifyMessage(
      msg({
        hints,
        html: `<script type="application/ld+json">{"@type":"Order",
          "seller":{"name":"Acme"},"orderedItem":{"@type":"Product","name":"Pro"},
          "acceptedOffer":{"price":9.99,"priceCurrency":"USD"}}</script>`,
      }),
    );
    expect(hit.kind).toBe("recurring");
    expect(hit.evidence).toContain("proof:order-markup");
    expect(hit.amount).toBe(9.99);
  });

  it("an Order payload with orderStatus (no price) is also strong proof", () => {
    const hit = classifyMessage(
      msg({
        hints,
        html: `<script type="application/ld+json">{"@type":"Order",
          "seller":{"name":"Acme"},"orderStatus":"OrderProcessing"}</script>`,
      }),
    );
    expect(hit.evidence).toContain("proof:order-markup");
  });
});

describe("P3.2 — $0 license receipts never anchor cadence", () => {
  it("a $0 renewal receipt carries no cadence stamp", () => {
    const hit = classifyMessage(
      msg({
        from: "Netgate <billing@netgate.com>",
        subject: "Your Netgate renewal",
        text: "Renewal price: $0.00. Domain registration included. Total charged $0.00.",
        hints: undefined,
      }),
    );
    expect(hit.amount).toBe(0);
    expect(hit.cadence).not.toBe("yearly");
    expect(hit.cadence).not.toBe("monthly");
  });
});

// ---- P3.3 scanConnected: one proven-payment message clears the stamp ----

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

function existingRow(): Subscription {
  return {
    id: "stamped1",
    icon: require("@assets/icons/plus.png"),
    icon_key: "rotaryengine",
    name: "Rotaryengine",
    category: "sparse",
    status: "active",
    startDate: "2025-01-10T00:00:00.000Z",
    price: 47.25,
    priceUnknown: false,
    currency: "USD",
    billing: "Monthly",
    frequency: "Monthly",
    paymentMethod: "workspace:mail",
    sourceMessageId: "old-msg",
    billNumber: null,
  } as Subscription;
}

function sparseCandidate(overrides: Record<string, unknown> = {}) {
  return {
    mailboxId: "workspace:mail",
    merchantKey: "rotaryengine",
    merchant: "Rotaryengine",
    kind: "sparse",
    amount: 0,
    currency: "USD",
    cadence: undefined,
    billNumber: null,
    nextDate: undefined,
    amountUnknown: false,
    evidence: [],
    messageIds: ["m1"],
    confidence: "high",
    ...overrides,
  };
}

describe("P3.3 — one proven-payment message clears a legacy stamp", () => {
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

  it("a single message WITH proof evidence clears the stamp", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [
        sparseCandidate({ amount: 0, evidence: ["proof:doc-number ABC-1"] }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow()],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.billing).toBe("");
    expect(patch.frequency).toBe("");
    // The $0 candidate flips the row to FREE and the flip carries the stamp
    // clear (a free row has no cadence).
    expect(patch.category).toBe("free");
  });

  it("a single message WITHOUT proof still needs the R34 two-message bar", async () => {
    mockScan.mockResolvedValueOnce({
      candidates: [sparseCandidate({ amount: 47.25, evidence: [] })],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow()],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it("a $0 license candidate flips a RECURRING row to free and clears the stamp", async () => {
    // The Netgate class: stored recurring "? Monthly" + a $0 renewal receipt.
    // kindCompatible must admit the free candidate (streamFlip owns the
    // change) and richer must NOT zero anything.
    const recurring = {
      ...existingRow(),
      category: "recurring",
      price: 41,
      billing: "Monthly",
      frequency: "Monthly",
      icon_key: "squarespace",
      name: "Netgate",
    } as Subscription;
    mockScan.mockResolvedValueOnce({
      candidates: [
        sparseCandidate({
          merchantKey: "netgate",
          merchant: "Netgate",
          amount: 0,
          evidence: ["proof:doc-number LT-9"],
        }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [recurring],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).toHaveBeenCalledTimes(1);
    const patch = updateSubscription.mock.calls[0][1];
    expect(patch.category).toBe("free");
    expect(patch.billing).toBe("");
    expect(patch.frequency).toBe("");
    expect(patch.price).toBeUndefined(); // richer stays guarded
  });

  it("a welcome/account mail (kind free, no amount) never flips a recurring row", async () => {
    // R38 audit fix: kindCompatible admitted every free-category candidate —
    // including kind-free account mails that carry NO amount. A welcome mail
    // must never flip a paid recurring row to free.
    const recurring = {
      ...existingRow(),
      category: "recurring",
      price: 41,
      billing: "Monthly",
      frequency: "Monthly",
      icon_key: "netgate",
      name: "Netgate",
    } as Subscription;
    mockScan.mockResolvedValueOnce({
      candidates: [
        sparseCandidate({
          merchantKey: "netgate",
          merchant: "Netgate",
          kind: "free",
          amount: undefined,
          evidence: ["proof:doc-number LT-9"],
        }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [recurring],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
  });

  it("a single message with only GENERIC proof does not clear the stamp", async () => {
    // R38 audit fix: receipt/invoice/statement WORDS are soft anchors R27
    // distrusts — they are not a proven payment.
    mockScan.mockResolvedValueOnce({
      candidates: [
        sparseCandidate({
          amount: 47.25,
          evidence: ["proof:receipt-word"],
        }),
      ],
    });

    await importFromConnectedMailboxes({
      userId: "u1",
      existing: [existingRow()],
      addSubscription,
      updateSubscription,
    });

    expect(updateSubscription).not.toHaveBeenCalled();
  });
});
