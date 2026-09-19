/**
 * R19-OOM regression gates: boot-time classified loads must be memory-bound.
 *
 * 1. listClassifiedMessagesAsync must not fetch body_text/html — legacy rows
 *    carry full bodies and retaining every body at boot OOMs the app.
 * 2. The loaded ClassifiedMessage carries a body-less message stub (display
 *    math only reads mailboxId/date).
 * 3. ensureLegacyBodiesStrippedAsync NULLs legacy body columns in batches and
 *    is a no-op once stripped.
 */

jest.mock("@/services/db/connection", () => {
  const fake = {
    rows: [] as Record<string, unknown>[],
    queries: [] as string[],
    updates: [] as string[],
    page_count: null as number | null,
    freelist_count: null as number | null,
    execed: [] as string[],
    failNextUpdate: false,
    failNextExec: false,
    vacuumFailuresRemaining: 0,
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      fake.queries.push(sql);
      if (/body_text IS NOT NULL/.test(sql)) {
        const limit = typeof params[0] === "number" ? params[0] : 100;
        return fake.rows
          .filter((r) => r.body_text !== null || r.html !== null)
          .slice(0, limit) as unknown as T[];
      }
      if (/rowid > \?/.test(sql)) {
        // Keyset page (R23): rowid is the array position (1-based).
        const last = typeof params[0] === "number" ? params[0] : 0;
        const limit = typeof params[1] === "number" ? params[1] : 200;
        return fake.rows
          .map((r, i) => ({ ...r, rid: i + 1 }))
          .filter((r) => r.rid > last)
          .sort((a, b) => a.rid - b.rid)
          .slice(0, limit) as unknown as T[];
      }
      return fake.rows as unknown as T[];
    },
    async prepareAsync(sql: string): Promise<unknown> {
      fake.queries.push(sql);
      const run = async (...params: unknown[]) => {
        if (/rowid > \?/.test(sql)) {
          // Keyset page (R23): rowid is the array position (1-based).
          const last = typeof params[0] === "number" ? params[0] : 0;
          const limit = typeof params[1] === "number" ? params[1] : 200;
          return fake.rows
            .map((r, i) => ({ ...r, rid: i + 1 }))
            .filter((r) => r.rid > last)
            .sort((a, b) => a.rid - b.rid)
            .slice(0, limit);
        }
        return fake.rows;
      };
      return {
        executeAsync: async (...params: unknown[]) => ({
          getAllAsync: async () => (await run(...params)) as unknown[],
        }),
        finalizeAsync: async () => {},
      };
    },
    async getFirstAsync<T>(sql: string): Promise<T> {
      if (/page_count/.test(sql) && fake.page_count !== null) {
        return { page_count: fake.page_count } as unknown as T;
      }
      if (/freelist_count/.test(sql) && fake.freelist_count !== null) {
        return { freelist_count: fake.freelist_count } as unknown as T;
      }
      if (/journal_mode/.test(sql)) {
        return { journal_mode: "delete" } as unknown as T;
      }
      return null as unknown as T;
    },
    async execAsync(sql: string): Promise<void> {
      fake.execed.push(sql);
      if (fake.failNextExec) {
        fake.failNextExec = false;
        throw new Error("injected exec failure");
      }
      if (/VACUUM/.test(sql) && fake.vacuumFailuresRemaining > 0) {
        // The live R26 failure: another task's txn is open on the shared
        // connection when the VACUUM statement fires.
        fake.vacuumFailuresRemaining -= 1;
        throw new Error("cannot VACUUM from within a transaction");
      }
      // VACUUM rebuilds the file: dead pages vanish. Mirrors real behavior.
      if (/VACUUM/.test(sql)) {
        if (fake.page_count !== null) {
          fake.page_count = Math.max(
            0,
            fake.page_count - (fake.freelist_count ?? 0),
          );
        }
        fake.freelist_count = 0;
      }
    },
    async runAsync(sql: string, ...params: unknown[]): Promise<void> {
      fake.updates.push(sql);
      if (fake.failNextUpdate) {
        fake.failNextUpdate = false;
        throw new Error("injected update failure");
      }
      const row = fake.rows.find(
        (r) => r.mailbox_id === params[1] && r.message_id === params[2],
      );
      if (row && /body_text = NULL/.test(sql)) {
        row.body_text = null;
        row.html = null;
        row.classified_json = params[0];
      }
    },
  };
  return { getDatabase: () => fake };
});

// R26b: persist must never await the (expensive) projection rebuild; the
// gates below pin the fire-and-forget contract.
jest.mock("../projection", () => ({
  rebuildProjectionAsync: jest.fn(() => Promise.resolve()),
}));

