export {
    DEFAULT_DISPLAY_FILTERS,
    INITIAL_SCAN_LIMIT,
    PARSER_VERSION
} from "./types";
export type {
    Cadence,
    CandidateKind,
    ClassifiedMessage,
    DisplayFilters,
    IncrementalScanResult,
    MailAttachment,
    MailAuthKind,
    MailboxScanState,
    MailProvider,
    MailProviderCatalogEntry,
    MailProviderId,
    MessageFetcher,
    NormalizedMessage,
    ScanCacheStore,
    ScanCandidate,
    ScanCursor,
    SubjectClass
} from "./types";

export {
    classifyMessage,
    classifySubject,
    extractEmailAddress,
    hasInvoiceAttachment,
    merchantFromAddress,
    moneyBodyText
} from "./classifier";

export {
    buildCandidateMap,
    collapseFreeIntoMoney,
    filterCandidates,
    rollupCandidates
} from "./rollup";

export {
    ALL_FIXTURES,
    FIXTURE_NEWSLETTER,
    FIXTURE_ORDER,
    FIXTURE_OTP_DROP,
    FIXTURE_PDF_AMOUNT_UNKNOWN,
    FIXTURE_RENEWAL,
    FIXTURE_RESET,
    FIXTURE_USAGE_INVOICE,
    FIXTURE_WELCOME
} from "./fixtures";

export {
    brandedConnectRows,
    imapConnectRow,
    MAIL_PROVIDER_CATALOG
} from "./catalog";

export {
    cachedCandidates,
    createMemoryScanStore,
    runIncrementalScan
} from "./scan";

export { candidateToSubscription } from "./importCandidate";

export { importFromConnectedMailboxes } from "./scanConnected";
