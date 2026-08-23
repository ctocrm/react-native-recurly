import {
  classifyMessage,
  classifySubject,
  merchantFromAddress,
} from "../classifier";
import {
  ALL_FIXTURES,
  FIXTURE_NEWSLETTER,
  FIXTURE_ORDER,
  FIXTURE_OTP_DROP,
  FIXTURE_PDF_AMOUNT_UNKNOWN,
  FIXTURE_RENEWAL,
  FIXTURE_RESET,
  FIXTURE_USAGE_INVOICE,
  FIXTURE_WELCOME,
} from "../fixtures";
import { candidateToSubscription } from "../importCandidate";
import { buildCandidateMap, filterCandidates } from "../rollup";
import type { NormalizedMessage } from "../types";
import { DEFAULT_DISPLAY_FILTERS } from "../types";

describe("emailscan classifier (subject-first)", () => {
  it("names the merchant from the From domain", () => {
    expect(merchantFromAddress("GitHub <noreply@github.com>")).toEqual({
      merchantKey: "github",
      merchantName: "Github",
    });
    expect(merchantFromAddress("billing@linode.com").merchantKey).toBe(
      "linode",
    );
    // ccTLDs / public suffixes are not merchants.
    expect(merchantFromAddress("noreply@proton.me")).toEqual({
      merchantKey: "proton",
      merchantName: "Proton",
    });
    expect(merchantFromAddress("hello@linear.app").merchantKey).toBe("linear");
    expect(merchantFromAddress("billing@x.ai").merchantKey).toBe("x");
  });

  it("classifies the planned fixture subjects", () => {
    expect(classifySubject(FIXTURE_WELCOME.subject)).toBe("account");
    expect(classifySubject(FIXTURE_RESET.subject)).toBe("security");
    expect(classifySubject(FIXTURE_RENEWAL.subject)).toBe("recurring");
    expect(classifySubject(FIXTURE_USAGE_INVOICE.subject)).toBe("sparse");
    expect(classifySubject(FIXTURE_ORDER.subject)).toBe("sparse");
    expect(classifySubject(FIXTURE_PDF_AMOUNT_UNKNOWN.subject)).toBe(
      "recurring",
    );
    expect(classifySubject(FIXTURE_NEWSLETTER.subject)).toBe("drop");
    expect(classifySubject(FIXTURE_OTP_DROP.subject)).toBe("drop");
  });

  it("does not read body for account or security", () => {
    const welcome = classifyMessage({
      ...FIXTURE_WELCOME,
      text: "Ignore this $99.00 /mo trap in a welcome mail.",
    });
    expect(welcome.kind).toBe("free");
    expect(welcome.needsBody).toBe(false);
    expect(welcome.amount).toBeUndefined();

    const reset = classifyMessage(FIXTURE_RESET);
    expect(reset.kind).toBe("free");
    expect(reset.needsBody).toBe(false);
  });

  it("parses recurring money and keeps amount-unknown when only a PDF is present", () => {
    const renewal = classifyMessage(FIXTURE_RENEWAL);
    expect(renewal.kind).toBe("recurring");
    expect(renewal.amount).toBe(14.99);
    expect(renewal.currency).toBe("USD");
    expect(renewal.cadence).toBe("monthly");
    expect(renewal.amountUnknown).toBe(false);

    const pdf = classifyMessage(FIXTURE_PDF_AMOUNT_UNKNOWN);
    expect(pdf.kind).toBe("recurring");
    expect(pdf.amount).toBeUndefined();
    expect(pdf.amountUnknown).toBe(true);
    expect(pdf.cadence).toBe("unknown");
  });

  it("parses sparse usage and order amounts", () => {
    const usage = classifyMessage(FIXTURE_USAGE_INVOICE);
    expect(usage.kind).toBe("sparse");
    expect(usage.amount).toBe(8.4);
    expect(usage.merchantKey).toBe("linode");

    const order = classifyMessage(FIXTURE_ORDER);
    expect(order.kind).toBe("sparse");
    expect(order.amount).toBe(12.49);
    expect(order.merchantKey).toBe("amazon");
  });

  it("drops newsletter and OTP-only mail", () => {
    expect(classifyMessage(FIXTURE_NEWSLETTER).kind).toBeNull();
    expect(classifyMessage(FIXTURE_OTP_DROP).kind).toBeNull();
  });

  it("does not treat Stripe as a merchant; names the real seller when present", () => {
    const unnamed = classifyMessage({
      mailboxId: "proton:david@picksandshovels.app",
      messageId: "stripe-unnamed",
      from: "Stripe <receipts@stripe.com>",
      subject: "Receipt from Stripe",
      date: "2026-08-01T12:00:00.000Z",
    });
    expect(unnamed.kind).toBeNull();
    expect(unnamed.merchantKey).toBe("stripe");
    expect(unnamed.evidence).toEqual(
      expect.arrayContaining(["drop:processor:stripe"]),
    );

    const named = classifyMessage({
      mailboxId: "proton:david@picksandshovels.app",
      messageId: "stripe-named",
      from: "Stripe <receipts@stripe.com>",
      subject: "Receipt from Linear",
      date: "2026-08-01T12:00:00.000Z",
      text: "You paid Linear $8.00 /mo via Stripe.",
    });
    expect(named.kind).toBe("sparse");
    expect(named.merchantKey).toBe("linear");
    expect(named.merchantName).toBe("Linear");
    expect(named.evidence).toEqual(
      expect.arrayContaining(["processor:stripe"]),
    );
  });

  it("drops self-sent mail instead of naming it Me", () => {
    const selfNamed = classifyMessage({
      mailboxId: "proton:david@picksandshovels.app",
      messageId: "self-me",
      from: "Me",
      subject: "Receipt for my notes",
      date: "2026-08-01T12:00:00.000Z",
    });
    expect(selfNamed.kind).toBeNull();
    expect(selfNamed.evidence).toEqual(
      expect.arrayContaining(["drop:self-mail"]),
    );

    const selfAddr = classifyMessage({
      mailboxId: "proton:david@picksandshovels.app",
      messageId: "self-addr",
      from: "David <david@picksandshovels.app>",
      subject: "Your subscription reminder",
      date: "2026-08-01T12:00:00.000Z",
    });
    expect(selfAddr.kind).toBeNull();
    expect(selfAddr.evidence).toEqual(
      expect.arrayContaining(["drop:self-mail"]),
    );
  });
});

