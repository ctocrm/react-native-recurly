/**
 * Phase 4 email-scan types. Shared parser does not know Gmail vs IMAP.
 * A subscription is an account; a bill is optional evidence.
 */

// 13: F-2 canonical brands — zohoaccounts mints as Zoho (reclassifies cached
//      From-hosts so mail history re-keys onto the canonical brand).
export const PARSER_VERSION = 13;


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

export type Cadence = "weekly" | "monthly" | "yearly" | "unknown";

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
  /** Sanitized From-host for icon crawl. Null for processor/ESP mail. */
  officialDomain?: string | null;
  /**
   * Phase C: brand-sent icon URLs extracted from the email HTML at classify
   * time (body is stripped right after, so this is the only chance). Ordered
   * best-first (logo-ish first-party, logo-ish, signature). cid refs are only
   * ever evidence — no provider supplies a fetchable ref yet.
   */
  emailIconUrls?: string[];
  /** Null when subjectClass is drop. */
  kind: CandidateKind | null;
  amount?: number;
  currency?: string;
  cadence?: Cadence;
  /** R18: best-effort invoice/order/receipt number from the body. */
  billNumber?: string | null;
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
  /** Sanitized From-host for icon crawl. Absent when unknown. */
  officialDomain?: string | null;
  kind: CandidateKind;
  amount?: number;
  currency?: string;
  cadence?: Cadence;
  nextDate?: string;
  /** R18: best-effort bill number carried to import. */
  billNumber?: string | null;
  /** Phase C: brand-sent icon seeds for the scan-fired crawl (best-first). */
  emailIconUrls?: string[];
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

/**
 * Phase K deep re-list: the user explicitly opted into listing the ENTIRE
 * mailbox history, so the recency cap is replaced by a large safety ceiling
 * (it guards against a runaway provider loop, not against legitimate work).
 */
export const DEEP_SCAN_LIMIT = 50_000;

/**
 * Phase K: progress metadata a fetcher MAY attach to each streamed chunk.
 * `listed` counts every id seen (screened or staged) in the leg so far;
 * `total` is the provider-reported size of the listing when the API exposes
 * one (Gmail resultSizeEstimate, Graph @odata.count) and null when it does
 * not — the UI must render unknown totals honestly ("scanned N").
 */
export interface ChunkMeta {
  listed: number;
  total: number | null;
}

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
  /**
   * R19-OOM streaming contract: fetchers MUST deliver messages per page or
   * native batch via `onChunk` and MUST NOT retain the whole leg's messages
   * in memory until the leg ends. Body-bearing messages are the peak-memory
   * hazard: a Workspace leg listing 500 messages while pulling full HTML
   * bodies exhausted the 192MB Java heap MID-LEG (2026-09-07 fresh
   * reproduction: 17MB -> 213MB Java in ~35s, FATAL OutOfMemoryError). The
   * scan classifies each chunk as it arrives and stores body-stripped
   * copies, so a body only lives for the duration of one chunk.
   */
  fetchMessages(
    opts: {
      mailboxId: string;
      since: FetchSince | null;
      limit: number;
    },
    onChunk: (
      chunk: NormalizedMessage[],
      meta?: ChunkMeta,
    ) => void | Promise<void>,
  ): Promise<void>;
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
  scan(opts?: {
    mailboxId?: string;
    onLegProgress?: (staged: number) => void;
    /**
     * Phase K deep re-list: ignore the scan cursor and the recency cap so
     * the entire mailbox history is listed (user opted in via the warn
     * modal). Cached messages at the current parser version still skip.
     */
    deep?: boolean;
    /** Phase K: per-chunk listing progress for the in-app gauge. */
    onListProgress?: (listed: number, total: number | null) => void;
  }): Promise<IncrementalScanResult>;
}
