/**
 * SQLite scan cache. Local-only (not cloud-synced).
 */
import { getDatabase } from "@/services/db/connection";
import type {
  CachedMessage,
  ClassifiedMessage,
  MailProviderId,
  MailboxScanState,
  NormalizedMessage,
  ScanCacheStore,
} from "./types";
import { PARSER_VERSION } from "./types";

interface MailboxRow {
  id: string;
  provider_id: string;
  last_message_date: string | null;
  last_message_id: string | null;
  parser_version: number;
}

interface MessageRow {
  mailbox_id: string;
  message_id: string;
  from_addr: string;
  subject: string;
  date: string;
  body_text: string | null;
  html: string | null;
  attachments_json: string | null;
  classified_json: string;
  parser_version: number;
}

/** Lean projection of MessageRow — never carries body_text/html. */
interface ClassifiedLeanRow {
  mailbox_id: string;
  message_id: string;
  from_addr: string;
  subject: string;
  date: string;
  classified_json: string;
  parser_version: number;
}

function rowToMessage(row: MessageRow): CachedMessage {
  const message: NormalizedMessage = {
    mailboxId: row.mailbox_id,
    messageId: row.message_id,
    from: row.from_addr,
    subject: row.subject,
    date: row.date,
    text: row.body_text ?? undefined,
    html: row.html ?? undefined,
    attachments: row.attachments_json
      ? JSON.parse(row.attachments_json)
      : undefined,
  };
  const classified = JSON.parse(row.classified_json) as ClassifiedMessage;
  classified.message = message;
  return {
    message,
    classified,
    parserVersion: row.parser_version,
  };
}

export function createSqliteScanStore(): ScanCacheStore {
  return {
    getMailbox(mailboxId) {
      throw new Error("Use getMailboxAsync");
    },
    saveMailbox() {
      throw new Error("Use saveMailboxAsync");
    },
    clearMailbox() {
      throw new Error("Use clearMailboxAsync");
    },
  };
}

export async function getMailboxAsync(
  mailboxId: string,
): Promise<MailboxScanState | undefined> {
  const db = getDatabase();
  const box = await db.getFirstAsync<MailboxRow>(
    "SELECT * FROM mail_mailboxes WHERE id = ?",
    mailboxId,
  );
  if (!box) return undefined;
  if (box.parser_version !== PARSER_VERSION) {
    await db.runAsync(
      "DELETE FROM mail_messages WHERE mailbox_id = ?",
      mailboxId,
    );
    await db.runAsync(
      `UPDATE mail_mailboxes
       SET last_message_date = NULL, last_message_id = NULL, parser_version = ?
       WHERE id = ?`,
      PARSER_VERSION,
      mailboxId,
    );
    return {
      mailboxId: box.id,
      providerId: box.provider_id as MailProviderId,
      cursor: {
        mailboxId: box.id,
        lastMessageDate: null,
        lastMessageId: null,
        parserVersion: PARSER_VERSION,
      },
      messages: {},
    };
  }
  const rows = await db.getAllAsync<MessageRow>(
    "SELECT * FROM mail_messages WHERE mailbox_id = ?",
    mailboxId,
  );
  const messages: Record<string, CachedMessage> = {};
  for (const row of rows) {
    messages[row.message_id] = rowToMessage(row);
  }
  return {
    mailboxId: box.id,
    providerId: box.provider_id as MailProviderId,
    cursor: {
      mailboxId: box.id,
      lastMessageDate: box.last_message_date,
      lastMessageId: box.last_message_id,
      parserVersion: box.parser_version,
    },
    messages,
  };
}

let inflightLoad: Promise<ClassifiedMessage[]> | null = null;

/**
 * Cached classified messages only, lean projection. Deduped: the boot effect
 * re-fires when subscriptions arrive (~300ms after mount), and two concurrent
 * paging loops contended the connection and doubled the cold load (R24).
 */
export function listClassifiedMessagesAsync(): Promise<ClassifiedMessage[]> {
  inflightLoad ??= listClassifiedMessagesUncancelledAsync().finally(() => {
    inflightLoad = null;
  });
  return inflightLoad;
}

