// Phase C: icon-from-email — brand-sent icon seeds extracted at classify time.
import {
  classifyMessage,
  extractEmailIconUrls,
} from "../classifier";
import { rollupCandidates } from "../rollup";
import { FIXTURE_NEWSLETTER } from "../fixtures";
import type { ClassifiedMessage, NormalizedMessage } from "../types";
import {
  canCandidateBeatCached,
  discoverySourceRank,
  isFirstPartyIconSource,
} from "@/services/iconCandidate";

function msg(overrides: Partial<NormalizedMessage> = {}): NormalizedMessage {
  return {
    mailboxId: "gmail:tester@gmail.com",
    messageId: "msg-1",
    from: "Acme Billing <billing@acme.com>",
    subject: "Your Acme subscription renewed — $9.99/mo",
    date: "2026-09-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("extractEmailIconUrls (Phase C extractor)", () => {
  it("extracts a first-party logo URL first, ESP-hosted logo second", () => {
    const { urls } = extractEmailIconUrls(
      msg({
        html: `<img src="https://cdn.esp.net/mail/img/banner.png" width="600" height="120">
               <img src="https://cdn.esp.net/assets/acme_logo.png" alt="Acme logo">
               <img src="https://images.acme.com/mail/logo-mark.png" width="120" height="120">`,
      }),
      "acme.com",
    );
    expect(urls).toEqual([
      "https://images.acme.com/mail/logo-mark.png",
      "https://cdn.esp.net/assets/acme_logo.png",
    ]);
  });

  it("accepts a sized header image without any logo token in the URL", () => {
    const { urls } = extractEmailIconUrls(
      msg({
        html: `<img src="https://cdn.esp.net/a9f2/header.png" width="128" height="128">`,
      }),
      null,
    );
    expect(urls).toEqual(["https://cdn.esp.net/a9f2/header.png"]);
  });

  it("records cid refs as skipped and never emits them as URLs", () => {
    const { urls, cidSkipped } = extractEmailIconUrls(
      msg({
        html: `<img src="cid:logo.png"> <img src="https://acme.com/mail/logo.png">`,
      }),
      "acme.com",
    );
    expect(urls).toEqual(["https://acme.com/mail/logo.png"]);
    expect(cidSkipped).toEqual(["logo.png"]);
  });

  it("drops tracking pixels, data URIs, junk farms, social art, UI chrome", () => {
    const { urls } = extractEmailIconUrls(
      msg({
        html: `<img src="https://click.esp.net/open.aspx?u=1" width="1" height="1">
               <img src="https://cdn.esp.net/pixel.gif" width="2" height="2">
               <img src="data:image/png;base64,AAAA">
               <img src="https://pngimg.com/uploads/acme/acme_logo.png">
               <img src="https://cdn.esp.net/social/og-image.png">
               <img src="https://cdn.esp.net/ui/hamburger-icon.png">
               <img src="https://cdn.esp.net/analytics/beacon.png">`,
      }),
      "acme.com",
    );
    expect(urls).toEqual([]);
  });

  it("upgrades http to https", () => {
    const { urls } = extractEmailIconUrls(
      msg({ html: `<img src="http://images.acme.com/mail/logo.png">` }),
      "acme.com",
    );
    expect(urls).toEqual(["https://images.acme.com/mail/logo.png"]);
  });

  it("ranks signature marks last and dedupes", () => {
    const { urls } = extractEmailIconUrls(
      msg({
        html: `<img src="https://acme.com/mail/logo.png">
               <img src="https://acme.com/mail/signature.png">
               <img src="https://acme.com/mail/logo.png">`,
      }),
      "acme.com",
    );
    expect(urls).toEqual([
      "https://acme.com/mail/logo.png",
      "https://acme.com/mail/signature.png",
    ]);
  });

  it("caps the list at 5 and returns nothing without html", () => {
    const many = Array.from(
      { length: 8 },
      (_, i) =>
        `<img src="https://acme.com/mail/logo-${i}.png" width="100" height="100">`,
    ).join("");
    const capped = extractEmailIconUrls(msg({ html: many }), "acme.com");
    expect(capped.urls).toHaveLength(5);

    const empty = extractEmailIconUrls(msg({ text: "no html here" }), "acme.com");
    expect(empty.urls).toEqual([]);
    expect(empty.cidSkipped).toEqual([]);
  });
});

describe("classifyMessage carries emailIconUrls", () => {
  it("attaches seeds + evidence on a money mail", () => {
    const result = classifyMessage(
      msg({
        html: `<img src="https://images.acme.com/mail/logo.png" width="96" height="96">`,
      }),
    );
    expect(result.emailIconUrls).toEqual([
      "https://images.acme.com/mail/logo.png",
    ]);
    expect(
      result.evidence.some((line) => line.startsWith("icon:email:")),
    ).toBe(true);
  });

  it("attaches seeds on account mail and records cid skips", () => {
    const result = classifyMessage(
      msg({
        subject: "Welcome to Acme",
        html: `<img src="cid:welcome-logo.png"><img src="https://acme.com/mail/logo.png">`,
      }),
    );
    expect(result.kind).toBe("free");
    expect(result.emailIconUrls).toEqual([
      "https://acme.com/mail/logo.png",
    ]);
    expect(
      result.evidence.some((line) => line.startsWith("icon:cid-skip:")),
    ).toBe(true);
  });

  it("never attaches seeds to drop mail", () => {
    const result = classifyMessage({
      ...FIXTURE_NEWSLETTER,
      html: `<img src="https://acme.com/logo.png">`,
    });
    expect(result.kind).toBeNull();
    expect(result.emailIconUrls).toBeUndefined();
  });
});

describe("rollup merges emailIconUrls", () => {
  function hit(overrides: {
    messageId: string;
    html: string;
    date: string;
  }): ClassifiedMessage {
    return classifyMessage(
      msg({
        messageId: overrides.messageId,
        date: overrides.date,
        html: overrides.html,
      }),
    );
  }

  it("unions seed lists best-first and caps at 5", () => {
    const a = hit({
      messageId: "m1",
      date: "2026-09-01T10:00:00.000Z",
      html: `<img src="https://acme.com/a-logo.png" width="100" height="100">`,
    });
    const b = hit({
      messageId: "m2",
      date: "2026-09-02T10:00:00.000Z",
      html: `<img src="https://acme.com/a-logo.png" width="100" height="100">
             <img src="https://acme.com/b-logo.png" width="100" height="100">`,
    });
    const [candidate] = rollupCandidates([a, b]);
    expect(candidate.emailIconUrls).toEqual([
      "https://acme.com/a-logo.png",
      "https://acme.com/b-logo.png",
    ]);
  });
});

describe("email_* provenance (Phase C ranking)", () => {
  it("outranks web discovery but never a cached official-site icon", () => {
    expect(discoverySourceRank("email_logo")).toBe(5);
    expect(discoverySourceRank("email_signature")).toBe(5);
    expect(canCandidateBeatCached("email_logo", "bing_images")).toBe(true);
    expect(canCandidateBeatCached("email_logo", "official_favicon")).toBe(
      false,
    );
    expect(canCandidateBeatCached("email_logo", "official_apple_touch")).toBe(
      false,
    );
  });

  it("counts as first-party provenance for publish/score paths", () => {
    expect(isFirstPartyIconSource("email_logo")).toBe(true);
    expect(isFirstPartyIconSource("email_signature")).toBe(true);
    expect(isFirstPartyIconSource("bing_images")).toBe(false);
  });
});

