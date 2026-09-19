/**
 * Official-domain seed for icon crawl (Hop 1).
 *
 * Scan-found subscriptions already have a From-host. That host is crawl
 * evidence after sanitizing mailer / ESP / processor labels. It is not a
 * merchant display name.
 *
 * Pure: no crawler / search / DB imports.
 */

const MAILER_LABELS = new Set([
  "www",
  "mail",
  "email",
  "smtp",
  "mx",
  "noreply",
  "no-reply",
  "donotreply",
  "do-not-reply",
  "billing",
  "invoice",
  "invoices",
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

const ESP_OR_PROCESSOR_HOSTS = [
  "sendgrid.net",
  "amazonses.com",
  "amazonaws.com",
  "mailchimp.com",
  "mailchimpapp.com",
  "intercom-mail.com",
  "intercom.io",
  "mailgun.org",
  "mailgun.com",
  "sparkpostmail.com",
  "postmarkapp.com",
  "mandrillapp.com",
  "sendinblue.com",
  "brevo.com",
  "constantcontact.com",
  "hubspot.com",
  "createsend.com",
  "stripe.com",
  "paypal.com",
  "squareup.com",
  "square.com",
  "braintreegateway.com",
  "braintree.com",
  "paddle.com",
  "lemonsqueezy.com",
  "fastspring.com",
  "chargebee.com",
  "recurly.com",
  "adyen.com",
  "klarna.com",
  "afterpay.com",
  "affirm.com",
];

function hostMatchesSuffix(host: string, suffix: string): boolean {
  return host === suffix || host.endsWith(`.${suffix}`);
}

function isEspOrProcessorHost(host: string): boolean {
  return ESP_OR_PROCESSOR_HOSTS.some((s) => hostMatchesSuffix(host, s));
}

/** Peel mailer labels and drop ESP / processor hosts. */
export function sanitizeOfficialHost(rawHost: string): string | null {
  const trimmed = rawHost.trim().toLowerCase();
  if (!trimmed) return null;
  let host = trimmed.replace(/^www\./, "");
  if (!host.includes(".")) return null;

  const labels = host.split(".").filter(Boolean);
  while (labels.length >= 3 && MAILER_LABELS.has(labels[0])) {
    labels.shift();
  }
  host = labels.join(".");
  if (!host.includes(".")) return null;
  if (isEspOrProcessorHost(host)) return null;
  return host;
}

/**
 * Inverse of emailscan shortTwoLetterTldMerchant (`x.ai` → `xai`).
 * Only `ai` so ordinary slugs (`home`, `figma`) are not turned into hosts.
 */
const COMPOUND_SLUG_TLDS = new Set(["ai"]);

export function officialHostFromCompoundSlug(slug: string): string | null {
  const s = slug.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  if (s.length < 3 || s.length > 5) return null;
  const tld = s.slice(-2);
  const left = s.slice(0, -2);
  if (!left || !COMPOUND_SLUG_TLDS.has(tld)) return null;
  const host = `${left}.${tld}`;
  if (host.length > 5) return null;
  return host;
}

/**
 * Curated canonical brand identities for slugs that are NOT the brand itself —
 * product/infra host labels a scan can mint as a merchant ("zohoaccounts" is
 * Zoho's accounts host, not a company called "Zohoaccounts").
 *
 * Every entry MUST be verified live and brand-owned before adding:
 *  - zoho / zohoaccounts → zoho.com: zoho.com A 136.143.190.155, MX smtpin.zoho.com;
 *    zohoaccounts.com MX zc-mx.zohocorp.com (DNS checked 2026-09-14); device RDAP
 *    2026-09-12 read org "Zoho Canada Corporation" for zohoaccounts.ca. The user
 *    locked the identity: "it's just zoho".
 *  - wert.io: Wert's official NFT checkout / fiat onramp site, operated by SHA2
 *    Solutions Inc. — confirmed live 2026-09-12.
 *  - cline.bot: RDAP-backed oddball TLD (2026-09-12).
 * Pure lookup; the crawler persists the host as the TIER 0 seed and uses the
 * display name for search queries and library-slug candidates.
 */
const CANONICAL_BRANDS: Record<
  string,
  { key: string; host: string; display: string }
> = {
  wert: { key: "wert", host: "wert.io", display: "Wert" },
  cline: { key: "cline", host: "cline.bot", display: "Cline" },
  clinebotinc: { key: "cline", host: "cline.bot", display: "Cline" },
  zoho: { key: "zoho", host: "zoho.com", display: "Zoho" },
  zohoaccounts: { key: "zoho", host: "zoho.com", display: "Zoho" },
};

export interface CanonicalBrand {
  /** Canonical brand slug — the merchant key scans should mint. */
  key: string;
  host: string;
  display: string;
}

/** Canonical brand identity for a scan-minted slug, or null when uncurated. */
export function canonicalBrandFor(brand: string): CanonicalBrand | null {
  const key = brand.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
  const entry = CANONICAL_BRANDS[key];
  if (!entry) return null;
  const host = sanitizeOfficialHost(entry.host);
  if (!host) return null;
  return { key: entry.key, host, display: entry.display };
}

export function knownOfficialDomainForBrand(brand: string): string | null {
  return canonicalBrandFor(brand)?.host ?? null;
}

export function officialDomainFromAddress(from: string): string | null {
  const angled = from.match(/<([^>]+)>/);
  const raw = (angled ? angled[1] : from).trim().toLowerCase();
  const at = raw.lastIndexOf("@");
  if (at < 0) return null;
  return sanitizeOfficialHost(raw.slice(at + 1));
}

export function officialSiteUrlForHost(host: string): string {
  const clean = host.replace(/^www\./, "").toLowerCase();
  return `https://${clean}`;
}
