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