async function listClassifiedMessagesUncancelledAsync(): Promise<
  ClassifiedMessage[]
> {
  const db = getDatabase();
  // Lean read, paged by rowid keyset: never SELECT * (legacy classified_json
  // embeds the full message body) and never materialize the whole table in
  // one getAllAsync — either one OOMs the app at boot (R19). R23: keyset
  // (`rowid > last`) replaced LIMIT/OFFSET — OFFSET makes SQLite re-walk
  // every discarded row on each page, and over fat legacy pages the
  // cold-boot classified load took ~60s, leaving Monthly Spend showing
  // recurring-only ($177.08) for a full minute before sparse actuals landed.
  // Keyset seeks straight to each page: O(N) total.
  const hits: ClassifiedMessage[] = [];
  const BATCH = 1000;
  // R24: split db-wait from JS parse so the cold-load tail names its owner.
  const t0 = Date.now();
  const shape = await db.getFirstAsync<{
    page_count: number;
    freelist_count: number;
    journal_mode: string;
  }>("PRAGMA page_count");
  const freelist = await db.getFirstAsync<{ freelist_count: number }>(
    "PRAGMA freelist_count",
  );
  const journal = await db.getFirstAsync<{ journal_mode: string }>(
    "PRAGMA journal_mode",
  );
  console.log(
    `[MailScan] db shape: pageCount=${shape?.page_count ?? "?"} ` +
      `freelist=${freelist?.freelist_count ?? "?"} ` +
      `journal=${journal?.journal_mode ?? "?"}`,
  );
  let page = 0;
  let dbMs = 0;
  let lastRowid = 0;
  // R24: liveness ticker — if these ticks gap out, the JS thread (not the
  // DB) owns the stall; if they keep beating while a phase hangs, the DB
  // side owns it. Split prepare/execute/fetch so the phase names itself.
  let lastTick = Date.now();
  const tick = setInterval(() => {
    const now = Date.now();
    console.log(`[MailScan] js-tick +${now - lastTick}ms`);
    lastTick = now;
  }, 500);
  try {
    for (;;) {
      const tq = Date.now();
      const statement = await db.prepareAsync(
        `SELECT rowid AS rid, mailbox_id, message_id, from_addr, subject, date,
                classified_json, parser_version
         FROM mail_messages
         WHERE rowid > ?
         ORDER BY rowid
         LIMIT ?`,
      );
      const prepMs = Date.now() - tq;
      const tex = Date.now();
      const result = await statement.executeAsync(lastRowid, BATCH);
      const execMs = Date.now() - tex;
      const tfe = Date.now();
      const rows = (await result.getAllAsync()) as (ClassifiedLeanRow & {
        rid: number;
      })[];
      const fetchMs = Date.now() - tfe;
      await statement.finalizeAsync();
      dbMs += Date.now() - tq;
      page += 1;
      console.log(
        `[MailScan] classified page ${page}: rows=${rows.length} ` +
          `prepMs=${prepMs} execMs=${execMs} fetchMs=${fetchMs}`,
      );
      if (rows.length === 0) break;
      for (const row of rows) hits.push(leanRowToClassified(row));
      if (rows.length < BATCH) break;
      lastRowid = rows[rows.length - 1].rid;
    }
  } finally {
    clearInterval(tick);
  }
  console.log(
    `[MailScan] classified load: pages=${page} rows=${hits.length} ` +
      `dbMs=${dbMs} totalMs=${Date.now() - t0}`,
  );
  // Fire-and-forget: rewrite legacy fat rows (NULL body columns, stub the
  // embedded message), then reclaim the dead space their era left behind.
  // Batched, memory-bound, never blocks this load.
  void ensureLegacyBodiesStrippedAsync().then(() => {
    void ensureDbCompactedAsync();
  });
  return hits;
}

const VACUUM_MIN_FREE_PAGES = 1000;
const VACUUM_FREE_RATIO = 0.2;
let vacuumOnce: Promise<void> | null = null;

