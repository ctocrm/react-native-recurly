/**
 * Phase K (deep re-list): deep mode must ignore the scan cursor and replace
 * the recency cap, so mail beyond the newest INITIAL_SCAN_LIMIT window is
 * re-listed after a cache clear (the J5 gap: a deleted brand whose mail aged
 * past the newest 500 ids could never re-import by scan alone). Non-deep
 * scans keep the cursor + cap untouched (regression guard), and cached
 * messages at the current parser version are never re-staged.
 */

import { createMemoryScanStore, runIncrementalScan } from "../scan";
import { DEEP_SCAN_LIMIT, INITIAL_SCAN_LIMIT, PARSER_VERSION } from "../types";
import type {
  MessageFetcher,
  NormalizedMessage,
  ScanCacheStore,
} from "../types";

function msg(id: string, date: string): NormalizedMessage {
  return {
    mailboxId: "box",
    messageId: id,
    from: "Brand <billing@brand.example>",
    subject: "Your monthly receipt",
    date,
    text: "receipt body",
  };
}

function seededStore(): ScanCacheStore {
  const store = createMemoryScanStore();
  store.saveMailbox({
    mailboxId: "box",
    providerId: "gmail",
    cursor: {
      mailboxId: "box",
      lastMessageDate: "2026-09-01T00:00:00.000Z",
      lastMessageId: "seed",
      parserVersion: PARSER_VERSION,
    },
    messages: {},
  });
  return store;
}

describe("runIncrementalScan deep mode (Phase K)", () => {
  test("deep: ignores the cursor and swaps the recency cap for DEEP_SCAN_LIMIT", async () => {
    const store = seededStore();
    const seenOpts: { since: unknown; limit: unknown }[] = [];
    const fetcher: MessageFetcher = {
      async fetchMessages(opts, onChunk) {
        seenOpts.push({ since: opts.since, limit: opts.limit });
        // An OLD message (beyond the cursor) that is NOT cached: deep mode
        // must stage it — this is the aged-out brand coming back.
        await onChunk([msg("old-1", "2020-01-01T00:00:00.000Z")], {
          listed: 1,
          total: 7,
        });
      },
    };
    const onList: { listed: number; total: number | null }[] = [];

    const result = await runIncrementalScan({
      mailboxId: "box",
      providerId: "gmail",
      fetcher,
      store,
      deep: true,
      onListProgress: (listed, total) => onList.push({ listed, total }),
    });

    expect(seenOpts).toHaveLength(1);
    expect(seenOpts[0].since).toBeNull();
    expect(seenOpts[0].limit).toBe(DEEP_SCAN_LIMIT);
    expect(result.fetched).toBe(1);
    expect(onList).toEqual([{ listed: 1, total: 7 }]);
  });

  test("non-deep: cursor + INITIAL_SCAN_LIMIT unchanged (regression guard)", async () => {
    const store = seededStore();
    const seenOpts: { since: unknown; limit: unknown }[] = [];
    const fetcher: MessageFetcher = {
      async fetchMessages(opts, onChunk) {
        seenOpts.push({ since: opts.since, limit: opts.limit });
        await onChunk([], { listed: 0, total: null });
      },
    };

    await runIncrementalScan({
      mailboxId: "box",
      providerId: "gmail",
      fetcher,
      store,
    });

    expect(seenOpts).toHaveLength(1);
    expect(seenOpts[0].since).toEqual({
      date: "2026-09-01T00:00:00.000Z",
      messageId: "seed",
    });
    expect(seenOpts[0].limit).toBe(INITIAL_SCAN_LIMIT);
  });

  test("deep: cached messages at the current parser version are not re-staged", async () => {
    const store = seededStore();
    // Warm cache: one message already classified at the current version.
    const cached = msg("cached-1", "2026-08-01T00:00:00.000Z");
    store.saveMailbox({
      ...store.getMailbox("box")!,
      messages: {
        "cached-1": {
          message: cached,
          classified: {
            message: cached,
            subjectClass: "recurring",
            merchantKey: "brand",
            merchantName: "Brand",
            kind: "recurring",
            amountUnknown: false,
            needsBody: false,
            evidence: [],
            confidence: "high",
          },
          parserVersion: PARSER_VERSION,
        },
      },
    });
    const fetcher: MessageFetcher = {
      async fetchMessages(_opts, onChunk) {
        // The deep walk re-lists EVERYTHING, cached message included.
        await onChunk([cached, msg("old-2", "2019-06-01T00:00:00.000Z")]);
      },
    };

    const result = await runIncrementalScan({
      mailboxId: "box",
      providerId: "gmail",
      fetcher,
      store,
      deep: true,
    });

    // Only the uncached old message is staged; the cached one skips.
    expect(result.fetched).toBe(1);
  });
});
