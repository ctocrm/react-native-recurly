/**
 * R33: ESP-orphan retirement. Pre-R29 rows minted from email-service-
 * provider hosts ("Shopifyemail", "Temuemail") are ghosts — PARSER v22+
 * never keys those hosts as merchants, so no candidate can ever match the
 * row's name-slug again. Each ghost is re-attributed to the real store by
 * re-classifying its stored source message; when that is impossible the row
 * is archived (kept for audit, hidden from the app) — never hard-deleted.
 */
import { classifyMessage, isEspBrandName } from "./classifier";
import { nameToSlug } from "@/services/iconScraper";
import type { NormalizedMessage } from "./types";

/** Structural slice of SQLiteDatabase the migration needs (test-friendly). */
export interface MigrationDb {
  getAllAsync<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  runAsync(sql: string, ...params: unknown[]): Promise<unknown>;
}

interface SubRow {
  id: string;
  name: string;
  status: string | null;
  source_message_id: string | null;
  payment_method: string | null;
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
}

/** True when a subscription row's name was minted from an ESP host. */
export function isEspNamedRow(name: string): boolean {
  return isEspBrandName(name);
}

function rowToMessage(row: MessageRow): NormalizedMessage {
  return {
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
}

/**
 * Idempotent migration body (schema v19). For every active ESP-named row:
 * re-classify its source message under the current parser — a resolvable
 * store re-keys the row (unless a live row for that store already exists —
 * one card per merchant), everything else archives.
 */
export async function migrateEspOrphans(db: MigrationDb): Promise<void> {
  const rows = await db.getAllAsync<SubRow>(
    `SELECT id, name, status, source_message_id, payment_method
       FROM subscriptions`,
  );
  const liveRows = rows.filter((r) => r.status !== "archived");
  let rekeyed = 0;
  let archived = 0;

  for (const row of liveRows) {
    if (!isEspNamedRow(row.name)) continue;

    let rekey: { key: string; name: string } | null = null;
    if (row.source_message_id) {
      const msgRows = await db.getAllAsync<MessageRow>(
        `SELECT mailbox_id, message_id, from_addr, subject, date,
                body_text, html, attachments_json
           FROM mail_messages
          WHERE message_id = ?
          ORDER BY CASE WHEN mailbox_id = ? THEN 0 ELSE 1 END
          LIMIT 1`,
        row.source_message_id,
        row.payment_method ?? "",
      );
      if (msgRows.length > 0) {
        const hit = classifyMessage(rowToMessage(msgRows[0]));
        if (
          hit.kind !== null &&
          hit.merchantKey !== "unknown" &&
          !isEspNamedRow(hit.merchantName)
        ) {
          rekey = { key: hit.merchantKey, name: hit.merchantName };
        }
      }
    }

    if (rekey) {
      // One card per merchant: an existing live row with the same name-slug
      // keeps the card; the ghost archives instead of duplicating.
      const clash = liveRows.some(
        (r) =>
          r.id !== row.id &&
          r.status !== "archived" &&
          nameToSlug(r.name) === rekey!.key,
      );
      if (!clash) {
        await db.runAsync(
          `UPDATE subscriptions
              SET name = ?, icon_key = ?, updated_at = datetime('now')
            WHERE id = ?`,
          rekey.name,
          rekey.key,
          row.id,
        );
        rekeyed += 1;
        console.log(
          `[MIGRATE] esp-orphan v19: re-keyed "${row.name}" → "${rekey.name}"`,
        );
        continue;
      }
    }

    await db.runAsync(
      `UPDATE subscriptions
          SET status = 'archived', updated_at = datetime('now')
        WHERE id = ?`,
      row.id,
    );
    archived += 1;
    console.log(`[MIGRATE] esp-orphan v19: archived "${row.name}"`);
  }

  if (rekeyed > 0 || archived > 0) {
    console.log(
      `[MIGRATE] esp-orphan v19 done: ${rekeyed} re-keyed, ${archived} archived`,
    );
  }
}