/**
 * R24: the legacy fat-body era left the DB ~86% free pages (33897 total,
 * 29230 free ≈ 114MB dead) — every cold classified read paid for a 132MB
 * file to serve 2209 lean rows. VACUUM once per session when dead space
 * dominates; self-limiting, no preference flag — the freelist collapses
 * after the first run, so the guard never fires again until a future mass
 * delete re-fragments the file.
 */
export function ensureDbCompactedAsync(): Promise<void> {
  vacuumOnce ??= compactIfFragmentedAsync().catch((err) => {
    console.log(
      "[MailScan] db vacuum FAILED",
      err instanceof Error ? err.message : String(err),
    );
  });
  return vacuumOnce;
}

async function compactIfFragmentedAsync(): Promise<void> {
  const db = getDatabase();
  const pc = await db.getFirstAsync<{ page_count: number }>(
    "PRAGMA page_count",
  );
  const fl = await db.getFirstAsync<{ freelist_count: number }>(
    "PRAGMA freelist_count",
  );
  const pageCount = pc?.page_count ?? 0;
  const freePages = fl?.freelist_count ?? 0;
  if (
    freePages < VACUUM_MIN_FREE_PAGES ||
    (pageCount > 0 && freePages / pageCount < VACUUM_FREE_RATIO)
  ) {
    console.log(
      `[MailScan] db vacuum: skipped (pageCount=${pageCount} freelist=${freePages})`,
    );
    return;
  }
  const t0 = Date.now();
  await db.execAsync("VACUUM");
  const after = await db.getFirstAsync<{ page_count: number }>(
    "PRAGMA page_count",
  );
  console.log(
    `[MailScan] db vacuum: ${pageCount} -> ${after?.page_count ?? "?"} pages ` +
      `in ${Date.now() - t0}ms`,
  );
}

function leanRowToClassified(row: ClassifiedLeanRow): ClassifiedMessage {
  const classified = JSON.parse(row.classified_json) as ClassifiedMessage;
  classified.message = {
    mailboxId: row.mailbox_id,
    messageId: row.message_id,
    from: row.from_addr,
    subject: row.subject,
    date: row.date,
  };
  return classified;
}

const STRIP_BATCH = 100;
let stripBodiesOnce: Promise<void> | null = null;

/**
 * One-time per session: NULL legacy body_text/html columns. Rows written
 * before body-stripping store full bodies, which made boot-time loads OOM
 * (R19). Batches small ID sets so memory stays bounded; a no-op once every
 * row is stripped. Failures never wedge the caller — retried next session.
 */
export function ensureLegacyBodiesStrippedAsync(): Promise<void> {
  stripBodiesOnce ??= stripLegacyBodiesAsync()
    .then((stripped) => {
      if (stripped > 0)
        console.log(`[MailScan] legacy body strip: ${stripped} rows stripped`);
    })
    .catch((err) => {
      // R23: this catch was silent, so a strip that failed every session
      // kept fat rows (and the slow cold-boot load they cause) forever.
      // Log it; retried next session via the reset below.
      console.log(
        "[MailScan] legacy body strip FAILED",
        err instanceof Error ? err.message : String(err),
      );
      stripBodiesOnce = null;
    });
  return stripBodiesOnce;
}

async function stripLegacyBodiesAsync(): Promise<number> {
  const db = getDatabase();
  let stripped = 0;
  for (;;) {
    const batch = await db.getAllAsync<ClassifiedLeanRow>(
      `SELECT mailbox_id, message_id, from_addr, subject, date,
              classified_json, parser_version
       FROM mail_messages
       WHERE body_text IS NOT NULL OR html IS NOT NULL
       LIMIT ?`,
      STRIP_BATCH,
    );
    if (batch.length === 0) return stripped;
    for (const row of batch) {
      // Stub the embedded message too: classified_json carries a full
      // serialized NormalizedMessage (body included) in legacy rows.
      const lean = leanRowToClassified(row);
      await db.runAsync(
        `UPDATE mail_messages
         SET body_text = NULL, html = NULL, classified_json = ?
         WHERE mailbox_id = ? AND message_id = ?`,
        JSON.stringify(lean),
        row.mailbox_id,
        row.message_id,
      );
      stripped += 1;
    }
  }
}

