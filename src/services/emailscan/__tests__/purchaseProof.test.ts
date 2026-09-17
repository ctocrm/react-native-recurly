/**
 * R27 purchase-proof gate (2026-09-16): a price in an email is not a charge.
 * The Pixel Watch 5 pre-order ad ("$549.99", "monthly", a YouTube social
 * footer) minted a "YouTube sparse $549.99 Monthly" subscription. Rules:
 *  - amounts only exist with a payment anchor (proof);
 *  - marketing evidence without proof drops the message;
 *  - provider hints (Gmail category, bulk headers) are optional weights —
 *    the gate must stand without them;
 *  - cadence needs a strong billing statement (or weak word + proof on a
 *    recurring hit);
 *  - Google Store / Play are distinct products, never YouTube.
 */
import { classifyMessage } from "../classifier";
import type { NormalizedMessage } from "../types";

const PIXEL_WATCH_AD: NormalizedMessage = {
  mailboxId: "workspace:david@bohbotweb.com",
  messageId: "pixel-ad-1",
  from: "Google Store <googlestore-noreply@google.com>",
  subject: "Pre-order the new Google Pixel Watch 5",
  date: "2026-08-12",
  text: [
    "Meet the new Google Pixel Watch 5.",
    "From $549.99. Pre-order yours today and save $.",
    "Learn more about the monthly financing option.",
    "Unsubscribe",
    "Follow us on YouTube",
  ].join(" "),
};

const base = (overrides: Partial<NormalizedMessage>): NormalizedMessage => ({
  mailboxId: "workspace:david@bohbotweb.com",
  messageId: "m-1",
  from: "Acme <billing@acme.com>",
  subject: "Your receipt",
  date: "2026-09-16",
  ...overrides,
});

describe("R27 purchase-proof gate", () => {
  it("drops the Pixel Watch pre-order ad — no kind, no amount (hints present)", () => {
    const hit = classifyMessage({
      ...PIXEL_WATCH_AD,
      hints: { gmailCategory: "CATEGORY_PROMOTIONS", listUnsubscribe: true },
    });
    expect(hit.kind).toBeNull();
    expect(hit.amount).toBeUndefined();
    expect(hit.evidence).toContain("drop:marketing-no-proof");
    expect(hit.evidence).toContain("gmail:promotions");
    expect(hit.evidence).toContain("header:list-unsubscribe");
    // The sender is Google Store, not YouTube — even in a drop.
    expect(hit.merchantKey).toBe("google-store");
  });

  it("drops the same ad WITHOUT provider hints (heuristic-only path)", () => {
    const hit = classifyMessage(PIXEL_WATCH_AD);
    expect(hit.kind).toBeNull();
    expect(hit.amount).toBeUndefined();
    expect(hit.evidence).toContain("drop:marketing-no-proof");
    expect(hit.evidence).not.toContain("gmail:promotions");
    expect(hit.merchantKey).toBe("google-store");
  });

  it("keeps a real Google Store order — distinct product, proof-anchored amount", () => {
    const hit = classifyMessage(
      base({
        messageId: "gs-order-1",
        from: "Google Store <googlestore-noreply@google.com>",
        subject: "Your Google Store order confirmation",
        text: "Thank you for your order. Order number GSRD-US-123456789. Total charged: $89.00 to your Visa ending 4321.",
      }),
    );
    expect(hit.kind).toBe("sparse");
    expect(hit.merchantKey).toBe("google-store");
    expect(hit.amount).toBe(89);
    expect(hit.evidence.some((e) => e.startsWith("proof:"))).toBe(true);
    expect(hit.cadence).toBeUndefined();
  });

  it("keys a YouTube Premium invoice to youtube via subject/phrase, not body noise", () => {
    const hit = classifyMessage(
      base({
        messageId: "yt-prem-1",
        from: "Google <noreply-youtube@google.com>",
        subject: "Your YouTube Premium invoice",
        text: "Your YouTube Premium membership. $13.99/mo. Payment method: Visa ending 4321. Billed monthly.",
      }),
    );
    expect(hit.kind).toBe("sparse");
    expect(hit.merchantKey).toBe("youtube");
    expect(hit.amount).toBe(13.99);
    expect(hit.cadence).toBe("monthly");
    // "Billed monthly." is the strong anchor that fired (price-per-month is
    // the equally-strong fallback).
    expect(
      hit.evidence.some(
        (e) => e === "cadence:billed-monthly" || e === "cadence:price-per-month",
      ),
    ).toBe(true);
  });

  it("does not mint cadence from a weak word without proof (old bug class)", () => {
    const hit = classifyMessage(
      base({
        messageId: "weak-1",
        from: "Acme News <hello@acmenews.com>",
        subject: "Your subscription to Acme News",
        text: "Welcome aboard. You can switch to the monthly digest anytime in settings.",
      }),
    );
    expect(hit.kind).toBe("recurring");
    // Recurring with no cadence evidence keeps the honest "unknown".
    expect(hit.cadence).toBe("unknown");
    expect(hit.amountUnknown).toBe(true);
    expect(hit.confidence).toBe("low");
  });

  it("weak cadence word counts on a payment-proven recurring hit", () => {
    const hit = classifyMessage(
      base({
        messageId: "weak-2",
        subject: "Your subscription",
        text: "Card ending 1111 on file. We'll email you monthly about your account.",
      }),
    );
    expect(hit.kind).toBe("recurring");
    expect(hit.cadence).toBe("monthly");
    expect(hit.evidence).toContain("cadence:weak-monthly");
  });

  it("a bulk-header hint alone can drop a proof-less money subject", () => {
    const hit = classifyMessage(
      base({
        messageId: "bulk-1",
        from: "Deals <offers@acme.com>",
        subject: "Your Acme order",
        text: "See everything that's included with your account.",
        hints: { listUnsubscribe: true },
      }),
    );
    expect(hit.kind).toBeNull();
    expect(hit.evidence).toContain("header:list-unsubscribe");
    expect(hit.evidence).toContain("drop:marketing-no-proof");
  });

  it("a plain statement survives soft marketing phrasing (no false drop)", () => {
    const hit = classifyMessage(
      base({
        messageId: "stmt-1",
        from: "First Bank <statements@firstbank.com>",
        subject: "Your March statement is now available",
        text: "Log in to view your statement. Learn more about paperless billing.",
      }),
    );
    expect(hit.kind).toBe("sparse");
    expect(hit.amountUnknown).toBe(true);
    expect(hit.evidence).not.toContain("drop:marketing-no-proof");
    expect(hit.evidence).toContain("marketing-with-proof");
  });

  it("GPA order ids prove a Google Play charge and key the product", () => {
    const hit = classifyMessage(
      base({
        messageId: "gpa-1",
        from: "Google Play <noreply-play@google.com>",
        subject: "Your Google Play order",
        text: "Order number: GPA.3315-1234-5678-90123. Total charged $4.99.",
      }),
    );
    expect(hit.merchantKey).toBe("google-play");
    expect(hit.amount).toBe(4.99);
    expect(hit.evidence).toContain("proof:gpa-order");
  });

  it("a bare body product word no longer keys the merchant (social footer)", () => {
    const hit = classifyMessage(
      base({
        messageId: "footer-1",
        from: "Acme <billing@acme.com>",
        subject: "Your Acme invoice",
        text: "Invoice #A-777 for $12.00. Follow us on YouTube, X and Facebook.",
      }),
    );
    expect(hit.merchantKey).toBe("acme");
    expect(hit.kind).toBe("sparse");
    expect(hit.amount).toBe(12);
  });
});
