/**
 * R26 / DEC-001: materialized merchant actuals — a deterministic, rebuildable
 * cache over `mail_messages` (the SSOT). Boot reads these small aggregate
 * rows instead of every classified message; any suspected staleness is
 * cured by `rebuildProjectionAsync()`, a full fold of local rows.
 *
 * Bucket semantics mirror the R25 merchant index and `matchesSubscription`
 * exactly. A sub matches a hit when `hit.merchantKey === nameToSlug(sub.name)`
 * OR `hit.merchantName.toLowerCase() === sub.name.toLowerCase()`. To sum that
 * OR without double-counting, each charge is written to:
 *   - 'slug' bucket under merchantKey (always),
 *   - 'name' bucket under merchantName.toLowerCase() (only when it differs
 *     from merchantKey),
 *   - 'both' correction bucket under `merchantKey<US>lowerName` (same
 *     condition) — the reader computes slug + name − both.
 */
import { getDatabase } from "@/services/db/connection";

export const PROJECTION_BUCKET_SEP = "\u0001";

export type ActualsKind = "recurring" | "sparse";

export interface ProjectionSourceRow {
  merchantKey: string;
  merchantName: string;
  /** Mailbox the charge arrived in (matcher filters by it). */
  mailboxId: string;
  /** Classified kind; the fold keeps only recurring/sparse charges. */
  kind: string;
  amount: number;
  /** ISO-8601 charge-email date. */
  date: string;
}

export interface MerchantDayActual {
  bucketType: "slug" | "name" | "both";
  bucketKey: string;
  mailboxId: string;
  kind: ActualsKind;
  /** Device-local calendar day, YYYY-MM-DD. */
  day: string;
  total: number;
  count: number;
}

/** Local calendar day of an ISO date, or null when unparseable. */
export function localDayKey(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Overlap-correction bucket key for a (merchantKey, lowerName) pair. */
export function bothBucketKey(merchantKey: string, lowerName: string): string {
  return `${merchantKey}${PROJECTION_BUCKET_SEP}${lowerName}`;
}

/** Pure fold: charge rows → aggregate rows, stable order. */
export function foldActuals(rows: ProjectionSourceRow[]): MerchantDayActual[] {
  const totals = new Map<string, MerchantDayActual>();

  const add = (
    bucketType: MerchantDayActual["bucketType"],
    bucketKey: string,
    mailboxId: string,
    kind: ActualsKind,
    day: string,
    amount: number,
  ) => {
    const key = `${bucketType}\u0000${bucketKey}\u0000${mailboxId}\u0000${kind}\u0000${day}`;
    const cur = totals.get(key);
    if (cur) {
      cur.total += amount;
      cur.count += 1;
    } else {
      totals.set(key, {
        bucketType,
        bucketKey,
        mailboxId,
        kind,
        day,
        total: amount,
        count: 1,
      });
    }
  };

  for (const row of rows) {
    if (row.kind !== "recurring" && row.kind !== "sparse") continue;
    const day = localDayKey(row.date);
    if (day === null) continue;
    const kind: ActualsKind = row.kind;
    const merchantKey = row.merchantKey;
    const lowerName = row.merchantName.toLowerCase();
    add("slug", merchantKey, row.mailboxId, kind, day, row.amount);
    if (lowerName !== merchantKey) {
      add("name", lowerName, row.mailboxId, kind, day, row.amount);
      add(
        "both",
        bothBucketKey(merchantKey, lowerName),
        row.mailboxId,
        kind,
        day,
        row.amount,
      );
    }
  }

  return [...totals.values()];
}

interface StoredClassifiedRow {
  mailbox_id: string;
  date: string;
  classified_json: string;
}

/** Full fold of local rows → projection table. Returns bucket-row count. */
export async function rebuildProjectionAsync(): Promise<number> {
  const db = getDatabase();
  const t0 = Date.now();
  const stored = await db.getAllAsync<StoredClassifiedRow>(
    "SELECT mailbox_id, date, classified_json FROM mail_messages",
  );
  const source: ProjectionSourceRow[] = [];
  let unparseable = 0;
  for (const row of stored) {
    try {
      const c = JSON.parse(row.classified_json) as {
        merchantKey?: unknown;
        merchantName?: unknown;
        kind?: unknown;
        amount?: unknown;
      };
      if (
        typeof c.merchantKey !== "string" ||
        typeof c.merchantName !== "string" ||
        (c.kind !== "recurring" && c.kind !== "sparse") ||
        typeof c.amount !== "number"
      ) {
        continue;
      }
      source.push({
        merchantKey: c.merchantKey,
        merchantName: c.merchantName,
        mailboxId: row.mailbox_id,
        kind: c.kind,
        amount: c.amount,
        date: row.date,
      });
    } catch {
      unparseable += 1;
    }
  }
  const agg = foldActuals(source);
  await db.execAsync("DELETE FROM merchant_day_actuals");
  await db.withTransactionAsync(async () => {
    const stmt = await db.prepareAsync(
      `INSERT OR REPLACE INTO merchant_day_actuals
         (bucket_type, bucket_key, mailbox_id, kind, day, total, count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    try {
      for (const a of agg) {
        await stmt.executeAsync(
          a.bucketType,
          a.bucketKey,
          a.mailboxId,
          a.kind,
          a.day,
          a.total,
          a.count,
        );
      }
    } finally {
      await stmt.finalizeAsync();
    }
  });
  console.log(
    `[MailScan] projection rebuilt: ${agg.length} buckets from ` +
      `${source.length} charges (${unparseable} unparseable skipped) in ` +
      `${Date.now() - t0}ms`,
  );
  return agg.length;
}

export async function loadActualsAsync(): Promise<MerchantDayActual[]> {
  const db = getDatabase();
  return db.getAllAsync<MerchantDayActual>(
    `SELECT bucket_type AS bucketType, bucket_key AS bucketKey,
            mailbox_id AS mailboxId, kind, day, total, count
     FROM merchant_day_actuals`,
  );
}