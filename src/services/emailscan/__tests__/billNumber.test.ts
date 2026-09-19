// R18 Phase B: best-effort bill-number extraction + paper-trail carry.
import { extractBillNumber } from "../classifier";
import { candidateToSubscription } from "../importCandidate";
import { rollupCandidates } from "../rollup";
import type { ClassifiedMessage } from "../types";

let seq = 0;
function hit(billNumber?: string): ClassifiedMessage {
  seq += 1;
  return {
    message: {
      mailboxId: "tuta:picksandshovels@tutamail.com",
      messageId: `msg-${seq}`,
      from: "billing@porkbun.com",
      subject: "Order confirmation",
      date: "2026-08-01",
    },
    subjectClass: "sparse",
    merchantKey: "porkbun",
    merchantName: "Porkbun",
    kind: "recurring",
    amount: 47.74,
    amountUnknown: false,
    needsBody: false,
    evidence: [],
    confidence: "high",
    billNumber,
  };
}

describe("extractBillNumber (best-effort, R18)", () => {
  it("pulls invoice/order/receipt numbers", () => {
    expect(extractBillNumber("Invoice #INV-2026-000123 total $47.74")).toBe(
      "INV-2026-000123",
    );
    expect(extractBillNumber("Your order 20260902-48213 is confirmed")).toBe(
      "20260902-48213",
    );
    expect(extractBillNumber("receipt no: 48372911")).toBe("48372911");
  });

  it("extracts Tuta-style long numeric references (2026-09-16 case)", () => {
    expect(
      extractBillNumber(
        "New invoice for Tuta\nInvoice</td><td>number 1915642915167825625098",
      ),
    ).toBe("1915642915167825625098");
  });

  it("grows with the reference: 40 digits still match", () => {
    expect(
      extractBillNumber(
        "Invoice number 1234567890123456789012345678901234567890",
      ),
    ).toBe("1234567890123456789012345678901234567890");
  });

  it("a bare long digit run in an invoice email is accepted", () => {
    expect(
      extractBillNumber(
        "New invoice for Tuta — view it online. Ref 1915642915167825625098",
      ),
    ).toBe("1915642915167825625098");
  });

  it("still refuses a bare digit run without the invoice keyword", () => {
    expect(extractBillNumber("tracking 1915642915167825625098")).toBeUndefined();
  });

  it("refuses prose and digit-less tokens", () => {
    expect(
      extractBillNumber("in order to confirm your subscription"),
    ).toBeUndefined();
    expect(extractBillNumber("your receipt from March")).toBeUndefined();
    expect(extractBillNumber("")).toBeUndefined();
  });
});

describe("bill-number + source paper-trail carry (R18)", () => {
  it("keeps the first known bill number through rollup", () => {
    const candidates = rollupCandidates([hit("INV-1"), hit(undefined)]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].billNumber).toBe("INV-1");
  });

  it("lands on the imported row with the source message id", () => {
    const candidate = rollupCandidates([hit("INV-1")])[0];
    const sub = candidateToSubscription(candidate);
    expect(sub.sourceMessageId).toBe(candidate.messageIds[0]);
    expect(sub.billNumber).toBe("INV-1");
  });
});
