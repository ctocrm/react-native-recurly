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
