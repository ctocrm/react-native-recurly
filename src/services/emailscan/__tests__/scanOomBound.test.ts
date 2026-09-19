/**
 * R19-OOM regression gates (2026-09-07 fresh on-device reproduction: a
 * Workspace leg that held every fetched message's full HTML body pushed the
 * Java heap 17MB -> 213MB in ~35s and died FATAL mid-leg).
 *
 * 1. Fetchers stream chunks; the scan merges per chunk, so peak memory is
 *    one chunk, never one mailbox.
 * 2. Stored state is body-stripped (html dropped, text truncated to a
 *    snippet) while classification still saw the FULL body — billNumber
 *    extraction must survive the strip.
 * 3. Cross-chunk dedupe and cursor advance behave exactly as the old
 *    whole-leg merge did.
 */

import { createMemoryScanStore, runIncrementalScan } from "../scan";
import type { MessageFetcher, NormalizedMessage } from "../types";

const BIG_HTML = `<html><body>${"<p>x</p>".repeat(5000)}</body></html>`;
const LONG_TEXT = `${"filler ".repeat(200)}Invoice #INV-7788 total $19.00`;

function message(overrides: Partial<NormalizedMessage>): NormalizedMessage {
  return {
    mailboxId: "workspace:t",
    messageId: "m-1",
    from: "Billing <billing@example.com>",
    subject: "Your monthly membership renewal",
    date: "2026-09-01T00:00:00.000Z",
    html: BIG_HTML,
    text: LONG_TEXT,
    ...overrides,
  };
}

function streamingFetcher(
  chunks: NormalizedMessage[][],
): MessageFetcher & { flushes: number } {
  const state = { flushes: 0 };
  return {
    get flushes() {
      return state.flushes;
    },
    async fetchMessages(_opts, onChunk) {
      for (const chunk of chunks) {
        await onChunk(chunk);
        state.flushes += 1;
      }
    },
  };
}

describe("R19-OOM streaming scan bounds", () => {
  it("merges streamed chunks; duplicate ids across chunks stay single", async () => {
    const store = createMemoryScanStore();
    const api = streamingFetcher([
      [message({ messageId: "m-1", date: "2026-09-01T00:00:00.000Z" })],
      [
        message({ messageId: "m-2", date: "2026-09-02T00:00:00.000Z" }),
        // boundary re-delivery (Proton untilIso semantics): must dedupe
        message({ messageId: "m-1", date: "2026-09-01T00:00:00.000Z" }),
      ],
    ]);

    const result = await runIncrementalScan({
      mailboxId: "workspace:t",
      providerId: "workspace",
      fetcher: api,
      store,
    });

    expect(api.flushes).toBe(2);
    expect(result.fetched).toBe(2);
    expect(Object.keys(store.getMailbox("workspace:t")!.messages)).toEqual([
      "m-1",
      "m-2",
    ]);
    expect(result.cursor.lastMessageId).toBe("m-2");
    expect(result.cursor.lastMessageDate).toBe("2026-09-02T00:00:00.000Z");
  });

  it("classifies with the FULL body but stores body-stripped copies", async () => {
    const store = createMemoryScanStore();
    const api = streamingFetcher([
      [message({ messageId: "m-1" })],
      [message({ messageId: "m-2", date: "2026-09-02T00:00:00.000Z" })],
    ]);

    await runIncrementalScan({
      mailboxId: "workspace:t",
      providerId: "workspace",
      fetcher: api,
      store,
    });

    const cached = Object.values(store.getMailbox("workspace:t")!.messages);
    expect(cached).toHaveLength(2);
    for (const entry of cached) {
      // body-derived extraction saw the full body
      expect(entry.classified.billNumber).toBe("INV-7788");
      // storage is stripped: html gone, text capped at the snippet bound
      expect(entry.message.html).toBeUndefined();
      expect(entry.message.text!.length).toBeLessThanOrEqual(500);
      expect(entry.message.text!.length).toBeGreaterThan(0);
    }
  });
});
