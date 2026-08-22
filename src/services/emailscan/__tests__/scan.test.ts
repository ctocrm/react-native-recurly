import {
  brandedConnectRows,
  imapConnectRow,
  MAIL_PROVIDER_CATALOG,
} from "../catalog";
import {
  ALL_FIXTURES,
  FIXTURE_NEWSLETTER,
  FIXTURE_RENEWAL,
  FIXTURE_WELCOME,
} from "../fixtures";
import { filterCandidates } from "../rollup";
import {
  cachedCandidates,
  createMemoryScanStore,
  runIncrementalScan,
} from "../scan";
import type { MessageFetcher, NormalizedMessage } from "../types";
import { DEFAULT_DISPLAY_FILTERS, PARSER_VERSION } from "../types";

function fetcherOf(
  batches: NormalizedMessage[][],
): MessageFetcher & { calls: { since: unknown; limit: number }[] } {
  const calls: { since: unknown; limit: number }[] = [];
  let i = 0;
  return {
    calls,
    async fetchMessages({ since, limit }) {
      calls.push({ since, limit });
      const batch = batches[i] ?? [];
      i += 1;
      return batch;
    },
  };
}

describe("emailscan catalog", () => {
  it("lists branded OAuth rows then IMAP last", () => {
    const ids = MAIL_PROVIDER_CATALOG.map((r) => r.id);
    expect(ids[ids.length - 1]).toBe("imap");
    expect(imapConnectRow().branded).toBe(false);
    expect(imapConnectRow().auth).toBe("imap");
    expect(brandedConnectRows().every((r) => r.branded)).toBe(true);
    expect(brandedConnectRows().map((r) => r.id)).not.toContain("imap");
    const oauthIds = brandedConnectRows()
      .filter((r) => r.auth === "oauth")
      .map((r) => r.id);
    expect(oauthIds).toEqual([
      "gmail",
      "workspace",
      "outlook",
      "office365",
      "zoho",
      "fastmail",
    ]);
  });

  it("does not invent branded iCloud / Yahoo / AOL rows; Proton/Tuta are password not IMAP", () => {
    const ids = MAIL_PROVIDER_CATALOG.map((r) => r.id);
    expect(ids).not.toEqual(expect.arrayContaining(["icloud", "yahoo", "aol"]));
    const proton = MAIL_PROVIDER_CATALOG.find((r) => r.id === "proton");
    const tuta = MAIL_PROVIDER_CATALOG.find((r) => r.id === "tuta");
    expect(proton?.branded).toBe(true);
    expect(proton?.auth).toBe("password");
    expect(tuta?.branded).toBe(true);
    expect(tuta?.auth).toBe("password");
  });

  it("keeps Zoho/Fastmail/Office365 branded OAuth with live HTTP fetchers", () => {
    for (const id of ["zoho", "fastmail", "office365"] as const) {
      const row = MAIL_PROVIDER_CATALOG.find((r) => r.id === id);
      expect(row?.branded).toBe(true);
      expect(row?.auth).toBe("oauth");
      expect(row?.liveScanInPhase4).toBe(true);
    }
    expect(imapConnectRow().liveScanInPhase4).toBe(true);
    expect(imapConnectRow().note).toMatch(/Not Proton or Tuta/);
  });
});

describe("emailscan incremental scan", () => {
  it("first scan fetches without a cursor; later scan asks for newer than lastCursor", async () => {
    const store = createMemoryScanStore();
    const firstRenewal: NormalizedMessage = {
      ...FIXTURE_RENEWAL,
      date: "2026-08-10T12:00:00.000Z",
    };
    const later: NormalizedMessage = {
      ...FIXTURE_RENEWAL,
      messageId: "renewal-prime-2",
      date: "2026-08-20T12:00:00.000Z",
    };
    const api = fetcherOf([[FIXTURE_WELCOME, firstRenewal], [later]]);

    const first = await runIncrementalScan({
      mailboxId: "box-1",
      providerId: "gmail",
      fetcher: api,
      store,
    });
    expect(api.calls[0].since).toBeNull();
    expect(first.fetched).toBe(2);
    expect(first.cursor.lastMessageId).toBe("renewal-prime");

    const second = await runIncrementalScan({
      mailboxId: "box-1",
      providerId: "gmail",
      fetcher: api,
      store,
    });
    expect(api.calls[1].since).toEqual({
      date: first.cursor.lastMessageDate,
      messageId: first.cursor.lastMessageId,
    });
    expect(second.fetched).toBe(1);
    expect(second.cursor.lastMessageId).toBe("renewal-prime-2");
  });

  it("does not refetch when reading the cached map for display filters", async () => {
    const store = createMemoryScanStore();
    const api = fetcherOf([ALL_FIXTURES]);
    await runIncrementalScan({
      mailboxId: "box-1",
      providerId: "gmail",
      fetcher: api,
      store,
    });
    const cached = cachedCandidates(store, "box-1");
    const shown = filterCandidates(cached, DEFAULT_DISPLAY_FILTERS);
    expect(api.calls).toHaveLength(1);
    expect(shown.every((c) => c.kind === "recurring")).toBe(true);
    expect(shown.length).toBeLessThan(cached.length);
  });

  it("reparses cached mail only after a parser-version bump", async () => {
    const store = createMemoryScanStore();
    const api = fetcherOf([[FIXTURE_WELCOME], []]);
    await runIncrementalScan({
      mailboxId: "box-1",
      providerId: "gmail",
      fetcher: api,
      store,
    });
    const state = store.getMailbox("box-1");
    if (!state) throw new Error("missing mailbox");
    state.cursor.parserVersion = PARSER_VERSION - 1;
    const cached = state.messages["welcome-github"];
    if (!cached) throw new Error("missing welcome");
    cached.parserVersion = PARSER_VERSION - 1;

    const again = await runIncrementalScan({
      mailboxId: "box-1",
      providerId: "gmail",
      fetcher: api,
      store,
    });
    expect(again.reparsed).toBe(1);
    expect(again.fetched).toBe(0);
    expect(store.getMailbox("box-1")?.cursor.parserVersion).toBe(
      PARSER_VERSION,
    );
  });

  it("does not invent rows from a newsletter-only fetch", async () => {
    const store = createMemoryScanStore();
    const api = fetcherOf([[FIXTURE_NEWSLETTER]]);
    const result = await runIncrementalScan({
      mailboxId: "box-1",
      providerId: "imap",
      fetcher: api,
      store,
    });
    expect(result.fetched).toBe(1);
    expect(result.candidates).toEqual([]);
  });
});
