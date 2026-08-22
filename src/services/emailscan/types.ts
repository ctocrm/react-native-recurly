/**
 * Phase 4 email-scan types. Shared parser does not know Gmail vs IMAP.
 * A subscription is an account; a bill is optional evidence.
 */

export const PARSER_VERSION = 3;

export type MailProviderId =
  | "gmail"
  | "workspace"
  | "outlook"
  | "office365"
  | "zoho"
  | "fastmail"
  | "proton"
  | "tuta"
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

/** First-connect recency cap. Later scans use the cursor, not this. */
export const INITIAL_SCAN_LIMIT = 500;

export type MailAuthKind = "oauth" | "imap" | "password";

export interface MailProviderCatalogEntry {
  id: MailProviderId;
  label: string;
  branded: boolean;
  auth: MailAuthKind;
  /**
   * Live connect+scan in the cheap Phase 4 matrix.
   * False means implement fully, mark unverified — not a stub.
   */
  liveScanInPhase4: boolean;
  note?: string;
}

export interface ScanCursor {
  mailboxId: string;
  lastMessageDate: string | null;
  lastMessageId: string | null;
  parserVersion: number;
}

export interface CachedMessage {
  message: NormalizedMessage;
  classified: ClassifiedMessage;
  parserVersion: number;
}

export interface MailboxScanState {
  mailboxId: string;
  providerId: MailProviderId;
  cursor: ScanCursor;
  messages: Record<string, CachedMessage>;
}

export interface FetchSince {
  date: string;
  messageId: string;
}

export interface MessageFetcher {
  fetchMessages(opts: {
    mailboxId: string;
    since: FetchSince | null;
    limit: number;
  }): Promise<NormalizedMessage[]>;
}

export interface ScanCacheStore {
  getMailbox(mailboxId: string): MailboxScanState | undefined;
  saveMailbox(state: MailboxScanState): void;
  clearMailbox(mailboxId: string): void;
}

export interface IncrementalScanResult {
  mailboxId: string;
  candidates: ScanCandidate[];
  fetched: number;
  reparsed: number;
  cursor: ScanCursor;
}

/**
 * Mail provider contract. Shared classifier does not know Gmail vs IMAP.
 * connect() persists tokens in secure store; scan() is incremental.
 */
export interface MailProvider {
  id: MailProviderId;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): Promise<boolean>;
  scan(opts?: { mailboxId?: string }): Promise<IncrementalScanResult>;
}
