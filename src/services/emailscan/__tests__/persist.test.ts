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
    async getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]> {
      fake.queries.push(sql);
      if (/body_text IS NOT NULL/.test(sql)) {
        const limit = typeof params[0] === "number" ? params[0] : 100;
        return fake.rows
          .filter((r) => r.body_text !== null || r.html !== null)
          .slice(0, limit) as unknown as T[];
      }
      if (/LIMIT \? OFFSET \?/.test(sql)) {
        const limit = typeof params[0] === "number" ? params[0] : 200;
        const offset = typeof params[1] === "number" ? params[1] : 0;
        return fake.rows.slice(offset, offset + limit) as unknown as T[];
      }
      return fake.rows as unknown as T[];
    },
    async getFirstAsync<T>(): Promise<T> {
      return null as unknown as T;
    },
    async runAsync(sql: string, ...params: unknown[]): Promise<void> {
      fake.updates.push(sql);
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

const FAT_HTML = `<html><body>${"<p>x</p>".repeat(4000)}</body></html>`;

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

interface FakeDb {
  rows: Record<string, unknown>[];
  queries: string[];
  updates: string[];
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
    expect(loadSql).toMatch(/LIMIT \? OFFSET \?/);
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
});
