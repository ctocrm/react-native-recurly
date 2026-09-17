/**
 * R29 (2026-09-17): ESP hosts are delivery rails, not merchants. A Shopify
 * store's order mail comes from orders@shopifyemail.com — the STORE is the
 * merchant (From display name / body), never "Shopifyemail". The device had
 * "Shopifyemail sparse $1,439.00 Monthly" minted from the host with a
 * one-off order total (user: "nobody would pay this much monthly").
 */
import { classifyMessage } from "../classifier";
import type { NormalizedMessage } from "../types";

const base = (overrides: Partial<NormalizedMessage>): NormalizedMessage => ({
  mailboxId: "workspace:david@bohbotweb.com",
  messageId: "m-1",
  from: "Acme Store <orders@shopifyemail.com>",
  subject: "Your order #1001",
  date: "2026-09-17",
  ...overrides,
});

describe("R29 ESP-host senders are rails, not merchants", () => {
  it("resolves the store from the From display name, imports sparse", () => {
    const hit = classifyMessage(
      base({
        text: "Order total $89.00. Thank you for your purchase.",
      }),
    );
    expect(hit.merchantKey).toBe("acme-store");
    expect(hit.merchantName).toBe("Acme Store");
    expect(hit.kind).toBe("sparse");
    expect(hit.amount).toBe(89);
    expect(hit.evidence).toContain("esp:display-name");
    expect(hit.cadence).toBeUndefined();
  });

  it("falls back to the body store name when the display name is bare", () => {
    const hit = classifyMessage(
      base({
        from: "orders@shopifyemail.com",
        subject: "Order confirmation",
        text: "Thank you for your purchase from Northwind Supply. Order #55 total $12.50.",
      }),
    );
    expect(hit.merchantKey).toBe("northwind-supply");
    expect(hit.kind).toBe("sparse");
    expect(hit.evidence).toContain("esp:body-store");
  });

  it("drops a bare ESP sender with no store evidence", () => {
    const hit = classifyMessage(
      base({
        from: "no-reply@shopifyemail.com",
        subject: "Your order",
        text: "Thanks. Order total $19.99.",
      }),
    );
    expect(hit.kind).toBeNull();
    expect(hit.evidence).toContain("drop:esp-unresolved");
  });

  it("never mints Shopifyemail from the host", () => {
    const hit = classifyMessage(
      base({
        from: "Acme Store <orders@shopifyemail.com>",
        text: "Order total $89.00.",
      }),
    );
    expect(hit.merchantKey).not.toBe("shopifyemail");
  });

  it("sendgrid-family hosts get the same rail treatment", () => {
    const hit = classifyMessage(
      base({
        from: "Bolt Hardware <receipts@sendgrid.net>",
        subject: "Your receipt",
        text: "Total charged: $42.00. Thank you for your order.",
      }),
    );
    expect(hit.merchantKey).toBe("bolt-hardware");
    expect(hit.amount).toBe(42);
  });
});