const FAT_HTML = `<html><body>${"<p>x</p>".repeat(4000)}</body></html>`;

/** Slim row for paging/vacuum volume tests — no FAT_HTML construction. */
function pageRow(id: string): Record<string, unknown> {
  const row = fatRow(id) as Record<string, unknown>;
  row.body_text = "short";
  row.html = null;
  return row;
}

function fatRow(id: string) {
  return {
    mailbox_id: "workspace:t",
    message_id: id,
    from_addr: "Billing <billing@example.com>",
    subject: "Your monthly membership renewal",
    date: "2026-09-01T00:00:00.000Z",
    body_text: `Invoice #INV-7788 total $19.00 ${"filler ".repeat(200)}`,
    html: FAT_HTML,
    attachments_json: null,
    classified_json: JSON.stringify({
      category: "subscription",
      merchant: "ExampleGym",
    }),
    parser_version: 1,
  };
}

/** Minimal single-message mailbox state for saveMailboxAsync gates. */
function scanState() {
  const message = {
    mailboxId: "proton:t",
    messageId: "m-1",
    from: "Billing <billing@example.com>",
    subject: "Your monthly membership renewal",
    date: "2026-09-01T00:00:00.000Z",
  };
  const classified = {
    message,
    subjectClass: "recurring" as const,
    merchantKey: "examplegym",
    merchantName: "ExampleGym",
    kind: "recurring" as const,
    amount: 19,
    currency: "USD",
    amountUnknown: false,
    needsBody: false,
    evidence: [] as string[],
    confidence: "high" as const,
  };
  return {
    mailboxId: "proton:t",
    providerId: "proton" as const,
    cursor: {
      mailboxId: "proton:t",
      lastMessageDate: null,
      lastMessageId: null,
      parserVersion: 1,
    },
    messages: { "m-1": { message, classified, parserVersion: 1 } },
  };
}

interface FakeDb {
  rows: Record<string, unknown>[];
  queries: string[];
  updates: string[];
  page_count: number | null;
  freelist_count: number | null;
  execed: string[];
  failNextUpdate: boolean;
  failNextExec: boolean;
  vacuumFailuresRemaining: number;
}

// Fresh module registry per call so persist.ts's once-per-session strip
// guard starts clean and the mocked fake db is recreated with it.
function freshEnv(): { persist: typeof import("../persist"); db: FakeDb } {
  let persist!: typeof import("../persist");
  let db!: FakeDb;
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest module isolation requires CJS require
    persist = require("../persist");
    db = (
      jest.requireMock("@/services/db/connection") as {
        getDatabase: () => FakeDb;
      }
    ).getDatabase();
  });
  return { persist, db };
}

describe("listClassifiedMessagesAsync (lean read)", () => {
  it("never selects body_text/html columns", async () => {
    const { persist, db } = freshEnv();
    db.rows = [fatRow("m-1"), fatRow("m-2")];
    await persist.listClassifiedMessagesAsync();
    const loadSql = db.queries.find(
      (q) => /FROM mail_messages/.test(q) && !/IS NOT NULL/.test(q),
    );
    expect(loadSql).toBeDefined();
    expect(loadSql).not.toMatch(/body_text|html/);
    expect(loadSql).toMatch(/classified_json/);
    // Paged: must never materialize the whole table in one shot.
    expect(loadSql).toMatch(/ORDER BY rowid\s*LIMIT \?/);
    // R23: keyset, not OFFSET — OFFSET re-walks every discarded row per page
    // and over fat legacy pages that cost ~60s of cold-boot load.
    expect(loadSql).not.toMatch(/OFFSET/);
  });

  it("aggregates every row exactly once across keyset pages", async () => {
    const { persist, db } = freshEnv();
    // 2500 rows forces 3 pages at BATCH=1000 (1000 + 1000 + 500).
    db.rows = Array.from({ length: 2500 }, (_, i) => pageRow(`m-${i}`));
    const hits = await persist.listClassifiedMessagesAsync();
    expect(hits).toHaveLength(2500);
    expect(new Set(hits.map((h) => h.message.messageId)).size).toBe(2500);
    // 3 keyset queries + nothing else against mail_messages from the loader.
    const pageQueries = db.queries.filter(
      (q) => /rowid > \?/.test(q) && /FROM mail_messages/.test(q),
    );
    expect(pageQueries).toHaveLength(3);
  });

  it("shares one in-flight load across concurrent callers (R24)", async () => {
    const { persist, db } = freshEnv();
    db.rows = Array.from({ length: 2500 }, (_, i) => pageRow(`m-${i}`));
    // Boot fires the loader on mount AND again when subscriptions arrive;
    // the second caller must ride the first load, not re-page the table.
    const [a, b] = await Promise.all([
      persist.listClassifiedMessagesAsync(),
      persist.listClassifiedMessagesAsync(),
    ]);
    expect(a).toBe(b);
    expect(db.queries.filter((q) => /rowid > \?/.test(q))).toHaveLength(3);
  });

  it("returns classified messages with a body-less message stub", async () => {
    const { persist, db } = freshEnv();
    db.rows = [fatRow("m-1"), fatRow("m-2")];
    const hits = await persist.listClassifiedMessagesAsync();
    expect(hits).toHaveLength(2);
    for (const hit of hits) {
      expect(hit.message.mailboxId).toBe("workspace:t");
      expect(hit.message.date).toBe("2026-09-01T00:00:00.000Z");
      expect(hit.message.from).toContain("billing@example.com");
      expect(hit.message.text).toBeUndefined();
      expect(hit.message.html).toBeUndefined();
      expect(hit.message.attachments).toBeUndefined();
    }
  });
});

