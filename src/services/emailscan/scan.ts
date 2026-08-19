/**
 * Incremental scan. First connect fetches a recency-capped union.
 * Later scans fetch only newer than lastCursor. Re-parse old mail
 * only on a parser-version bump. Toggle does not call this.
 */
import { classifyMessage } from "./classifier";
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

export async function runIncrementalScan(opts: {
  mailboxId: string;
  providerId: MailProviderId;
  fetcher: MessageFetcher;
  store: ScanCacheStore;
  limit?: number;
}): Promise<IncrementalScanResult> {
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

  const fetched = await opts.fetcher.fetchMessages({
    mailboxId: opts.mailboxId,
    since,
    limit,
  });

  const next: MailboxScanState = {
    ...primed,
    providerId: opts.providerId,
    messages: { ...primed.messages },
  };

  let accepted = 0;
  for (const message of fetched) {
    if (
      !isNewerThanCursor(message, primed.cursor) &&
      next.messages[message.messageId]
    ) {
      continue;
    }
    if (next.messages[message.messageId]?.parserVersion === PARSER_VERSION) {
      continue;
    }
    next.messages[message.messageId] = {
      message,
      classified: classifyMessage(message),
      parserVersion: PARSER_VERSION,
    };
    accepted += 1;
  }

  next.cursor = advanceCursor(primed.cursor, fetched);
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
