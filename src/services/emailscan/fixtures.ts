/**
 * Classifier fixtures. Covers the shared scan brain once.
 * Do not invent live mailbox rows from these.
 */
import type { NormalizedMessage } from "./types";

const BOX = "fixture-mailbox";

function msg(
  id: string,
  from: string,
  subject: string,
  extra: Partial<NormalizedMessage> = {},
): NormalizedMessage {
  return {
    mailboxId: BOX,
    messageId: id,
    from,
    subject,
    date: extra.date ?? "2026-08-01T12:00:00.000Z",
    ...extra,
  };
}

export const FIXTURE_WELCOME: NormalizedMessage = msg(
  "welcome-github",
  "GitHub <noreply@github.com>",
  "Welcome to GitHub",
);

export const FIXTURE_RESET: NormalizedMessage = msg(
  "reset-github",
  "GitHub <noreply@github.com>",
  "Reset your password",
);

export const FIXTURE_RENEWAL: NormalizedMessage = msg(
  "renewal-prime",
  "Amazon Prime <noreply@amazon.com>",
  "Your Prime membership renewal",
  {
    text: "Your Prime membership renews for $14.99 /mo. Thank you.",
  },
);

export const FIXTURE_USAGE_INVOICE: NormalizedMessage = msg(
  "usage-linode",
  "Linode Billing <billing@linode.com>",
  "Your Linode usage invoice",
  {
    text: "Usage for this period: $8.40 overage.",
  },
);

export const FIXTURE_ORDER: NormalizedMessage = msg(
  "order-amazon",
  "Amazon.com <auto-confirm@amazon.com>",
  "Your Amazon.com order of USB-C cable",
  {
    text: "Order total $12.49. This is not a membership.",
  },
);

export const FIXTURE_PDF_AMOUNT_UNKNOWN: NormalizedMessage = msg(
  "pdf-openai",
  "OpenAI <noreply@openai.com>",
  "Your OpenAI subscription receipt",
  {
    attachments: [{ filename: "receipt.pdf", mimeType: "application/pdf" }],
  },
);

export const FIXTURE_NEWSLETTER: NormalizedMessage = msg(
  "newsletter-drop",
  "The Verge <news@theverge.com>",
  "This week in newsletter: gadgets",
);

export const FIXTURE_OTP_DROP: NormalizedMessage = msg(
  "otp-drop",
  "Security <noreply@example.com>",
  "Your code is 482193",
);

export const ALL_FIXTURES: NormalizedMessage[] = [
  FIXTURE_WELCOME,
  FIXTURE_RESET,
  FIXTURE_RENEWAL,
  FIXTURE_USAGE_INVOICE,
  FIXTURE_ORDER,
  FIXTURE_PDF_AMOUNT_UNKNOWN,
  FIXTURE_NEWSLETTER,
  FIXTURE_OTP_DROP,
];
