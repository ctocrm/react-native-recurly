/**
 * R33: ESP-orphan retirement — pre-R29 rows minted from ESP hosts re-key to
 * the real store (via their source message) or archive. Never hard-deleted.
 */
import { isEspNamedRow, migrateEspOrphans } from "../espOrphan";
import type { MigrationDb } from "../espOrphan";

interface SubRow {
  id: string;
  name: string;
  status: string | null;
  source_message_id: string | null;
  payment_method: string | null;
}

function makeDb(subs: SubRow[], messages: Record<string, object>) {
  const updates: { sql: string; params: unknown[] }[] = [];
  const db: MigrationDb & { updates: typeof updates } = {
    updates,
    async getAllAsync(sql: string, ...params: unknown[]) {
      if (sql.includes("FROM subscriptions")) return subs as never;
      if (sql.includes("FROM mail_messages")) {
        const id = String(params[0]);
        const row = messages[id];
        return (row ? [row] : []) as never;
      }
      return [] as never;
    },
    async runAsync(sql: string, ...params: unknown[]) {
      updates.push({ sql, params });
    },
  };
  return db;
}

describe("isEspNamedRow", () => {
  it("matches ESP-host minted names", () => {
    expect(isEspNamedRow("Shopifyemail")).toBe(true);
    expect(isEspNamedRow("shopifyemail")).toBe(true);
    expect(isEspNamedRow("Temuemail")).toBe(true);
    expect(isEspNamedRow("Sendgrid")).toBe(true);
  });

  it("never matches real merchants", () => {
    expect(isEspNamedRow("Elite Ti")).toBe(false);
    expect(isEspNamedRow("Shopify")).toBe(false);
    expect(isEspNamedRow("Temu")).toBe(false);
    expect(isEspNamedRow("Acme Store")).toBe(false);
  });
});

describe("migrateEspOrphans (schema v19)", () => {
  const ghostWithSource: SubRow = {
    id: "g1",
    name: "Shopifyemail",
    status: "active",
    source_message_id: "msg-1",
    payment_method: "workspace:david@bohbotweb.com",
  };
  const sourceMessage = {
    mailbox_id: "workspace:david@bohbotweb.com",
    message_id: "msg-1",
    from_addr: "Elite Ti <orders@shopifyemail.com>",
    subject: "Your order #1001",
    date: "2026-09-17",
    body_text: "Order total $12.50. Thank you for your purchase.",
    html: null,
    attachments_json: null,
  };

  it("re-keys a ghost to the real store from its source message", async () => {
    const db = makeDb([ghostWithSource], { "msg-1": sourceMessage });
    await migrateEspOrphans(db);
    const rekey = db.updates.find((u) => u.sql.includes("SET name = ?"));
    expect(rekey).toBeDefined();
    expect(rekey!.params[0]).toBe("Elite Ti");
    expect(rekey!.params[1]).toBe("elite-ti");
    expect(db.updates.some((u) => u.sql.includes("archived"))).toBe(false);
  });

  it("archives instead of duplicating when the store already has a live row", async () => {
    const db = makeDb(
      [
        ghostWithSource,
        {
          id: "e1",
          name: "Elite Ti",
          status: "active",
          source_message_id: null,
          payment_method: null,
        },
      ],
      { "msg-1": sourceMessage },
    );
    await migrateEspOrphans(db);
    expect(
      db.updates.some(
        (u) => u.sql.includes("archived") && u.params[0] === "g1",
      ),
    ).toBe(true);
    expect(db.updates.some((u) => u.sql.includes("SET name = ?"))).toBe(false);
  });

  it("archives a ghost with no resolvable source message", async () => {
    const db = makeDb(
      [
        {
          id: "g2",
          name: "Temuemail",
          status: "active",
          source_message_id: null,
          payment_method: null,
        },
      ],
      {},
    );
    await migrateEspOrphans(db);
    expect(
      db.updates.some(
        (u) => u.sql.includes("archived") && u.params[0] === "g2",
      ),
    ).toBe(true);
  });

  it("archives a ghost whose source message classifies as a drop", async () => {
    const db = makeDb(
      [ghostWithSource],
      {
        "msg-1": {
          ...sourceMessage,
          from_addr: "no-reply@shopifyemail.com",
          body_text: "Thanks. Order total $19.99.",
        },
      },
    );
    await migrateEspOrphans(db);
    expect(db.updates.some((u) => u.sql.includes("archived"))).toBe(true);
  });

  it("leaves non-ESP rows and already-archived ghosts untouched", async () => {
    const db = makeDb(
      [
        {
          id: "ok",
          name: "Elite Ti",
          status: "active",
          source_message_id: null,
          payment_method: null,
        },
        { ...ghostWithSource, id: "g3", status: "archived" },
      ],
      {},
    );
    await migrateEspOrphans(db);
    expect(db.updates).toHaveLength(0);
  });
});