export async function listMailboxesAsync(): Promise<
  { mailboxId: string; providerId: MailProviderId }[]
> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{ id: string; provider_id: string }>(
    "SELECT id, provider_id FROM mail_mailboxes ORDER BY updated_at DESC",
  );
  return rows.map((r) => ({
    mailboxId: r.id,
    providerId: r.provider_id as MailProviderId,
  }));
}

export async function saveMailboxAsync(state: MailboxScanState): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    `INSERT INTO mail_mailboxes (id, provider_id, last_message_date, last_message_id, parser_version, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       provider_id = excluded.provider_id,
       last_message_date = excluded.last_message_date,
       last_message_id = excluded.last_message_id,
       parser_version = excluded.parser_version,
       updated_at = datetime('now')`,
    state.mailboxId,
    state.providerId,
    state.cursor.lastMessageDate,
    state.cursor.lastMessageId,
    state.cursor.parserVersion,
  );

  for (const cached of Object.values(state.messages)) {
    const msg = cached.message;
    await db.runAsync(
      `INSERT INTO mail_messages (
         mailbox_id, message_id, from_addr, subject, date, body_text, html,
         attachments_json, classified_json, parser_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(mailbox_id, message_id) DO UPDATE SET
         from_addr = excluded.from_addr,
         subject = excluded.subject,
         date = excluded.date,
         body_text = excluded.body_text,
         html = excluded.html,
         attachments_json = excluded.attachments_json,
         classified_json = excluded.classified_json,
         parser_version = excluded.parser_version`,
      msg.mailboxId,
      msg.messageId,
      msg.from,
      msg.subject,
      msg.date,
      msg.text ?? null,
      msg.html ?? null,
      msg.attachments ? JSON.stringify(msg.attachments) : null,
      JSON.stringify(cached.classified),
      cached.parserVersion,
    );
  }
}

export async function clearMailboxAsync(mailboxId: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM mail_messages WHERE mailbox_id = ?",
    mailboxId,
  );
  await db.runAsync("DELETE FROM mail_mailboxes WHERE id = ?", mailboxId);
}

/** Cached classified messages only. Does not drop mailbox rows or SecureStore. */
export async function countScanCacheAsync(): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM mail_messages",
  );
  return row?.n ?? 0;
}

/** Drop messages + since-cursors. Connected mailboxes stay signed in. */
export async function clearScanCacheAsync(): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM mail_messages");
  await db.runAsync(
    `UPDATE mail_mailboxes
     SET last_message_date = NULL, last_message_id = NULL, parser_version = ?,
         updated_at = datetime('now')`,
    PARSER_VERSION,
  );
}

/** ScanCacheStore that talks to the opened user DB. */
export function createAsyncScanStore(): {
  getMailbox: typeof getMailboxAsync;
  saveMailbox: typeof saveMailboxAsync;
  clearMailbox: typeof clearMailboxAsync;
} {
  return {
    getMailbox: getMailboxAsync,
    saveMailbox: saveMailboxAsync,
    clearMailbox: clearMailboxAsync,
  };
}

export async function runPersistedScan(opts: {
  mailboxId: string;
  providerId: MailProviderId;
  fetcher: import("./types").MessageFetcher;
  limit?: number;
}) {
  const { runIncrementalScan } = await import("./scan");
  const existing = await getMailboxAsync(opts.mailboxId);
  const memory = new Map<string, MailboxScanState>();
  if (existing) memory.set(opts.mailboxId, existing);
  const store: ScanCacheStore = {
    getMailbox: (id) => memory.get(id),
    saveMailbox: (state) => {
      memory.set(state.mailboxId, state);
    },
    clearMailbox: (id) => {
      memory.delete(id);
    },
  };
  const result = await runIncrementalScan({
    mailboxId: opts.mailboxId,
    providerId: opts.providerId,
    fetcher: opts.fetcher,
    store,
    limit: opts.limit,
  });
  const next = memory.get(opts.mailboxId);
  if (next) await saveMailboxAsync(next);
  return result;
}

export { PARSER_VERSION };
