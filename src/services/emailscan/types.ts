/**
 * Phase 4 email-scan types. Shared parser does not know Gmail vs IMAP.
 * A subscription is an account; a bill is optional evidence.
 */

export const PARSER_VERSION = 1;

export type MailProviderId =
  | "gmail"
  | "workspace"
  | "outlook"
  | "office365"
  | "yahoo"
  | "aol"
  | "zoho"
  | "fastmail"
  | "imap";

export type SubjectClass =
  "account" | "security" | "recurring" | "sparse" | "drop";

export type CandidateKind = "recurring" | "sparse" | "free";

export type Cadence = "monthly" | "yearly" | "unknown";

export interface MailAttachment {
  filename: string;
  mimeType?: string;
  /** Extracted text if already available. Phase 4 may omit PDF bytes. */
  text?: string;
}

export interface NormalizedMessage {
  mailboxId: string;
  messageId: string;
  from: string;
  subject: string;
  /** ISO-8601 */
  date: string;
  text?: string;
  html?: string;
  attachments?: MailAttachment[];
}

export interface ClassifiedMessage {
  message: NormalizedMessage;
  subjectClass: SubjectClass;
  merchantKey: string;
  merchantName: string;
  /** Null when subjectClass is drop. */
  kind: CandidateKind | null;
  amount?: number;
  currency?: string;
  cadence?: Cadence;
  /** Invoice-like PDF present but no parseable total. */
  amountUnknown: boolean;
  needsBody: boolean;
  evidence: string[];
  confidence: "low" | "medium" | "high";
}

export interface ScanCandidate {
  mailboxId: string;
  merchantKey: string;
  merchant: string;
  kind: CandidateKind;
  amount?: number;
  currency?: string;
  cadence?: Cadence;
  nextDate?: string;
  amountUnknown: boolean;
  evidence: string[];
  messageIds: string[];
  confidence: "low" | "medium" | "high";
}

export interface DisplayFilters {
  recurring: boolean;
  sparse: boolean;
  free: boolean;
}

export const DEFAULT_DISPLAY_FILTERS: DisplayFilters = {
  recurring: true,
  sparse: false,
  free: false,
};