describe("ensureLegacyBodiesStrippedAsync", () => {
  it("NULLs body columns of legacy fat rows", async () => {
    const { persist, db } = freshEnv();
    db.rows = [fatRow("m-1"), fatRow("m-2")];
    await persist.ensureLegacyBodiesStrippedAsync();
    expect(db.rows.every((r) => r.body_text === null && r.html === null)).toBe(
      true,
    );
    expect(db.updates.filter((u) => /body_text = NULL/.test(u))).toHaveLength(
      2,
    );
    // The embedded classified_json message must be stubbed too — it carried
    // the full serialized body in legacy rows.
    for (const r of db.rows) {
      const json = String(r.classified_json);
      expect(json).not.toContain("filler");
      expect(json).not.toContain("<p>");
      const parsed = JSON.parse(json) as {
        message?: { text?: string; html?: string };
      };
      expect(parsed.message?.text).toBeUndefined();
      expect(parsed.message?.html).toBeUndefined();
    }
  });

  it("is a no-op once every row is stripped", async () => {
    const { persist, db } = freshEnv();
    db.rows = [fatRow("m-1")];
    await persist.ensureLegacyBodiesStrippedAsync();
    expect(db.updates.filter((u) => /body_text = NULL/.test(u))).toHaveLength(1);
    await persist.ensureLegacyBodiesStrippedAsync();
    expect(db.updates.filter((u) => /body_text = NULL/.test(u))).toHaveLength(1);
  });

  it("logs its strip count and its failures (R23)", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { persist, db } = freshEnv();
      db.rows = [fatRow("m-1"), fatRow("m-2")];
      await persist.ensureLegacyBodiesStrippedAsync();
      expect(
        logSpy.mock.calls.some((c) =>
          String(c[0]).includes("legacy body strip: 2 rows stripped"),
        ),
      ).toBe(true);

      // A failing strip must be logged, not swallowed — a silent failure
      // kept fat rows (and the slow cold-boot load they cause) forever.
      const { persist: p2, db: db2 } = freshEnv();
      db2.rows = [fatRow("m-1")];
      db2.failNextUpdate = true;
      await p2.ensureLegacyBodiesStrippedAsync();
      expect(
        logSpy.mock.calls.some((c) =>
          String(c[0]).includes("legacy body strip FAILED"),
        ),
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});

describe("ensureDbCompactedAsync (R24)", () => {
  it("vacuums when free pages dominate, then self-limits", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { persist, db } = freshEnv();
      db.rows = [pageRow("m-1")];
      // The measured R24 shape: 86% of pages dead.
      db.page_count = 33897;
      db.freelist_count = 29230;
      await persist.ensureDbCompactedAsync();
      expect(db.execed.filter((s) => /VACUUM/.test(s))).toHaveLength(1);
      // Fake mirrors real VACUUM: freelist collapses into the file.
      expect(db.page_count).toBe(4667);
      expect(db.freelist_count).toBe(0);

      // Fresh session against the now-compact file: guard skips, no vacuum.
      const { persist: p2, db: db2 } = freshEnv();
      db2.page_count = 4667;
      db2.freelist_count = 0;
      await p2.ensureDbCompactedAsync();
      expect(db2.execed.some((s) => /VACUUM/.test(s))).toBe(false);
      expect(
        logSpy.mock.calls.some((c) => String(c[0]).includes("db vacuum: skipped")),
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not vacuum a healthy file", async () => {
    const { persist, db } = freshEnv();
    db.rows = [pageRow("m-1")];
    db.page_count = 3000;
    db.freelist_count = 50;
    await persist.ensureDbCompactedAsync();
    expect(db.execed.some((s) => /VACUUM/.test(s))).toBe(false);
  });

  it("logs vacuum failures instead of swallowing them (R23 class)", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { persist, db } = freshEnv();
      db.rows = [pageRow("m-1")];
      db.page_count = 33897;
      db.freelist_count = 29230;
      db.failNextExec = true;
      await persist.ensureDbCompactedAsync();
      expect(
        logSpy.mock.calls.some((c) =>
          String(c[0]).includes("db vacuum FAILED"),
        ),
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("retries VACUUM deferred by an open transaction, then compacts (R26)", async () => {
    jest.useFakeTimers();
    try {
      const { persist, db } = freshEnv();
      db.rows = [pageRow("m-1")];
      db.page_count = 33897;
      db.freelist_count = 29230;
      // Two interleaved-transaction refusals, then the txn closes.
      db.vacuumFailuresRemaining = 2;
      const pending = persist.ensureDbCompactedAsync();
      await jest.advanceTimersByTimeAsync(3_000);
      await jest.advanceTimersByTimeAsync(6_000);
      await pending;
      expect(db.execed.filter((s) => /VACUUM/.test(s))).toHaveLength(3);
      expect(db.page_count).toBe(4667);
      expect(db.freelist_count).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it("defers through the whole backoff window, then logs the failure (R26)", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    jest.useFakeTimers();
    try {
      const { persist, db } = freshEnv();
      db.rows = [pageRow("m-1")];
      db.page_count = 33897;
      db.freelist_count = 29230;
      // Transaction never closes inside the window: 1 attempt + 5 retries.
      db.vacuumFailuresRemaining = Number.POSITIVE_INFINITY;
      const pending = persist.ensureDbCompactedAsync();
      await jest.advanceTimersByTimeAsync(93_000);
      await pending;
      expect(db.execed.filter((s) => /VACUUM/.test(s))).toHaveLength(6);
      expect(
        logSpy.mock.calls.filter((c) =>
          String(c[0]).includes("db vacuum deferred"),
        ),
      ).toHaveLength(5);
      expect(
        logSpy.mock.calls.some((c) =>
          String(c[0]).includes("db vacuum FAILED"),
        ),
      ).toBe(true);
    } finally {
      jest.useRealTimers();
      logSpy.mockRestore();
    }
  });
});

describe("saveMailboxAsync (R26b: projection rebuild must not block the write path)", () => {
  it("resolves while the rebuild is still in flight and coalesces mid-flight writes into one trailing rebuild", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let persist!: typeof import("../persist");
    let proj!: { rebuildProjectionAsync: jest.Mock };
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest module isolation requires CJS require
      persist = require("../persist");
      // Same isolated registry, so this is the mock instance persist captured.
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest module isolation requires CJS require
      proj = require("../projection");
    });
    proj.rebuildProjectionAsync.mockImplementation(() => gate);

    // Rebuild is kicked off synchronously but must NOT be awaited by the save.
    await persist.saveMailboxAsync(scanState());
    expect(proj.rebuildProjectionAsync).toHaveBeenCalledTimes(1);

    // A write landing mid-rebuild is dirty-flagged, not stacked.
    await persist.saveMailboxAsync(scanState());
    expect(proj.rebuildProjectionAsync).toHaveBeenCalledTimes(1);

    release();
    await gate;
    // Let the scheduler's finally chain settle, then require the trailing fold.
    for (let i = 0; i < 20 && proj.rebuildProjectionAsync.mock.calls.length < 2; i++) {
      await Promise.resolve();
    }
    expect(proj.rebuildProjectionAsync).toHaveBeenCalledTimes(2);
  });

  it("still surfaces rebuild failures via console log instead of throwing on the write path", async () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    try {
      let persist!: typeof import("../persist");
      let proj!: { rebuildProjectionAsync: jest.Mock };
      jest.isolateModules(() => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest module isolation requires CJS require
        persist = require("../persist");
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest module isolation requires CJS require
        proj = require("../projection");
      });
      proj.rebuildProjectionAsync.mockImplementation(
        () => Promise.reject(new Error("boom")) as unknown as Promise<void>,
      );
      await expect(persist.saveMailboxAsync(scanState())).resolves.toBeUndefined();
      expect(proj.rebuildProjectionAsync).toHaveBeenCalledTimes(1);
      for (let i = 0; i < 20 && logSpy.mock.calls.length === 0; i++) {
        await Promise.resolve();
      }
      expect(
        logSpy.mock.calls.some(
          (c) =>
            String(c[0]).includes("projection rebuild FAILED") &&
            String(c[1]).includes("boom"),
        ),
      ).toBe(true);
    } finally {
      logSpy.mockRestore();
    }
  });
});
