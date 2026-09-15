/**
 * Subject-first classifier. Body and invoice-like attachments run only
 * for money classes (recurring / sparse). No LLM.
 */
import {
  canonicalBrandFor,
  officialDomainFromAddress,
} from "@/services/domain/officialDomain";
import {
  hasDiscoveryUrlSignal,
  isGenericSocialImage,
  isJunkIconFarmHost,
  isUiChromeImage,
} from "@/services/iconCandidate";
import type {
  Cadence,
  ClassifiedMessage,
  MailAttachment,
  NormalizedMessage,
  SubjectClass,
} from "./types";

const LOCAL_PARTS_TO_STRIP = new Set([
  "noreply",
  "no-reply",
  "no_reply",
  "donotreply",
  "do-not-reply",
  "billing",
  "invoice",
  "invoices",
  "mail",
  "email",
  "support",
  "hello",
  "info",
  "notifications",
  "notify",
  "accounts",
  "account",
  "receipts",
  "receipt",
  "payments",
  "payment",
  "team",
]);

const GENERIC_LABELS = new Set([
  "com",
  "net",
  "org",
  "io",
  "co",
  "www",
  "mail",
  "email",
  "smtp",
  "mx",
  // Public suffixes / ccTLDs. Never a merchant name (`proton.me` is not "Me").
  "me",
  "ai",
  "app",
  "dev",
  "xyz",
  "info",
  "biz",
  "us",
  "uk",
  "ca",
  "de",
  "fr",
  "au",
  "in",
  "jp",
  "edu",
  "gov",
]);

/** Payment processors are rails, not merchants the user subscribed to. */
const PAYMENT_PROCESSORS = new Set([
  "stripe",
  "paypal",
  "square",
  "squareup",
  "braintree",
  "paddle",
  "lemonsqueezy",
  "lemon",
  "fastspring",
  "chargebee",
  "recurly",
  "adyen",
  "klarna",
  "afterpay",
  "affirm",
  "venmo",
  "cashapp",
  "wise",
  "transferwise",
  "worldpay",
]);

const SELF_DISPLAY_NAMES = new Set(["me", "you", "myself", "self"]);

