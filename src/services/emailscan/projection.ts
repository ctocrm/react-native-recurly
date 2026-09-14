/**
 * R26 / DEC-001: DB layer for the merchant actuals projection — a
 * deterministic, rebuildable cache over `mail_messages` (the SSOT). Boot
 * reads these small aggregate rows instead of every classified message; any
 * suspected staleness is cured by `rebuildProjectionAsync()`, a full fold of
 * local rows. Pure fold + types live in projectionCore.ts.
 */
import { getDatabase } from "@/services/db/connection";
import {
  foldActuals,
  type MerchantDayActual,
  type ProjectionSourceRow,
} from "./projectionCore";

export {
  PROJECTION_BUCKET_SEP,
  bothBucketKey,
  foldActuals,
  localDayKey,
} from "./projectionCore";
export type {
  ActualsKind,
  MerchantDayActual,
  ProjectionSourceRow,
} from "./projectionCore";

interface StoredClassifiedRow {
  mailbox_id: string;
  date: string;
  classified_json: string;
}

/** Full fold of local rows → projection table. Returns bucket-row count. */
// ---------------------------------------------------------------------------
// Rebuilt notification (F-6): the projection is a rebuildable cache; UI
// snapshots that sum it (useChargeDisplay's actuals) must reload when it
// changes, or pre-scan buckets render against post-scan rows — 2026-09-14:
// the audit read projection=669.31 (boot-time buckets) vs legacy=519.31
// (fresh rows), match=NO, purely from snapshot staleness; a fresh load
// matched at 0.00.
// ---------------------------------------------------------------------------

type ProjectionRebuiltListener = (bucketCount: number) => void;

const rebuiltListeners = new Set<ProjectionRebuiltListener>();

/**
 * Subscribe to successful projection rebuilds. Returns an unsubscribe
 * function. Listener errors are logged and never break the rebuild.
 */
export function onProjectionRebuilt(
  listener: ProjectionRebuiltListener,
): () => void {
  rebuiltListeners.add(listener);
  return () => {
    rebuiltListeners.delete(listener);
  };
}

function notifyRebuilt(bucketCount: number): void {
  for (const listener of rebuiltListeners) {
    try {
      listener(bucketCount);
    } catch (err) {
      console.log(
        "[MailScan] projection rebuilt listener FAILED",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

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
  notifyRebuilt(agg.length);
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