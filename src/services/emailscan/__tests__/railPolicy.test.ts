/**
 * R38 P2: billing rails never mint in their own name.
 *  - Play/Apple receipts re-key to the receipt's item app (markup top tier,
 *    subject/body "for X" fallback); first-party Apple items stay Apple.
 *  - Unresolvable or multi-item receipts are the honest AGGREGATE keyed to
 *    the rail — SPARSE always, never recurring.
 *  - Squarespace is a processor rail: its mail keys the receipt SITE/domain
 *    or DROPS. "Squarespace" can never mint as a merchant from any tier.
 */
import { classifyMessage, resolveMerchant } from "../classifier";
import type { NormalizedMessage } from "../types";

function base(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    mailboxId: "workspace:david@bohbotweb.com",
    messageId: "rail-" + Math.random().toString(36).slice(2, 8),
    from: "Google Play <noreply-play@google.com>",
    subject: "Your Google Play order",
    date: "2026-09-01T00:00:00.000Z",
    text: "Order number: GPA.3315-1234-5678-90123. Total charged $4.99.",
    ...overrides,
  };
}

function orderHtml(items: string[], price = 4.99): string {
  const itemJson = items
    .map((n) => JSON.stringify({ "@type": "Product", name: n }))
    .join(",");
  return `<script type="application/ld+json">{"@type":"Order",
    "seller":{"name":"Google Play"},
    "orderedItem":[${itemJson}],
    "acceptedOffer":{"price":${price},"priceCurrency":"USD"}}</script>`;
}

describe("Play rail receipts re-key to the item app", () => {
  it("a markup item keys the app (recurring subject stays recurring)", () => {
    const hit = classifyMessage(
      base({
        subject: "Your Google Play subscription has renewed",
        html: orderHtml(["Tinder"], 19.99),
        text: "Your subscription renewed. Total charged $19.99.",
      }),
    );
    expect(hit.kind).toBe("recurring");
    expect(hit.merchantKey).toBe("tinder");
    expect(hit.merchantName).toBe("Tinder");
    expect(hit.evidence).toContain("rail-item:tinder");
  });

  it("a one-time IAP item keys the app as sparse", () => {
    const hit = classifyMessage(
      base({
        subject: "Your Google Play order",
        html: orderHtml(["Coin Pack XL"], 4.99),
      }),
    );
    expect(hit.kind).toBe("sparse");
    expect(hit.merchantKey).toBe("coin-pack-xl");
  });

  it("subject 'order for X' re-keys without markup", () => {
    const hit = classifyMessage(
      base({
        subject: "Your Google Play order for Spotify Premium",
        text: "Order GPA.1111-2222. Total charged $10.99.",
      }),
    );
    expect(hit.merchantKey).toBe("spotify-premium");
  });
});

describe("unresolvable rail receipts are the honest aggregate SPARSE", () => {
  it("a recurring-subject receipt with no item never mints rail recurring", () => {
    const hit = classifyMessage(
      base({
        subject: "Your Google Play subscription has renewed",
        text: "Order GPA.3315-1234-5678-90123 renews. Total charged $19.99.",
      }),
    );
    expect(hit.merchantKey).toBe("google-play");
    expect(hit.kind).toBe("sparse");
    expect(hit.evidence).toContain("rail:aggregate-sparse");
  });

  it("a multi-item receipt is an aggregate, not one app", () => {
    const hit = classifyMessage(
      base({ html: orderHtml(["Tinder", "Coin Pack XL"], 24.98) }),
    );
    expect(hit.merchantKey).toBe("google-play");
    expect(hit.kind).toBe("sparse");
  });

  it("a prose tail ('order for your continued support') never mints a merchant", () => {
    // R38 P2 audit fix: subject-tail extraction must not turn receipt
    // scaffolding into a merchant — stopwords and long tails are rejected
    // and the receipt falls back to the honest aggregate.
    const hit = classifyMessage(
      base({ subject: "Your Google Play order for your continued support" }),
    );
    expect(hit.merchantKey).toBe("google-play");
    expect(hit.kind).toBe("sparse");
    expect(hit.evidence).toContain("rail:aggregate-sparse");
    expect(hit.merchantName).toBe("Google Play");
  });
});

describe("Apple rail: first-party stays Apple, third-party re-keys", () => {
  it("an Apple One receipt keeps the Apple key (first-party item)", () => {
    const hit = classifyMessage(
      base({
        from: "Apple <no_reply@apple.com>",
        subject: "Your Apple One subscription has renewed",
        html: orderHtml(["Apple One"], 29.95),
      }),
    );
    expect(hit.merchantKey).toBe("apple");
    expect(hit.kind).toBe("recurring");
  });

  it("a third-party app receipt re-keys to the app", () => {
    const hit = classifyMessage(
      base({
        from: "Apple <no_reply@apple.com>",
        subject: "Your receipt from the App Store",
        html: orderHtml(["Tinder"], 9.99),
      }),
    );
    expect(hit.merchantKey).toBe("tinder");
    expect(hit.kind).toBe("sparse");
  });
});

describe("Squarespace is a rail: site/domain or drop", () => {
  it("a domain renewal keys the domain, not Squarespace", () => {
    const hit = classifyMessage(
      base({
        from: "Squarespace <no-reply@squarespace.com>",
        subject: "You will be charged for your domain renewal in 15 days",
        text: "Your domain renewal for bohbotweb.com is scheduled.",
      }),
    );
    expect(hit.merchantKey).toBe("bohbotweb-com");
    expect(hit.merchantName).toBe("bohbotweb.com");
    expect(hit.evidence).toContain("processor:squarespace");
  });

  it("unresolvable Squarespace mail DROPS, never mints", () => {
    const r = resolveMerchant(
      base({
        from: "Squarespace <no-reply@squarespace.com>",
        subject: "Your Squarespace subscription",
        text: "Thanks for being a customer.",
      }),
    );
    expect(r.drop).toBe(true);
    expect(r.evidence[0]).toBe("drop:processor:squarespace");
  });

  it("'Squarespace' can never mint from any name tier (processor guard)", () => {
    const r = resolveMerchant(
      base({
        from: "Squarespace <billing@arandomhost.com>",
        subject: "Your Squarespace order",
        text: "Order confirmed.",
      }),
    );
    expect(r.merchantKey).not.toBe("squarespace");
  });
});
