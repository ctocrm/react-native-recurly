/**
 * R26 / DEC-001: pure merchant-actuals fold — no DB imports, so display
 * readers can consume it without dragging expo-sqlite into their import
 * graph. The DB-backed rebuild/load live in projection.ts.
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