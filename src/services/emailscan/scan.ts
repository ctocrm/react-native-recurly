/**
 * Incremental scan. First connect fetches a recency-capped union.
 * Later scans fetch only newer than lastCursor. Re-parse old mail
 * only on a parser-version bump. Toggle does not call this.
 */
import { classifyMessage } from "./classifier";
import {
    feedScanWatchdog,
    waitForScanStall,
    type ScanStallHandle,
} from "./scanWatchdog";
import { buildCandidateMap } from "./rollup";
import {
    INITIAL_SCAN_LIMIT,
    PARSER_VERSION,
    type IncrementalScanResult,
    type MailProviderId,
    type MailboxScanState,
    type MessageFetcher,
    type NormalizedMessage,
    type ScanCacheStore,
    type ScanCursor,
} from "./types";

export function createMemoryScanStore(): ScanCacheStore {
  const boxes = new Map<string, MailboxScanState>();
  return {
    getMailbox(mailboxId) {
      return boxes.get(mailboxId);
    },
    saveMailbox(state) {
      boxes.set(state.mailboxId, state);
    },
    clearMailbox(mailboxId) {
      boxes.delete(mailboxId);
    },
  };
}

function emptyState(
  mailboxId: string,
  providerId: MailProviderId,
): MailboxScanState {
  return {
    mailboxId,
    providerId,
    cursor: {
      mailboxId,
      lastMessageDate: null,
      lastMessageId: null,
      parserVersion: PARSER_VERSION,
    },
    messages: {},
  };
}

function isNewerThanCursor(
  message: NormalizedMessage,
  cursor: ScanCursor,
): boolean {
  if (!cursor.lastMessageDate) return true;
  if (message.date > cursor.lastMessageDate) return true;
  if (message.date < cursor.lastMessageDate) return false;
  if (!cursor.lastMessageId) return true;
  return message.messageId > cursor.lastMessageId;
}

function advanceCursor(
  cursor: ScanCursor,
  incoming: NormalizedMessage[],
): ScanCursor {
  let lastDate = cursor.lastMessageDate;
  let lastId = cursor.lastMessageId;
  for (const msg of incoming) {
    if (!lastDate || msg.date > lastDate) {
      lastDate = msg.date;
      lastId = msg.messageId;
      continue;
    }
    if (msg.date === lastDate && (!lastId || msg.messageId > lastId)) {
      lastId = msg.messageId;
    }
  }
  return {
    mailboxId: cursor.mailboxId,
    lastMessageDate: lastDate,
    lastMessageId: lastId,
    parserVersion: PARSER_VERSION,
  };
}

function reparseStale(state: MailboxScanState): {
  state: MailboxScanState;
  reparsed: number;
} {
  // R19-OOM note: stored messages are body-stripped (stripBodyForStore), so a
  // parser-version bump reclassifies the subject/header-derived fields only.
  // Body-derived fields (billNumber, body amounts) refresh when the message
  // is re-fetched live, exactly like any newer mail.
  if (state.cursor.parserVersion === PARSER_VERSION) {
    return { state, reparsed: 0 };
  }
  const next: MailboxScanState = {
    ...state,
    cursor: { ...state.cursor, parserVersion: PARSER_VERSION },
    messages: { ...state.messages },
  };
  let reparsed = 0;
  for (const [id, cached] of Object.entries(state.messages)) {
    if (cached.parserVersion === PARSER_VERSION) continue;
    next.messages[id] = {
      message: cached.message,
      classified: classifyMessage(cached.message),
      parserVersion: PARSER_VERSION,
    };
    reparsed += 1;
  }
  return { state: next, reparsed };
}

/**
 * R19-OOM: bodies are extraction inputs, not storage. Stored state keeps a
 * short text snippet for debugging and drops html entirely — retaining full
 * bodies inside state.messages (embedded AGAIN inside each ClassifiedMessage)
 * blew the heap mid-leg and bloated every persist row and candidate map built
 * afterwards.
 */