const ACCOUNT_RE =
  /\b(welcome|registered|verify(?:\s+your)?\s+email|account\s+created|account\s+creation|new\s+account|confirm\s+your\s+(?:email|account)|thanks\s+for\s+(?:signing|joining)|you(?:'re| are) in|discover\s+the\s+power|secure\s+\w+\s+mailbox)\b/i;

const SECURITY_RE =
  /\b(password\s+reset|reset\s+your\s+password|login\s+alert|new\s+device|new\s+sign[- ]?in|two[- ]factor|2fa|verification\s+code|security\s+alert|suspicious\s+(?:login|activity))\b/i;

const RECURRING_RE =
  /\b(subscription|membership|renewal|renews|renewed|billed\s+(?:monthly|yearly|annually)|monthly\s+(?:plan|membership)|annual\s+(?:plan|membership)|your\s+prime\s+membership)\b/i;

const SPARSE_RE =
  /\b(invoice|usage|statement|in[- ]?app\s+purchase|\biap\b|order|receipt|one[- ]off|overage)\b/i;

const DROP_RE =
  /\b(newsletter|weekly\s+digest|shipping\s+(?:update|confirmation)|your\s+(?:package|order)\s+has\s+shipped|unsubscribe|digest)\b/i;

const OTP_ONLY_RE =
  /\b(one[- ]time\s+(?:pass(?:word|code)|code)|otp|verification\s+code|your\s+code\s+is)\b/i;

const RECURRING_MONEY_RE =
  /(\/mo\b|per\s+month|monthly|annual(?:ly)?|\/yr\b|per\s+year|renews)/i;
const USAGE_MONEY_RE =
  /\b(usage|overage|this\s+period|pay[- ]as[- ]you[- ]go)\b/i;

const INVOICE_NAME_RE = /(invoice|receipt|statement)\.pdf$/i;
const IMAGE_NAME_RE = /\.(png|jpe?g|gif|webp|svg|ico)$/i;

const AMOUNT_RES: { re: RegExp; currency: string; group: number }[] = [
  {
    re: /\$\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/,
    currency: "USD",
    group: 1,
  },
  {
    re: /USD\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/i,
    currency: "USD",
    group: 1,
  },
  {
    re: /€\s*([0-9]{1,3}(?:[.,][0-9]{3})*(?:[.,][0-9]{2})|[0-9]+(?:[.,][0-9]{2}))/,
    currency: "EUR",
    group: 1,
  },
  {
    re: /£\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/,
    currency: "GBP",
    group: 1,
  },
  {
    re: /CAD\s*\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/i,
    currency: "CAD",
    group: 1,
  },
];

export function extractEmailAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  const raw = (angled ? angled[1] : from).trim().toLowerCase();
  return raw;
}

/**
 * Two-label hosts with a 2-letter TLD whose `label.tld` is ≤5 chars
 * (`x.ai`) keep the TLD in the display name so the crawl key is not a
 * 1–2 letter leftover (`x` is skipped; `xai` is crawlable).
 * `x.com` is excluded (3-letter TLD). `proton.me` is too long.
 */
function shortTwoLetterTldMerchant(domain: string): {
  merchantKey: string;
  merchantName: string;
} | null {
  const host = domain.replace(/^www\./, "").toLowerCase();
  const parts = host.split(".").filter(Boolean);
  if (parts.length !== 2) return null;
  const [left, tld] = parts;
  if (!left || tld.length !== 2) return null;
  if (host.length > 5) return null;
  return {
    merchantKey: `${left}${tld}`,
    merchantName: `${left}${tld.toUpperCase()}`,
  };
}

export function merchantFromAddress(from: string): {
  merchantKey: string;
  merchantName: string;
} {
  const email = extractEmailAddress(from);
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : email;
  const short = shortTwoLetterTldMerchant(domain);
  if (short) return short;
  const labels = domain.split(".").filter(Boolean);
  let label = "";
  for (let i = labels.length - 1; i >= 0; i -= 1) {
    const part = labels[i];
    if (!GENERIC_LABELS.has(part)) {
      label = part;
      break;
    }
  }
  if (!label) {
    const local = at >= 0 ? email.slice(0, at) : email;
    label =
      local.split(/[._+-]/).find((p) => !LOCAL_PARTS_TO_STRIP.has(p)) ||
      "unknown";
  }
  const key = label.toLowerCase();
  if (key === "tutanota" || key === "tutamail") {
    return { merchantKey: "tuta", merchantName: "Tuta" };
  }
  const merchantName = label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  // F-2: a product/infra host label is not a brand ("zohoaccounts" is Zoho's
  // accounts host — user-locked: "it's just zoho"). Mint the canonical brand.
  const canonical = canonicalBrandFor(key);
  if (canonical) {
    return { merchantKey: canonical.key, merchantName: canonical.display };
  }
  return { merchantKey: key, merchantName };
}

const GENERIC_MERCHANT_KEYS = new Set([
  "bot",
  "bots",
  "no-reply",
  "noreply",
  "donotreply",
  "do-not-reply",
  "admin",
  "administrator",
  "notifications",
  "notification",
  "newsletter",
  "newsletters",
  "mailer",
  "mailer-daemon",
  "postmaster",
  "bounce",
  "bounces",
  "webmaster",
  "system",
]);

const SELF_DOMAIN_MAILBOX_KINDS = new Set([
  "gmail",
  "workspace",
  "outlook",
  "office365",
  "fastmail",
  "zoho",
  "imap",
]);

export function ownerAddressFromMailbox(mailboxId: string): string | null {
  const colon = mailboxId.indexOf(":");
  if (colon < 0) return null;
  const hint = mailboxId
    .slice(colon + 1)
    .trim()
    .toLowerCase();
  return hint.includes("@") ? hint : null;
}

export function displayNameFrom(from: string): string {
  const angled = from.indexOf("<");
  const raw = (angled >= 0 ? from.slice(0, angled) : from).trim();
  return raw
    .replace(/^["']|["']$/g, "")
    .trim()
    .toLowerCase();
}

export function isPaymentProcessor(merchantKey: string): boolean {
  return PAYMENT_PROCESSORS.has(merchantKey.toLowerCase());
}

export function isSelfMail(message: NormalizedMessage): boolean {
  const fromEmail = extractEmailAddress(message.from);
  const owner = ownerAddressFromMailbox(message.mailboxId);
  if (owner && fromEmail === owner) return true;
  // R3: on custom-domain mailboxes any sender on the owner's own domain is
  // the user's own company (no-reply@bohbotweb.com for david@bohbotweb.com)
  // — never a merchant. Provider-hosted mailboxes (tuta:, proton:) are
  // excluded: their domain belongs to the vendor, and vendor receipts
  // (Tuta/Proton plans) are genuine subscriptions.
  const colon = message.mailboxId.indexOf(":");
  const kind = colon > 0 ? message.mailboxId.slice(0, colon).toLowerCase() : "";
  if (
    owner &&
    fromEmail.includes("@") &&
    owner.includes("@") &&
    SELF_DOMAIN_MAILBOX_KINDS.has(kind)
  ) {
    const ownerDomain = owner.slice(owner.indexOf("@") + 1);
    const fromDomain = fromEmail.slice(fromEmail.indexOf("@") + 1);
    if (ownerDomain && fromDomain === ownerDomain) return true;
  }
  const display = displayNameFrom(message.from);
  if (SELF_DISPLAY_NAMES.has(display)) {
    if (!owner) return true;
    if (fromEmail === owner || !fromEmail.includes("@")) return true;
  }
  const { merchantKey } = merchantFromAddress(message.from);
  if (SELF_DISPLAY_NAMES.has(merchantKey) && !fromEmail.includes("@")) {
    return true;
  }
  return false;
}

function titleCaseMerchant(raw: string): {
  merchantKey: string;
  merchantName: string;
} {
  const cleaned = raw
    .replace(/["'`]/g, "")
    .replace(/\s*[—(].*$/, "")
    .replace(/\s+#\S+$/, "")
    .replace(/\s+\d{3,}$/, "")
    .replace(/^(?:your|a|an|the)\s+/i, "")
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 6) {
    return { merchantKey: "unknown", merchantName: "Unknown" };
  }
  const key = words
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "");
  if (!key || PAYMENT_PROCESSORS.has(key) || SELF_DISPLAY_NAMES.has(key)) {
    return { merchantKey: "unknown", merchantName: "Unknown" };
  }
  const merchantName = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { merchantKey: key, merchantName };
}

/** Real merchant from a processor receipt subject/body. Null if unknown. */
export function merchantFromProcessorText(text: string): {
  merchantKey: string;
  merchantName: string;
} | null {
  const patterns = [
    /(?:receipt|invoice|payment|paid)\s+(?:from|to|for)\s+(.+)$/i,
    /you\s+paid\s+(.+)$/i,
    /(.+?)\s+via\s+(?:stripe|paypal|square|paddle|braintree|lemonsqueezy|fastspring)\b/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    const named = titleCaseMerchant(m[1]);
    if (named.merchantKey !== "unknown") return named;
  }
  return null;
}

/**
 * Phase M (triage honesty): freemail hosts are mailbox providers, not
 * companies. A sender on one of these hosts can NEVER mint the merchant from
 * the host alone — a forwarded bill is re-keyed to the original issuer's
 * From-host inside the forward, and a non-forwarded freemail sender (a small
 * business billing from a personal address) falls back to display-name / body
 * evidence and imports sparse. Not every email is a subscription.
 */
const FREEMAIL_HOSTS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "yahoo.com",
  "icloud.com",
];

function hostMatchesBase(host: string, base: string): boolean {
  return host === base || host.endsWith(`.${base}`);
}

function isFreemailHost(host: string): boolean {
  const h = host.toLowerCase();
  return FREEMAIL_HOSTS.some((base) => hostMatchesBase(h, base));
}

function hostFromAddress(from: string): string | null {
  const email = extractEmailAddress(from);
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : null;
}

/**
 * google.com-family senders are Google the company — resolve to the specific
 * product from subject/body cues, never to "Gmail" (the "$1,439 Gmail"
 * phantom). No cue means the bill is from Google as a whole, not a product
 * the classifier can name; it still never mints a mailbox label.
 */
function isGoogleFamilyHost(host: string): boolean {
  return hostMatchesBase(host.toLowerCase(), "google.com");
}

const GOOGLE_PRODUCT_MATCHERS: {
  re: RegExp;
  key: string;
  name: string;
  host: string;
}[] = [
  {
    re: /\bgoogle\s+workspace\b|\bgsuite\b|\bg\s?suite\b/i,
    key: "google-workspace",
    name: "Google Workspace",
    host: "workspace.google.com",
  },
  {
    re: /\bgoogle\s+cloud\b|\bgoogle\s+cloud\s+platform\b|\bgcp\b/i,
    key: "google-cloud",
    name: "Google Cloud",
    host: "cloud.google.com",
  },
  {
    re: /\bgoogle\s+ads(?:ense|words)?\b/i,
    key: "google-ads",
    name: "Google Ads",
    host: "ads.google.com",
  },
  {
    re: /\bgoogle\s+one\b/i,
    key: "google-one",
    name: "Google One",
    host: "one.google.com",
  },
  {
    re: /\bgoogle\s+play\b|\bplay\s+billing\b/i,
    key: "google-play",
    name: "Google Play",
    host: "play.google.com",
  },
  {
    re: /\bgoogle\s+drive\b/i,
    key: "google-drive",
    name: "Google Drive",
    host: "drive.google.com",
  },
  {
    re: /\byoutube\b/i,
    key: "youtube",
    name: "YouTube",
    host: "youtube.com",
  },
];

function googleProductFromText(
  text: string | null | undefined,
): (typeof GOOGLE_PRODUCT_MATCHERS)[number] | null {
  if (!text) return null;
  for (const m of GOOGLE_PRODUCT_MATCHERS) {
    if (m.re.test(text)) return m;
  }
  return null;
}

const FORWARD_SUBJECT_RE = /(?:^|\s)fwd?\s*:/i;
const FORWARD_BODY_RE = /forwarded message/i;
const QUOTED_FROM_RE = /^\s*From:\s*(.+)$/gim;

/** The first From: line inside a forwarded body whose host can be an issuer
 * (dotted, non-freemail). Freemail inner senders are skipped, not fatal. */
function originalIssuerInForward(
  body: string,
): { from: string; host: string } | null {
  QUOTED_FROM_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = QUOTED_FROM_RE.exec(body)) !== null) {
    const from = m[1].trim();
    const host = hostFromAddress(from);
    if (!host || !host.includes(".") || isFreemailHost(host)) continue;
    return { from, host };
  }
  return null;
}

interface MerchantResolution {
  merchantKey: string;
  merchantName: string;
  officialDomain: string | null;
  evidence: string[];
  drop: boolean;
  /** M: freemail fallback mints import sparse, never recurring. */
  forceSparse?: boolean;
}

function resolveGoogleSender(message: NormalizedMessage): MerchantResolution {
  const product =
    googleProductFromText(message.subject) ??
    googleProductFromText(moneyBodyText(message));
  if (product) {
    return {
      merchantKey: product.key,
      merchantName: product.name,
      officialDomain: product.host,
      evidence: [`google-product:${product.key}`],
      drop: false,
    };
  }
  return {
    merchantKey: "google",
    merchantName: "Google",
    officialDomain: "google.com",
    evidence: ["google:generic"],
    drop: false,
  };
}

function resolveFreemailSender(message: NormalizedMessage): MerchantResolution {
  const body = moneyBodyText(message);
  if (FORWARD_SUBJECT_RE.test(message.subject) || FORWARD_BODY_RE.test(body)) {
    // The quoted From: line must keep its <address> — moneyBodyText strips
    // anything angle-bracketed as markup, so scan the raw text first and the
    // stripped html as a second chance.
    let original = originalIssuerInForward(message.text ?? "");
    if (!original && message.html) {
      original = originalIssuerInForward(stripHtml(message.html));
    }
    if (
      !original &&
      (FORWARD_BODY_RE.test(body) || FORWARD_BODY_RE.test(message.text ?? ""))
    ) {
      return {
        merchantKey: "unknown",
        merchantName: "Unknown",
        officialDomain: null,
        evidence: ["drop:forward-unresolved"],
        drop: true,
      };
    }
    if (original) {
      if (isGoogleFamilyHost(original.host)) {
        const resolved = resolveGoogleSender(message);
        return {
          ...resolved,
          evidence: [`forward:${original.host}`, ...resolved.evidence],
        };
      }
      return {
        ...merchantFromAddress(original.from),
        officialDomain: officialDomainFromAddress(original.from),
        evidence: [`forward:${original.host}`],
        drop: false,
      };
    }
  }
  // Not forwarded: a small business billing from a personal address falls
  // back to display-name, then body, evidence — and imports sparse. A bare
  // address (no angled display name) must not mint from the local part.
  if (message.from.indexOf("<") >= 0) {
    const display = displayNameFrom(message.from);
    if (display && !display.includes("@")) {
      const named = titleCaseMerchant(display);
      if (named.merchantKey !== "unknown") {
        return {
          ...named,
          officialDomain: null,
          evidence: ["freemail:display-name"],
          drop: false,
          forceSparse: true,
        };
      }
    }
  }
  const named = merchantFromProcessorText(body);
  if (named) {
    return {
      ...named,
      officialDomain: null,
      evidence: ["freemail:body"],
      drop: false,
      forceSparse: true,
    };
  }
  return {
    merchantKey: "unknown",
    merchantName: "Unknown",
    officialDomain: null,
    evidence: ["drop:freemail-no-identity"],
    drop: true,
  };
}

export function resolveMerchant(
  message: NormalizedMessage,
): MerchantResolution {
  if (isSelfMail(message)) {
    return {
      merchantKey: "self",
      merchantName: "Self",
      officialDomain: null,
      evidence: ["drop:self-mail"],
      drop: true,
    };
  }
  const fromMerchant = merchantFromAddress(message.from);
  const fromDomain = officialDomainFromAddress(message.from);
  // R7: generic single-word senders ("Bot", "no-reply", "admin", …) are
  // infrastructure, not merchants — never import them as subscription rows.
  if (GENERIC_MERCHANT_KEYS.has(fromMerchant.merchantKey)) {
    return {
      merchantKey: fromMerchant.merchantKey,
      merchantName: fromMerchant.merchantName,
      officialDomain: fromDomain,
      evidence: [`drop:generic-name:${fromMerchant.merchantKey}`],
      drop: true,
    };
  }
  // Phase M (triage honesty): freemail hosts never mint the merchant from
  // the host alone, and google.com-family senders resolve to the specific
  // Google product — never "Gmail".
  const fromHost = hostFromAddress(message.from);
  if (fromHost && isFreemailHost(fromHost)) {
    return resolveFreemailSender(message);
  }
  if (fromHost && isGoogleFamilyHost(fromHost)) {
    return resolveGoogleSender(message);
  }
  if (!isPaymentProcessor(fromMerchant.merchantKey)) {
    return {
      ...fromMerchant,
      officialDomain: fromDomain,
      evidence: [],
      drop: false,
    };
  }
  const named =
    merchantFromProcessorText(message.subject) ||
    (message.text ? merchantFromProcessorText(message.text) : null);
  if (!named) {
    return {
      merchantKey: fromMerchant.merchantKey,
      merchantName: fromMerchant.merchantName,
      officialDomain: null,
      evidence: [`drop:processor:${fromMerchant.merchantKey}`],
      drop: true,
    };
  }
  return {
    ...named,
    officialDomain: null,
    evidence: [`processor:${fromMerchant.merchantKey}`],
    drop: false,
  };
}

export function classifySubject(subject: string): SubjectClass {
  const s = subject.trim();
  if (!s) return "drop";

  if (DROP_RE.test(s) && !RECURRING_RE.test(s)) return "drop";
  if (
    OTP_ONLY_RE.test(s) &&
    !ACCOUNT_RE.test(s) &&
    !SECURITY_RE.test(s) &&
    !SPARSE_RE.test(s) &&
    !RECURRING_RE.test(s)
  ) {
    return "drop";
  }
  if (RECURRING_RE.test(s)) return "recurring";
  if (SPARSE_RE.test(s)) return "sparse";
  if (SECURITY_RE.test(s)) return "security";
  if (ACCOUNT_RE.test(s)) return "account";
  return "drop";
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) =>
      String.fromCharCode(Number.parseInt(n, 10)),
    )
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeMarkup(text: string): boolean {
  return /<\/?[a-z][\s\S]*>/i.test(text) || /&(nbsp|amp|lt|gt|quot|#\d+);/i.test(text);
}

function parseAmount(
  text: string,
): { amount: number; currency: string } | null {
  const total = text.match(
    /total\s+charged[\s\S]{0,80}?(?:USD\s*)?\$?\s*([0-9]{1,3}(?:,[0-9]{3})*(?:\.[0-9]{2})|[0-9]+(?:\.[0-9]{2}))/i,
  );
  if (total?.[1]) {
    const amount = Number.parseFloat(total[1].replace(/,/g, ""));
    if (!Number.isNaN(amount)) return { amount, currency: "USD" };
  }
  for (const { re, currency, group } of AMOUNT_RES) {
    const m = text.match(re);
    if (!m) continue;
    const raw = m[group].replace(/,/g, "").replace(/(\d+),(\d{2})$/, "$1.$2");
    const amount = Number.parseFloat(raw);
    if (!Number.isNaN(amount)) return { amount, currency };
  }
  return null;
}

function inferCadence(text: string): Cadence | undefined {
  if (
    /(\/yr\b|per\s+year|annual(?:ly)?|domain\s+registration|renewal\s+price)/i.test(
      text,
    )
  ) {
    return "yearly";
  }
  if (/(\/mo\b|per\s+month|monthly)/i.test(text)) return "monthly";
  if (/\brenews\b/i.test(text)) return "unknown";
  return undefined;
}

/** R18: clockwork payment-spacing inference. When the same merchant charges
 * like clockwork — EVERY gap between consecutive charges sits inside one
 * cadence band (weekly ≈7d, monthly ≈30d, yearly ≈365d) — that cadence is
 * safe to assume even when the email text never names it. Conservative by
 * design: fewer than 3 charges (2 gaps) or one irregular gap → unknown.
 * Never used to promote sparse merchants to recurring (A-decision). */
export function inferCadenceFromPayments(
  dates: string[],
): "weekly" | "monthly" | "yearly" | undefined {
  const DAY = 86_400_000;
  const times = dates
    .map((d) => new Date(d).getTime())
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  if (times.length < 3) return undefined;
  const intervals: number[] = [];
  for (let i = 1; i < times.length; i += 1) {
    intervals.push((times[i] - times[i - 1]) / DAY);
  }
  const bands: { cadence: "weekly" | "monthly" | "yearly"; min: number; max: number }[] = [
    { cadence: "weekly", min: 5, max: 9 },
    { cadence: "monthly", min: 26, max: 34 },
    { cadence: "yearly", min: 355, max: 375 },
  ];
  for (const band of bands) {
    if (intervals.every((iv) => iv >= band.min && iv <= band.max)) {
      return band.cadence;
    }
  }
  return undefined;
}

/** R18: best-effort bill reference (invoice/order/receipt number). Deliberately
 * conservative: the keyword must sit right next to the id and the id must
 * contain a digit, so prose like "in order to confirm" never matches. Often
 * null — the field stays user-editable. */
const BILL_NUMBER_RE =
  /\b(?:invoice|order|receipt)\s*(?:#|no\.?|number)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9/-]{3,29})\b/i;

export function extractBillNumber(text: string): string | undefined {
  if (!text) return undefined;
  const token = text.match(BILL_NUMBER_RE)?.[1];
  if (!token || !/\d/.test(token)) return undefined;
  return token;
}

// ---------------------------------------------------------------------------
// Phase C: icon-from-email. Brand-sent mail regularly carries the merchant's
// own logo (header <img>, cid inline image, signature mark). Extraction runs
// at classify time because stripBodyForStore drops the html right after; only
// fetchable https URLs survive into emailIconUrls — cid refs are recorded as
// evidence and skipped honestly until a provider supplies fetchable refs.
// ---------------------------------------------------------------------------

const MAX_EMAIL_ICON_URLS = 5;
const EMAIL_IMG_TAG_RE = /<img\b[^>]*>/gi;
const EMAIL_SRC_RE = /\bsrc\s*=\s*["']([^"']+)["']/i;
const EMAIL_ALT_RE = /\balt\s*=\s*["']([^"']*)["']/i;
const EMAIL_WIDTH_RE = /\bwidth\s*=\s*["']?(\d{1,4})/i;
const EMAIL_HEIGHT_RE = /\bheight\s*=\s*["']?(\d{1,4})/i;
const EMAIL_TRACKING_RE =
  /(?:pixel|tracking|open(?:\.aspx|\bstat)|\/o[._]gif|dblclk|beacon|analytics)/i;
const EMAIL_SIGNATURE_TOKEN_RE =
  /(?:^|[/?#_.=-])(?:signature|sig)(?:$|[/?#_.=-])/i;
// Anything under 8px is a tracking/beacon image, never a logo.
const EMAIL_MIN_DIMENSION = 8;

export function extractEmailIconUrls(
  message: NormalizedMessage,
  officialDomain?: string | null,
): { urls: string[]; cidSkipped: string[] } {
  const urls: string[] = [];
  const cidSkipped: string[] = [];
  const html = message.html;
  if (!html || !html.trim()) return { urls, cidSkipped };

  const firstPartyHost = officialDomain
    ? officialDomain.replace(/^www\./i, "").toLowerCase()
    : null;

  const seen = new Set<string>();
  const firstParty: string[] = [];
  const logoish: string[] = [];
  const signatures: string[] = [];

  for (const tag of html.match(EMAIL_IMG_TAG_RE) ?? []) {
    const src = tag.match(EMAIL_SRC_RE)?.[1]?.trim();
    if (!src) continue;
    if (/^cid:/i.test(src)) {
      // Inline attachment refs are the STRONGEST provenance, but no provider
      // supplies a fetchable ref today — record and skip, never fake a URL.
      cidSkipped.push(src.slice(4).split("?")[0]);
      continue;
    }
    if (/^data:/i.test(src)) continue;
    // Email CDNs commonly serve http://; the crawl fetches https cleanly and
    // an https-only candidate list keeps every seed on an upgraded origin.
    let url = src.replace(/^http:\/\//i, "https://");
    let host = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") continue;
      url = parsed.href;
      host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
    } catch {
      continue;
    }
    const alt = tag.match(EMAIL_ALT_RE)?.[1] ?? "";
    const width = Number.parseInt(tag.match(EMAIL_WIDTH_RE)?.[1] ?? "0", 10);
    const height = Number.parseInt(tag.match(EMAIL_HEIGHT_RE)?.[1] ?? "0", 10);
    if (
      (width > 0 && width < EMAIL_MIN_DIMENSION) ||
      (height > 0 && height < EMAIL_MIN_DIMENSION) ||
      EMAIL_TRACKING_RE.test(url.toLowerCase())
    ) {
      continue;
    }
    // Junk PNG farms / social-share art / UI chrome stay out regardless of
    // who sent the mail — the brand forwarded them, it did not make them.
    if (
      isJunkIconFarmHost(url) ||
      isGenericSocialImage(url, "") ||
      isUiChromeImage(url, "")
    ) {
      continue;
    }

    const logoToken =
      hasDiscoveryUrlSignal(url) || hasDiscoveryUrlSignal(alt.toLowerCase());
    const signatureToken = EMAIL_SIGNATURE_TOKEN_RE.test(url.toLowerCase());
    // Explicit logo-sized dimensions (24–256px) also mark a header image.
    const sizedLogo =
      !signatureToken && width >= 24 && width <= 256 && height >= 24 && height <= 256;
    if (!logoToken && !signatureToken && !sizedLogo) continue;

    if (seen.has(url)) continue;
    seen.add(url);
    const firstPartyMatch =
      firstPartyHost !== null &&
      (host === firstPartyHost || host.endsWith(`.${firstPartyHost}`));
    if (signatureToken) signatures.push(url);
    else if (firstPartyMatch) firstParty.push(url);
    else logoish.push(url);
  }

  return {
    urls: [...firstParty, ...logoish, ...signatures].slice(
      0,
      MAX_EMAIL_ICON_URLS,
    ),
    cidSkipped,
  };
}

function isInvoiceAttachment(att: MailAttachment): boolean {
  const name = att.filename || "";
  if (IMAGE_NAME_RE.test(name)) return false;
  return INVOICE_NAME_RE.test(name) || /pdf$/i.test(att.mimeType || "");
}

export function moneyBodyText(message: NormalizedMessage): string {
  const parts: string[] = [];
  if (message.text && message.text.trim()) {
    parts.push(
      looksLikeMarkup(message.text) ? stripHtml(message.text) : message.text,
    );
  } else if (message.html && message.html.trim()) {
    parts.push(stripHtml(message.html));
  }
  for (const att of message.attachments || []) {
    if (!isInvoiceAttachment(att)) continue;
    if (att.text && att.text.trim()) parts.push(att.text);
  }
  return parts.join("\n");
}

export function hasInvoiceAttachment(message: NormalizedMessage): boolean {
  return (message.attachments || []).some(isInvoiceAttachment);
}

export function classifyMessage(message: NormalizedMessage): ClassifiedMessage {
  const subjectClass = classifySubject(message.subject);
  const resolved = resolveMerchant(message);
  const { merchantKey, merchantName, officialDomain } = resolved;
  const evidence = [`subject:${subjectClass}`, ...resolved.evidence];

  if (resolved.drop || subjectClass === "drop") {
    return {
      message,
      subjectClass: resolved.drop ? "drop" : subjectClass,
      merchantKey,
      merchantName,
      officialDomain,
      kind: null,
      amountUnknown: false,
      needsBody: false,
      evidence,
      confidence: "high",
    };
  }

  if (subjectClass === "account" || subjectClass === "security") {
    return {
      message,
      subjectClass,
      merchantKey,
      merchantName,
      officialDomain,
      ...emailIconFields(message, officialDomain, evidence),
      kind: "free",
      amountUnknown: false,
      needsBody: false,
      evidence,
      confidence: subjectClass === "account" ? "medium" : "low",
    };
  }

  const body = moneyBodyText(message);
  const parsed =
    (body ? parseAmount(body) : null) || parseAmount(message.subject);
  const cadence = body
    ? inferCadence(body) || inferCadence(message.subject)
    : inferCadence(message.subject);
  const amountUnknown = !parsed;

  if (parsed) evidence.push(`amount:${parsed.currency} ${parsed.amount}`);
  if (amountUnknown) evidence.push("amount-unknown");
  if (cadence) evidence.push(`cadence:${cadence}`);
  if (body && RECURRING_MONEY_RE.test(body))
    evidence.push("body:recurring-cue");
  if (body && USAGE_MONEY_RE.test(body)) evidence.push("body:usage-cue");

  const kind = resolved.forceSparse
    ? "sparse"
    : subjectClass === "recurring"
      ? "recurring"
      : "sparse";

  return {
    message,
    subjectClass,
    merchantKey,
    merchantName,
    officialDomain,
    ...emailIconFields(message, officialDomain, evidence),
    kind,
    amount: parsed?.amount,
    currency: parsed?.currency,
    cadence: cadence ?? (kind === "recurring" ? "unknown" : undefined),
    billNumber: extractBillNumber(`${message.subject}\n${body}`),
    amountUnknown,
    needsBody: true,
    evidence,
    confidence: parsed ? "high" : amountUnknown ? "medium" : "medium",
  };
}

/** Phase C: attach extracted brand-sent icon seeds + compact evidence lines.
 *  Spread into every non-drop ClassifiedMessage. Drops carry no seeds. */
function emailIconFields(
  message: NormalizedMessage,
  officialDomain: string | null | undefined,
  evidence: string[],
): { emailIconUrls?: string[] } {
  const extracted = extractEmailIconUrls(message, officialDomain);
  if (extracted.urls.length > 0) {
    evidence.push(`icon:email:${extracted.urls.length} url(s)`);
  }
  if (extracted.cidSkipped.length > 0) {
    // Honest record: inline images were seen but are not fetchable yet.
    evidence.push(
      `icon:cid-skip:${extracted.cidSkipped.slice(0, 3).join(",")}` +
        (extracted.cidSkipped.length > 3
          ? ` +${extracted.cidSkipped.length - 3}`
          : ""),
    );
  }
  return extracted.urls.length > 0 ? { emailIconUrls: extracted.urls } : {};
}