describe("emailscan rollup + display filters", () => {
  const githubInvoice: NormalizedMessage = {
    mailboxId: "fixture-mailbox",
    messageId: "invoice-github",
    from: "GitHub <noreply@github.com>",
    subject: "Your GitHub subscription invoice",
    date: "2026-08-10T12:00:00.000Z",
    text: "GitHub Team is $4.00 /mo.",
  };

  it("upgrades welcome+reset+invoice to one paid GitHub row", () => {
    const map = buildCandidateMap(
      [FIXTURE_WELCOME, FIXTURE_RESET, githubInvoice].map(classifyMessage),
    );
    const github = map.filter((c) => c.merchantKey === "github");
    expect(github).toHaveLength(1);
    expect(github[0].kind).toBe("recurring");
    expect(github[0].amount).toBe(4);
    expect(github[0].messageIds).toEqual(
      expect.arrayContaining([
        "welcome-github",
        "reset-github",
        "invoice-github",
      ]),
    );
  });

  it("does not smash Amazon Prime renewal into an Amazon order", () => {
    const map = buildCandidateMap(
      [FIXTURE_RENEWAL, FIXTURE_ORDER].map(classifyMessage),
    );
    const amazon = map.filter((c) => c.merchantKey === "amazon");
    expect(amazon.map((c) => c.kind).sort()).toEqual(["recurring", "sparse"]);
  });

  it("keeps recurring-without-amount as recurring unknown, not free", () => {
    const map = buildCandidateMap([
      classifyMessage(FIXTURE_PDF_AMOUNT_UNKNOWN),
    ]);
    expect(map).toHaveLength(1);
    expect(map[0].kind).toBe("recurring");
    expect(map[0].amountUnknown).toBe(true);
    expect(map[0].amount).toBeUndefined();
  });

  it("default display filter is recurring only and does not drop cache rows", () => {
    const map = buildCandidateMap(ALL_FIXTURES.map(classifyMessage));
    const kinds = new Set(map.map((c) => c.kind));
    expect(kinds.has("recurring")).toBe(true);
    expect(kinds.has("sparse")).toBe(true);

    const shown = filterCandidates(map, DEFAULT_DISPLAY_FILTERS);
    expect(shown.every((c) => c.kind === "recurring")).toBe(true);
    expect(shown.length).toBeLessThan(map.length);

    const withFree = filterCandidates(map, {
      recurring: false,
      sparse: false,
      free: true,
    });
    expect(withFree.every((c) => c.kind === "free")).toBe(true);
  });

  it("does not invent rows from a newsletter-only inbox", () => {
    const map = buildCandidateMap(
      [FIXTURE_NEWSLETTER, FIXTURE_OTP_DROP].map(classifyMessage),
    );
    expect(map).toEqual([]);
  });
});

describe("emailscan subject amounts + no fake $0", () => {
  it("reads a dollar amount from the subject when the body is missing", () => {
    const hit = classifyMessage({
      mailboxId: "proton:david@picksandshovels.app",
      messageId: "github-subject-only",
      from: "GitHub <noreply@github.com>",
      subject: "Your GitHub invoice for $4.00",
      date: "2026-08-01T12:00:00.000Z",
    });
    expect(hit.kind).toBe("sparse");
    expect(hit.amount).toBe(4);
    expect(hit.amountUnknown).toBe(false);
  });

  it("classifies a Proton bill found in the Proton mailbox", () => {
    const hit = classifyMessage({
      mailboxId: "proton:david@picksandshovels.app",
      messageId: "proton-invoice",
      from: "Proton <noreply@proton.me>",
      subject: "Your Proton subscription $4.99",
      date: "2026-08-01T12:00:00.000Z",
    });
    expect(hit.merchantKey).toBe("proton");
    expect(hit.kind).toBe("recurring");
    expect(hit.amount).toBe(4.99);
    expect(hit.subjectClass).toBe("recurring");
  });

  it("classifies a Tuta invoice found in the Tuta mailbox", () => {
    const hit = classifyMessage({
      mailboxId: "tuta:picksandshovels@tutamail.com",
      messageId: "tuta-invoice",
      from: "system@tutanota.de",
      subject: "New invoice for Tuta $12.00",
      date: "2026-08-01T12:00:00.000Z",
    });
    expect(hit.merchantKey).toBe("tutanota");
    expect(hit.kind).toBe("sparse");
    expect(hit.amount).toBe(12);
    expect(hit.subjectClass).toBe("sparse");
  });

  it("refuses to invent $0 when importing an amount-unknown candidate", () => {
    expect(() =>
      candidateToSubscription({
        mailboxId: "proton:david@picksandshovels.app",
        merchantKey: "proton",
        merchant: "Proton",
        kind: "recurring",
        amountUnknown: true,
        evidence: ["amount-unknown"],
        messageIds: ["proton-welcome"],
        confidence: "medium",
      }),
    ).toThrow(/refusing to invent \$0/);
  });
});