const SNIPPET_CHARS = 500;
function stripBodyForStore(message: NormalizedMessage): NormalizedMessage {
  return {
    ...message,
    text: message.text?.slice(0, SNIPPET_CHARS),
    html: undefined,
    attachments: message.attachments?.map((att) => ({
      ...att,
      text: att.text?.slice(0, SNIPPET_CHARS),
    })),
  };
}

/**
 * R14 no-progress watchdog. Injectable so tests can drive the stall path;
 * defaults to the native-backed module (no-op off Android). feed() is called
 * by the fetchers themselves (providers fetchWithTimeout, imapNative chunks)
 * — every completed HTTP call or native chunk restarts the countdown.
 */
export type ScanWatchdogControl = {
  stall(budgetMs?: number): ScanStallHandle;
  feed(): void;
  cancel(handle: ScanStallHandle): void;
};

const defaultWatchdog: ScanWatchdogControl = {
  stall: waitForScanStall,
  feed: feedScanWatchdog,
  cancel: (handle) => handle.cancel(),
};

export async function runIncrementalScan(opts: {
  mailboxId: string;
  providerId: MailProviderId;
  fetcher: MessageFetcher;
  store: ScanCacheStore;
  limit?: number;
  watchdog?: ScanWatchdogControl;
}): Promise<IncrementalScanResult> {
  const watchdog = opts.watchdog ?? defaultWatchdog;
  const limit = opts.limit ?? INITIAL_SCAN_LIMIT;
  const existing =
    opts.store.getMailbox(opts.mailboxId) ??
    emptyState(opts.mailboxId, opts.providerId);

  const { state: primed, reparsed } = reparseStale(existing);

  const since =
    primed.cursor.lastMessageDate && primed.cursor.lastMessageId
      ? {
          date: primed.cursor.lastMessageDate,
          messageId: primed.cursor.lastMessageId,
        }
      : null;

  // R14: race the whole leg against the native no-progress watchdog so a
  // mid-leg wedge (dead JS timers with no in-flight socket to time out —
  // the 2026-09-05 run-2 class) surfaces as a per-mailbox error instead of
  // parking the scan forever.
  const stall = watchdog.stall();
  // R19-OOM: the merge state exists BEFORE the leg starts so streamed chunks
  // are classified and folded in as they arrive — a body is alive only for
  // the duration of one chunk, never for the whole leg.
  const next: MailboxScanState = {
    ...primed,
    providerId: opts.providerId,
    messages: { ...primed.messages },
  };

  let accepted = 0;
  try {
    await Promise.race([
      opts.fetcher.fetchMessages(
        { mailboxId: opts.mailboxId, since, limit },
        (chunk) => {
          for (const raw of chunk) {
            if (
              !isNewerThanCursor(raw, primed.cursor) &&
              next.messages[raw.messageId]
            ) {
              continue;
            }
            if (
              next.messages[raw.messageId]?.parserVersion === PARSER_VERSION
            ) {
              continue;
            }
            next.messages[raw.messageId] = {
              // classifyMessage consumes the FULL body (billNumber, amount,
              // processor merchant extraction); the stored copy is stripped.
              message: stripBodyForStore(raw),
              classified: classifyMessage(raw),
              parserVersion: PARSER_VERSION,
            };
            accepted += 1;
          }
          next.cursor = advanceCursor(next.cursor, chunk);
        },
      ),
      stall.promise,
    ]);
  } finally {
    watchdog.cancel(stall);
  }

  opts.store.saveMailbox(next);

  return {
    mailboxId: opts.mailboxId,
    candidates: buildCandidateMap(
      Object.values(next.messages).map((m) => m.classified),
    ),
    fetched: accepted,
    reparsed,
    cursor: next.cursor,
  };
}

export function cachedCandidates(store: ScanCacheStore, mailboxId: string) {
  const state = store.getMailbox(mailboxId);
  if (!state) return [];
  return buildCandidateMap(
    Object.values(state.messages).map((m) => m.classified),
  );
}
