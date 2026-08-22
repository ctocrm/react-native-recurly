/**
 * Subject-first classifier. Body and invoice-like attachments run only
 * for money classes (recurring / sparse). No LLM.
 */
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
  /\b(welcome|registered|verify(?:\s+your)?\s+email|account\s+created|confirm\s+your\s+(?:email|account)|thanks\s+for\s+(?:signing|joining)|you(?:'re| are) in)\b/i;

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

export function merchantFromAddress(from: string): {
  merchantKey: string;
  merchantName: string;
} {
  const email = extractEmailAddress(from);
  const at = email.lastIndexOf("@");
  const domain = at >= 0 ? email.slice(at + 1) : email;
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
  const merchantName = label
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return { merchantKey: label.toLowerCase(), merchantName };
}

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

/** Connecting Proton is not a Proton subscription. Same for Tuta/Gmail. */
const MAILBOX_VENDOR_KEYS: Record<string, Set<string>> = {
  proton: new Set(["proton"]),
  tuta: new Set(["tuta", "tutanota", "tutamail"]),
  gmail: new Set(["gmail", "google"]),
  workspace: new Set(["gmail", "google"]),
  outlook: new Set(["outlook", "hotmail", "live", "microsoft"]),
  office365: new Set(["outlook", "microsoft"]),
  imap: new Set(),
};

export function isMailboxVendor(
  mailboxId: string,
  merchantKey: string,
): boolean {
  const colon = mailboxId.indexOf(":");
  const provider = (colon >= 0 ? mailboxId.slice(0, colon) : mailboxId)
    .trim()
    .toLowerCase();
  const keys = MAILBOX_VENDOR_KEYS[provider];
  if (!keys || keys.size === 0) return false;
  return keys.has(merchantKey.toLowerCase());
}

export function isSelfMail(message: NormalizedMessage): boolean {
  const fromEmail = extractEmailAddress(message.from);
  const owner = ownerAddressFromMailbox(message.mailboxId);
  if (owner && fromEmail === owner) return true;
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

export function resolveMerchant(message: NormalizedMessage): {
  merchantKey: string;
  merchantName: string;
  evidence: string[];
  drop: boolean;
} {
  if (isSelfMail(message)) {
    return {
      merchantKey: "self",
      merchantName: "Self",
      evidence: ["drop:self-mail"],
      drop: true,
    };
  }
  const fromMerchant = merchantFromAddress(message.from);
  if (isMailboxVendor(message.mailboxId, fromMerchant.merchantKey)) {
    return {
      merchantKey: fromMerchant.merchantKey,
      merchantName: fromMerchant.merchantName,
      evidence: [`drop:mailbox-vendor:${fromMerchant.merchantKey}`],
      drop: true,
    };
  }
  if (!isPaymentProcessor(fromMerchant.merchantKey)) {
    return { ...fromMerchant, evidence: [], drop: false };
  }
  const named =
    merchantFromProcessorText(message.subject) ||
    (message.text ? merchantFromProcessorText(message.text) : null);
  if (!named) {
    return {
      merchantKey: fromMerchant.merchantKey,
      merchantName: fromMerchant.merchantName,
      evidence: [`drop:processor:${fromMerchant.merchantKey}`],
      drop: true,
    };
  }
  return {
    ...named,
    evidence: [`processor:${fromMerchant.merchantKey}`],
    drop: false,
  };
}

export function classifySubject(subject: string): SubjectClass {
  const s = subject.trim();
  if (!s) return "drop";

  if (DROP_RE.test(s) && !RECURRING_RE.test(s)) return "drop";
  if (OTP_ONLY_RE.test(s) && !ACCOUNT_RE.test(s) && !SECURITY_RE.test(s)) {
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
    .replace(/&nbsp;/g, " ")
    .replace(/&/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function parseAmount(
  text: string,
): { amount: number; currency: string } | null {
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
  if (/(\/yr\b|per\s+year|annual(?:ly)?)/i.test(text)) return "yearly";
  if (/(\/mo\b|per\s+month|monthly)/i.test(text)) return "monthly";
  if (/\brenews\b/i.test(text)) return "unknown";
  return undefined;
}

function isInvoiceAttachment(att: MailAttachment): boolean {
  const name = att.filename || "";
  if (IMAGE_NAME_RE.test(name)) return false;
  return INVOICE_NAME_RE.test(name) || /pdf$/i.test(att.mimeType || "");
}

export function moneyBodyText(message: NormalizedMessage): string {
  const parts: string[] = [];
  if (message.text && message.text.trim()) {
    parts.push(message.text);
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
  const { merchantKey, merchantName } = resolved;
  const evidence = [`subject:${subjectClass}`, ...resolved.evidence];

  if (resolved.drop || subjectClass === "drop") {
    return {
      message,
      subjectClass: resolved.drop ? "drop" : subjectClass,
      merchantKey,
      merchantName,
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

  const kind = subjectClass === "recurring" ? "recurring" : "sparse";

  return {
    message,
    subjectClass,
    merchantKey,
    merchantName,
    kind,
    amount: parsed?.amount,
    currency: parsed?.currency,
    cadence: cadence ?? (kind === "recurring" ? "unknown" : undefined),
    amountUnknown,
    needsBody: true,
    evidence,
    confidence: parsed ? "high" : amountUnknown ? "medium" : "medium",
  };
}
