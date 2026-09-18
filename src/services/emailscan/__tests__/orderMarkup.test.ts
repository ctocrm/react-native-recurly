/**
 * R38 Phase 1: schema.org Order markup extraction (JSON-LD in email HTML).
 * Fixtures follow the canonical schema.org v30.1 Order example verified
 * 2026-09-18: price/priceCurrency on the NESTED acceptedOffer (Offer),
 * orderedItem arrays with nested Product/Service names, confirmationNumber
 * as the modern orderNumber.
 */
import { classifyMessage } from "../classifier";
import { extractOrderMarkup } from "../orderMarkup";
import type { NormalizedMessage } from "../types";

const CANONICAL = `
<html><body>
<div>Your order is confirmed.</div>
<script type="application/ld+json">
{
  "@context": "https://schema.org/",
  "@type": "Order",
  "seller": { "@type": "Organization", "name": "ACME Supplies" },
  "customer": { "@type": "Person", "name": "Jane Doe" },
  "confirmationNumber": "def-456",
  "orderStatus": "https://schema.org/OrderProcessing",
  "paymentMethod": "Visa ending in 1111",
  "orderDate": "2026-09-18",
  "acceptedOffer": {
    "@type": "Offer",
    "price": "74.84",
    "priceCurrency": "USD",
    "itemOffered": { "@type": "Product", "name": "Brake rotor" }
  },
  "orderedItem": [
    {
      "@type": "OrderItem",
      "orderItemNumber": "abc123",
      "orderQuantity": 1,
      "orderedItem": { "@type": "Product", "name": "Widget" }
    },
    {
      "@type": "OrderItem",
      "orderItemNumber": "def456",
      "orderQuantity": 3,
      "orderedItem": { "@type": "Product", "name": "Widget accessories" }
    }
  ]
}
</script>
</body></html>`;

describe("R38 extractOrderMarkup", () => {
  it("parses the canonical multi-item Order (price on acceptedOffer)", () => {
    const m = extractOrderMarkup(CANONICAL);
    expect(m).not.toBeNull();
    expect(m!.seller).toBe("ACME Supplies");
    expect(m!.price).toBe(74.84);
    expect(m!.currency).toBe("USD");
    expect(m!.items).toEqual(["Widget", "Widget accessories", "Brake rotor"]);
    expect(m!.orderNumber).toBe("def-456");
    expect(m!.orderStatus).toBe("OrderProcessing");
    expect(m!.paymentMethod).toBe("Visa ending in 1111");
    expect(m!.orderDate).toBe("2026-09-18");
  });

  it("accepts legacy orderNumber", () => {
    const m = extractOrderMarkup(`<script type="application/ld+json">
      {"@type":"Order","orderNumber":"335210675"}
    </script>`);
    expect(m!.orderNumber).toBe("335210675");
  });

  it("finds Orders nested in @graph with mixed-case type", () => {
    const m = extractOrderMarkup(`<script type="application/ld+json">
      {"@context":"https://schema.org","@graph":[
        {"@type":"Organization","name":"Rail"},
        {"@type":"order","seller":{"name":"Squarespace Store"},
         "acceptedOffer":{"price":41,"priceCurrency":"USD"}}
      ]}
    </script>`);
    expect(m!.seller).toBe("Squarespace Store");
    expect(m!.price).toBe(41);
  });

  it("returns null for html without ld+json (Google-Play-style table receipt)", () => {
    const playStyle = `<html><body>
      <table><tr><td>LinkedIn Premium</td><td>$57.48</td></tr></table>
    </body></html>`;
    expect(extractOrderMarkup(playStyle)).toBeNull();
  });

  it("returns null for empty/absent html", () => {
    expect(extractOrderMarkup(null)).toBeNull();
    expect(extractOrderMarkup("")).toBeNull();
  });

  it("survives malformed JSON blocks next to valid ones", () => {
    const m = extractOrderMarkup(`<div>x</div>
      <script type="application/ld+json">{broken json</script>
      <script type="application/ld+json">
        {"@type":"Order","seller":"Good Co","acceptedOffer":{"priceCurrency":"EUR","price":"12,50"}}
      </script>`);
    expect(m!.seller).toBe("Good Co");
    expect(m!.price).toBe(12.5);
    expect(m!.currency).toBe("EUR");
  });
});

describe("R38 classifier wiring — Order markup as top evidence tier", () => {
  const orderHtml = `<html><body>
    <div>Order confirmed — thanks!</div>
    <script type="application/ld+json">
    {"@context":"https://schema.org/","@type":"Order",
     "seller":{"@type":"Organization","name":"RockAuto"},
     "confirmationNumber":"360168252",
     "acceptedOffer":{"@type":"Offer","price":"74.84","priceCurrency":"USD"},
     "orderedItem":[{"@type":"OrderItem","orderedItem":{"@type":"Product","name":"Brake rotor"}}]}
    </script>
  </body></html>`;

  const msg = (over: Partial<NormalizedMessage>): NormalizedMessage => ({
    mailboxId: "workspace:david@bohbotweb.com",
    messageId: "om-1",
    from: "RockAuto <noreply@rockauto.com>",
    subject: "RockAuto Order Confirmation 360168252",
    date: "2026-09-16",
    ...over,
  });

  it("Order markup = strong proof; price is authoritative over body regex", () => {
    // Body text carries a DIFFERENT decoy amount — markup must win.
    const hit = classifyMessage(
      msg({
        html: orderHtml,
        text: "Total: $999.99 thanks for your order",
      }),
    );
    expect(hit.kind).not.toBeNull();
    expect(hit.amount).toBe(74.84);
    expect(hit.currency).toBe("USD");
    expect(hit.evidence).toContain("proof:order-markup");
    expect(hit.evidence).toContain("markup:order");
    expect(hit.evidence).toContain("markup:order-no 360168252");
    expect(hit.evidence).toContain("markup:items Brake rotor");
    expect(hit.orderMarkup?.seller).toBe("RockAuto");
    expect(hit.confidence).toBe("high");
  });

  it("a promo-looking subject with a real Order never drops (gate order)", () => {
    const hit = classifyMessage(
      msg({
        subject: "Print Subscription is BACK — limited time!",
        text: "Limited time offer. Unsubscribe. Save up to $500.",
        html: orderHtml,
      }),
    );
    // Marketing score is high but the Order payload is proof of charge.
    expect(hit.kind).not.toBeNull();
    expect(hit.evidence).not.toContain("drop:marketing-no-proof");
    expect(hit.evidence).toContain("proof:order-markup");
    expect(hit.evidence).toContain("marketing-with-proof");
  });

  it("markup without a price records seller/items but no proof tag", () => {
    const hit = classifyMessage(
      msg({
        html: `<script type="application/ld+json">
          {"@type":"Order","seller":{"name":"Squarespace"},
           "orderedItem":[{"@type":"Service","name":"Domain renewal"}]}
        </script>`,
      }),
    );
    expect(hit.evidence).toContain("markup:order");
    expect(hit.evidence).not.toContain("proof:order-markup");
    expect(hit.orderMarkup?.items).toEqual(["Domain renewal"]);
  });

  it("no markup — behavior identical to pre-R38 (regression guard)", () => {
    const hit = classifyMessage(msg({ text: "Order total USD 74.84" }));
    expect(hit.amount).toBe(74.84);
    expect(hit.evidence).not.toContain("markup:order");
    expect(hit.orderMarkup).toBeUndefined();
  });
});
