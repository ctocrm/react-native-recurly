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
]);

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
  const { merchantKey, merchantName } = merchantFromAddress(message.from);
  const evidence = [`subject:${subjectClass}`];

  if (subjectClass === "drop") {
    return {
      message,
      subjectClass,
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
  const parsed = body ? parseAmount(body) : null;
  const cadence = body
    ? inferCadence(body) || inferCadence(message.subject)
    : inferCadence(message.subject);
  const invoiceAttached = hasInvoiceAttachment(message);
  const amountUnknown = !parsed && invoiceAttached;

  if (parsed) evidence.push(`amount:${parsed.currency} ${parsed.amount}`);
  if (amountUnknown) evidence.push("invoice-attached-amount-unknown");
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
