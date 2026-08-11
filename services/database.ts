/**
 * Database public API — thin facade over services/db/*.
 * Call sites keep importing from `@/services/database` / `services/database`.
 */
import { icons } from "@/constants/icons";
import * as Crypto from "expo-crypto";
import { CryptoDigestAlgorithm } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { readAsStringAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { openDatabaseAsync } from "expo-sqlite";

import {
  closeDatabase,
  getCurrentUserId,
  getDatabase,
  getOrCreateDbKey,
  openDatabase,
} from "./db/connection";

export {
  closeDatabase,
  getCurrentUserId,
  getDatabase,
  openDatabase,
} from "./db/connection";
export { SCHEMA_VERSION } from "./db/schema";
export {
  BACKUP_FULL_USER_COPY,
  SYNC_LOCAL_ONLY_TABLES,
  SYNC_SCOPE_USER_COPY,
  SYNC_USER_TABLES,
} from "./db/syncScope";
import { SYNC_LOCAL_ONLY_TABLES } from "./db/syncScope";

// ---------------------------------------------------------------------------
// CRUD: Subscriptions
// ---------------------------------------------------------------------------

export type DbSubscription = Omit<Subscription, "icon"> & {
  icon_key: string | null;
};

function rowToSubscription(row: Record<string, any>): Subscription {
  const iconKey = row.icon_key as keyof typeof icons | undefined;
  const icon =
    iconKey && icons[iconKey] !== undefined ? icons[iconKey] : icons.plus;
  return {
    id: row.id,
    icon: icon as any,
    icon_key: iconKey ?? undefined,
    name: row.name,
    plan: row.plan ?? undefined,
    category: row.category ?? undefined,
    paymentMethod: row.payment_method ?? undefined,
    status: row.status ?? undefined,
    startDate: row.start_date ?? undefined,
    price: row.price,
    currency: row.currency ?? undefined,
    billing: row.billing,
    frequency: row.frequency ?? undefined,
    renewalDate: row.renewal_date ?? undefined,
    color: row.color ?? undefined,
  };
}

export async function getAllSubscriptions(): Promise<Subscription[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<Record<string, any>>(
    "SELECT * FROM subscriptions ORDER BY created_at DESC",
  );
  return rows.map(rowToSubscription);
}

export async function getSubscriptionById(
  id: string,
): Promise<Subscription | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<Record<string, any>>(
    "SELECT * FROM subscriptions WHERE id = ?",
    id,
  );
  return row ? rowToSubscription(row) : null;
}

export async function addSubscription(
  subscription: Subscription,
): Promise<void> {
  const db = getDatabase();
  let iconKey: string | null = subscription.icon_key ?? null;
  if (!iconKey) {
    const match = Object.entries(icons).find(
      ([, val]) => val === subscription.icon,
    );
    iconKey = match ? match[0] : "plus";
  }
  await db.runAsync(
    `INSERT INTO subscriptions (id, name, plan, category, payment_method, status, start_date, price, currency, billing, frequency, renewal_date, color, icon_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    subscription.id,
    subscription.name,
    subscription.plan ?? null,
    subscription.category ?? null,
    subscription.paymentMethod ?? null,
    subscription.status ?? "active",
    subscription.startDate ?? null,
    subscription.price,
    subscription.currency ?? "USD",
    subscription.billing,
    subscription.frequency ?? null,
    subscription.renewalDate ?? null,
    subscription.color ?? null,
    iconKey,
  );
}

export async function updateSubscription(
  id: string,
  data: Partial<Subscription>,
): Promise<void> {
  const db = getDatabase();
  const fieldMap: Record<string, string> = {
    name: "name",
    plan: "plan",
    category: "category",
    paymentMethod: "payment_method",
    status: "status",
    startDate: "start_date",
    price: "price",
    currency: "currency",
    billing: "billing",
    frequency: "frequency",
    renewalDate: "renewal_date",
    color: "color",
    icon_key: "icon_key",
  };
  const setClauses: string[] = [];
  const params: any[] = [];
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in data && data[key as keyof Subscription] !== undefined) {
      setClauses.push(`${col} = ?`);
      params.push(data[key as keyof Subscription]);
    }
  }
  if (setClauses.length === 0) return;
  setClauses.push("updated_at = datetime('now')");
  params.push(id);
  await db.runAsync(
    `UPDATE subscriptions SET ${setClauses.join(", ")} WHERE id = ?`,
    ...params,
  );
}

export async function deleteSubscription(id: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM subscriptions WHERE id = ?", id);
}

export async function updateSubscriptionStatus(
  id: string,
  status: "active" | "paused" | "cancelled",
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE subscriptions SET status = ?, updated_at = datetime('now') WHERE id = ?",
    status,
    id,
  );
}

export async function renewSubscription(id: string): Promise<void> {
  const db = getDatabase();
  const row = await db.getFirstAsync<Record<string, any>>(
    "SELECT billing, frequency FROM subscriptions WHERE id = ?",
    id,
  );
  if (!row) return;
  const frequency = row.frequency || row.billing;
  const now = new Date().toISOString();
  const newDate =
    frequency === "Yearly"
      ? new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()
      : frequency === "Weekly"
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await db.runAsync(
    `UPDATE subscriptions SET status = 'active', start_date = ?, renewal_date = ?, updated_at = datetime('now') WHERE id = ?`,
    now,
    newDate,
    id,
  );
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export async function getPreference(key: string): Promise<string | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM preferences WHERE key = ?",
    key,
  );
  return row?.value ?? null;
}

export async function setPreference(key: string, value: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "INSERT OR REPLACE INTO preferences (key, value) VALUES (?, ?)",
    key,
    value,
  );
}

// ---------------------------------------------------------------------------
// Icon Cache
// ---------------------------------------------------------------------------

export interface CachedIconData {
  imageData: string;
  source: string;
  format: string;
  originalUrl: string | null;
  fallbackTier: number;
  originalWidth?: number;
  originalHeight?: number;
}

function detectFormatFromBase64(base64: string, source: string): string {
  if (source === "simple-icons" || source === "tabler" || source === "lucide")
    return "svg";
  try {
    const decoded = atob(base64.substring(0, 200));
    if (
      decoded.startsWith("<svg") ||
      decoded.startsWith("<?xml") ||
      decoded.includes("<svg")
    )
      return "svg";
    if (decoded.startsWith("\x89PNG")) return "png";
    if (decoded.startsWith("\xff\xd8")) return "jpeg";
    if (decoded.startsWith("GIF")) return "gif";
    if (decoded.startsWith("\x00\x00\x01\x00")) return "ico";
    if (decoded.startsWith("RIFF") && decoded.includes("WEBP")) return "webp";
  } catch {}
  return "png";
}

export async function getCachedIcon(
  iconKey: string,
): Promise<CachedIconData | null> {
  const db = getDatabase();
  try {
    const row = await db.getFirstAsync<{
      image_data: string;
      source: string;
      format: string;
      original_url: string | null;
      fallback_tier: number;
      original_width: number | null;
      original_height: number | null;
    }>(
      "SELECT image_data, source, format, original_url, fallback_tier, original_width, original_height FROM icon_cache WHERE icon_key = ?",
      iconKey,
    );
    if (row)
      return {
        imageData: row.image_data,
        source: row.source,
        format: row.format,
        originalUrl: row.original_url ?? null,
        fallbackTier: row.fallback_tier,
        originalWidth: row.original_width ?? undefined,
        originalHeight: row.original_height ?? undefined,
      };
    return null;
  } catch {
    try {
      const row = await db.getFirstAsync<{
        image_data: string;
        source: string;
      }>(
        "SELECT image_data, source FROM icon_cache WHERE icon_key = ?",
        iconKey,
      );
      if (row) {
        const detectedFormat = detectFormatFromBase64(
          row.image_data,
          row.source,
        );
        return {
          imageData: row.image_data,
          source: row.source,
          format: detectedFormat,
          originalUrl: null,
          fallbackTier: 0,
        };
      }
      return null;
    } catch {
      return null;
    }
  }
}

export async function setCachedIcon(
  iconKey: string,
  imageData: string,
  source: string = "local",
  format: string = "png",
  originalUrl: string | null = null,
  fallbackTier: number = 0,
  originalWidth?: number,
  originalHeight?: number,
  /** When true, skip cache listeners (use for multi-step writes; notify once at end). */
  silent: boolean = false,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "INSERT OR REPLACE INTO icon_cache (icon_key, image_data, source, format, original_url, fallback_tier, original_width, original_height, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))",
    iconKey,
    imageData,
    source,
    format,
    originalUrl,
    fallbackTier,
    originalWidth ?? null,
    originalHeight ?? null,
  );
  if (silent) return;
  // Notify listeners that cache has been updated (dynamic import to avoid circular deps)
  setTimeout(async () => {
    const { notifyCacheUpdate } =
      await import("../src/services/iconLoadingRegistry");
    notifyCacheUpdate();
  }, 0);
}

// ---------------------------------------------------------------------------
// Icon Crawl Results (for icon picker)
// ---------------------------------------------------------------------------

export interface CrawlResultData {
  id: number;
  iconKey: string;
  imageData: string;
  source: string;
  format: string;
  originalUrl: string | null;
  fallbackTier: number;
  originalWidth?: number;
  originalHeight?: number;
}

export async function saveCrawlResult(
  iconKey: string,
  imageData: string,
  source: string,
  format: string,
  originalUrl: string | null = null,
  fallbackTier: number = 0,
  originalWidth?: number,
  originalHeight?: number,
): Promise<void> {
  const db = getDatabase();
  // When URL is known, update the existing row (placeholder → bytes) instead of
  // appending duplicates. Unique index enforces one row per (icon_key, url).
  if (originalUrl) {
    const existing = await db.getFirstAsync<{ id: number; image_data: string }>(
      `SELECT id, image_data FROM icon_crawl_results
       WHERE icon_key = ? AND original_url = ?
       ORDER BY id DESC LIMIT 1`,
      iconKey,
      originalUrl,
    );
    if (existing) {
      const existingLen = existing.image_data?.length ?? 0;
      const nextLen = imageData?.length ?? 0;
      // Prefer longer payload (empty placeholder loses to real download)
      if (nextLen >= existingLen) {
        await db.runAsync(
          `UPDATE icon_crawl_results SET
             image_data = ?, source = ?, format = ?, fallback_tier = ?,
             original_width = COALESCE(?, original_width),
             original_height = COALESCE(?, original_height)
           WHERE id = ?`,
          imageData,
          source,
          format,
          fallbackTier,
          originalWidth ?? null,
          originalHeight ?? null,
          existing.id,
        );
      }
      return;
    }
  }
  await db.runAsync(
    "INSERT INTO icon_crawl_results (icon_key, image_data, source, format, original_url, fallback_tier, original_width, original_height) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    iconKey,
    imageData,
    source,
    format,
    originalUrl,
    fallbackTier,
    originalWidth ?? null,
    originalHeight ?? null,
  );
}

/** Remove one crawl-result row by exact image bytes (AI replace path). */
export async function deleteCrawlResultByImageData(
  iconKey: string,
  imageData: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM icon_crawl_results WHERE icon_key = ? AND image_data = ?",
    iconKey,
    imageData,
  );
}

/**
 * Persist AI upscale: cache for card, drop source crawl twin, insert ai_upscale.
 * Notifies cache listeners once after all DB steps complete.
 */
export async function replaceIconWithAiUpscale(
  iconKey: string,
  sourceImageData: string,
  aiImageData: string,
  format: string,
  originalUrl: string | null = null,
  originalWidth?: number,
  originalHeight?: number,
): Promise<void> {
  await setCachedIcon(
    iconKey,
    aiImageData,
    "ai_upscale",
    format,
    originalUrl,
    0,
    originalWidth,
    originalHeight,
    true, // silent — notify once below
  );
  await deleteCrawlResultByImageData(iconKey, sourceImageData);
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM icon_crawl_results WHERE icon_key = ? AND source = ?",
    iconKey,
    "ai_upscale",
  );
  await saveCrawlResult(
    iconKey,
    aiImageData,
    "ai_upscale",
    format,
    originalUrl,
    0,
    originalWidth,
    originalHeight,
  );
  setTimeout(async () => {
    const { notifyCacheUpdate } =
      await import("../src/services/iconLoadingRegistry");
    notifyCacheUpdate();
  }, 0);
}

export async function deleteCrawlResults(iconKey: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM icon_crawl_results WHERE icon_key = ?",
    iconKey,
  );
}

export async function getCrawlResults(
  iconKey: string,
): Promise<CrawlResultData[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<{
    id: number;
    icon_key: string;
    image_data: string;
    source: string;
    format: string;
    original_url: string | null;
    fallback_tier: number;
    original_width: number | null;
    original_height: number | null;
  }>(
    "SELECT id, icon_key, image_data, source, format, original_url, fallback_tier, original_width, original_height FROM icon_crawl_results WHERE icon_key = ? ORDER BY created_at DESC",
    iconKey,
  );
  return rows.map((r) => ({
    id: r.id,
    iconKey: r.icon_key,
    imageData: r.image_data,
    source: r.source,
    format: r.format,
    originalUrl: r.original_url ?? null,
    fallbackTier: r.fallback_tier,
    originalWidth: r.original_width ?? undefined,
    originalHeight: r.original_height ?? undefined,
  }));
}

// ---------------------------------------------------------------------------
// Universal Crawled URLs History (for deduplication across all icon searches)
// ---------------------------------------------------------------------------

export async function markUrlAsCrawled(url: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("INSERT OR IGNORE INTO crawled_urls (url) VALUES (?)", url);
}

export async function updateCrawledUrlAttempt(url: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE crawled_urls SET last_attempt = datetime('now') WHERE url = ?",
    url,
  );
}

export async function isUrlAlreadyCrawled(url: string): Promise<boolean> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ url: string }>(
    "SELECT url FROM crawled_urls WHERE url = ?",
    url,
  );
  return !!row;
}

export async function isUrlAlreadyCrawledBatch(
  urls: string[],
): Promise<Set<string>> {
  if (urls.length === 0) return new Set();
  const db = getDatabase();
  const placeholders = urls.map(() => "?").join(",");
  const rows = await db.getAllAsync<{ url: string }>(
    `SELECT url FROM crawled_urls WHERE url IN (${placeholders})`,
    ...urls,
  );
  return new Set(rows.map((r) => r.url));
}

export async function getCrawledUrlCount(): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM crawled_urls",
  );
  return row?.cnt ?? 0;
}

export interface CrawledUrlEntry {
  url: string;
  first_seen: string;
  last_attempt: string | null;
}

// Get old URLs for background crawler to revisit
export async function getOldCrawledUrls(
  limit: number = 10,
): Promise<CrawledUrlEntry[]> {
  const db = getDatabase();
  const rows = await db.getAllAsync<CrawledUrlEntry>(
    `SELECT url, first_seen, last_attempt 
     FROM crawled_urls 
     ORDER BY last_attempt ASC NULLS FIRST 
     LIMIT ?`,
    limit,
  );
  return rows;
}

export async function deleteCachedIcon(iconKey: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM icon_cache WHERE icon_key = ?", iconKey);
}

// ---------------------------------------------------------------------------
// Icon Crawl Queue
// ---------------------------------------------------------------------------

export interface QueuedIcon {
  icon_key: string;
  subscription_id: string | null;
  attempt_count: number;
  last_attempt_at: string | null;
}

export async function enqueueIconScrape(
  iconKey: string,
  subscriptionId?: string,
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "INSERT OR IGNORE INTO icon_crawl_queue (icon_key, subscription_id) VALUES (?, ?)",
    iconKey,
    subscriptionId ?? null,
  );
}

export async function getQueuedIcons(): Promise<QueuedIcon[]> {
  const db = getDatabase();
  return db.getAllAsync<QueuedIcon>(
    "SELECT icon_key, subscription_id, attempt_count, last_attempt_at FROM icon_crawl_queue ORDER BY created_at ASC",
  );
}

export async function dequeueIcon(iconKey: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync("DELETE FROM icon_crawl_queue WHERE icon_key = ?", iconKey);
}

export async function incrementQueueAttempt(iconKey: string): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "UPDATE icon_crawl_queue SET attempt_count = attempt_count + 1, last_attempt_at = datetime('now') WHERE icon_key = ?",
    iconKey,
  );
}

export async function getQueueAttemptCount(iconKey: string): Promise<number> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{ attempt_count: number }>(
    "SELECT attempt_count FROM icon_crawl_queue WHERE icon_key = ?",
    iconKey,
  );
  return row?.attempt_count ?? 0;
}

export async function clearProcessedIconQueues(): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "DELETE FROM icon_crawl_queue WHERE icon_key IN (SELECT icon_key FROM icon_cache)",
  );
}

// ---------------------------------------------------------------------------
// Backup / Export (unchanged)
// ---------------------------------------------------------------------------

export async function exportBackup(): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session for backup");
  const db = getDatabase();
  const dbPath = db.databasePath;
  await closeDatabase();
  try {
    const backupsDir = new Directory(Paths.cache, "backups");
    try {
      await backupsDir.create({ intermediates: true });
    } catch {}
    const tempFile = new File(backupsDir, `backup_${userId}_${Date.now()}.db`);
    const sourceUri = dbPath.startsWith("file://")
      ? dbPath
      : `file://${dbPath}`;
    const sourceFile = new File(sourceUri);
    await sourceFile.copy(tempFile);
    return tempFile.uri;
  } finally {
    await openDatabase(userId);
  }
}

/**
 * Cloud-sync payload: full encrypted DB copy with crawl/ephemeral tables emptied.
 * Keeps subscriptions, preferences, icon_cache (chosen icons).
 */
export async function exportSyncBackup(): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session for sync backup");
  const uri = await exportBackup();
  const passphrase = await getOrCreateDbKey(userId);
  const path = uri.startsWith("file://") ? uri.replace("file://", "") : uri;
  const stripDb = await openDatabaseAsync(path);
  try {
    await stripDb.execAsync(`PRAGMA key = '${passphrase}';`);
    for (const table of SYNC_LOCAL_ONLY_TABLES) {
      try {
        await stripDb.execAsync(`DELETE FROM ${table}`);
      } catch {
        /* table may not exist in very old backups */
      }
    }
    // Do not ship remote file ids from this device into another install's meta
    try {
      await stripDb.execAsync(
        `UPDATE sync_metadata SET remote_file_id = NULL, remote_file_hash = NULL, remote_file_modified = NULL WHERE id = 1`,
      );
    } catch {
      /* optional */
    }
    try {
      await stripDb.execAsync("VACUUM");
    } catch {
      /* VACUUM optional on some builds */
    }
  } finally {
    await stripDb.closeAsync();
  }
  return uri;
}

export interface ImportScanResult {
  totalRows: number;
  conflictingIds: string[];
  conflictingRows: Record<string, any>[];
}

export async function importBackup(
  sourceUri: string,
): Promise<ImportScanResult> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session for import");
  const passphrase = await getOrCreateDbKey(userId);
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {}
  const importTempPath = `${importsDir.uri}import_${Date.now()}.db`;
  const content = await readAsStringAsync(sourceUri, { encoding: "base64" });
  await writeAsStringAsync(importTempPath, content, { encoding: "base64" });
  const importDb = await openDatabaseAsync(importTempPath);
  try {
    await importDb.execAsync(`PRAGMA key = '${passphrase}';`);
    const testRow = await importDb.getFirstAsync<Record<string, any>>(
      "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='subscriptions'",
    );
    if (!testRow || testRow.cnt === 0) throw new Error("Invalid backup file.");
    const importedRows = await importDb.getAllAsync<Record<string, any>>(
      "SELECT * FROM subscriptions",
    );
    const db = getDatabase();
    const importedIds = importedRows.map((r) => r.id);
    const conflictingIds: string[] = [];
    if (importedIds.length > 0) {
      const placeholders = importedIds.map(() => "?").join(",");
      const existingRows = await db.getAllAsync<{ id: string }>(
        `SELECT id FROM subscriptions WHERE id IN (${placeholders})`,
        ...importedIds,
      );
      const existingIdSet = new Set(existingRows.map((r) => r.id));
      for (const row of importedRows) {
        if (existingIdSet.has(row.id)) conflictingIds.push(row.id);
      }
    }
    const conflictingRows = importedRows.filter((r) =>
      conflictingIds.includes(r.id),
    );
    return { totalRows: importedRows.length, conflictingIds, conflictingRows };
  } finally {
    await importDb.closeAsync();
    try {
      const tempFile = new File(importTempPath);
      await tempFile.delete();
    } catch {}
  }
}

export interface ImportConflictAction {
  id: string;
  action: "merge_skip" | "merge_overwrite" | "duplicate";
  newId?: string;
}

export async function executeImportActions(
  sourceUri: string,
  conflicts: ImportConflictAction[],
): Promise<{ merged: number; duplicated: number }> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session");
  const passphrase = await getOrCreateDbKey(userId);
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {}
  const importTempPath = `${importsDir.uri}import_exec_${Date.now()}.db`;
  const content = await readAsStringAsync(sourceUri, { encoding: "base64" });
  await writeAsStringAsync(importTempPath, content, { encoding: "base64" });
  const importDb = await openDatabaseAsync(importTempPath);
  const db = getDatabase();
  try {
    await importDb.execAsync(`PRAGMA key = '${passphrase}';`);
    let merged = 0,
      duplicated = 0;
    await db.withTransactionAsync(async () => {
      for (const conflict of conflicts) {
        if (conflict.action === "merge_skip") {
          merged++;
        } else if (conflict.action === "merge_overwrite") {
          const r = await importDb.getFirstAsync<Record<string, any>>(
            "SELECT * FROM subscriptions WHERE id = ?",
            conflict.id,
          );
          if (r) {
            await db.runAsync(
              `UPDATE subscriptions SET name=?,plan=?,category=?,payment_method=?,status=?,start_date=?,price=?,currency=?,billing=?,frequency=?,renewal_date=?,color=?,icon_key=?,updated_at=datetime('now') WHERE id=?`,
              r.name,
              r.plan,
              r.category,
              r.payment_method,
              r.status,
              r.start_date,
              r.price,
              r.currency,
              r.billing,
              r.frequency,
              r.renewal_date,
              r.color,
              r.icon_key,
              conflict.id,
            );
            merged++;
          }
        } else if (conflict.action === "duplicate" && conflict.newId) {
          const r = await importDb.getFirstAsync<Record<string, any>>(
            "SELECT * FROM subscriptions WHERE id = ?",
            conflict.id,
          );
          if (r) {
            await db.runAsync(
              `INSERT INTO subscriptions (id,name,plan,category,payment_method,status,start_date,price,currency,billing,frequency,renewal_date,color,icon_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
              conflict.newId,
              r.name,
              r.plan,
              r.category,
              r.payment_method,
              r.status,
              r.start_date,
              r.price,
              r.currency,
              r.billing,
              r.frequency,
              r.renewal_date,
              r.color,
              r.icon_key,
            );
            duplicated++;
          }
        }
      }
    });
    return { merged, duplicated };
  } finally {
    await importDb.closeAsync();
    try {
      const tempFile = new File(importTempPath);
      await tempFile.delete();
    } catch {}
  }
}

export async function executeNonConflictingImport(
  sourceUri: string,
  nonConflictingIds: string[],
): Promise<number> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session");
  const passphrase = await getOrCreateDbKey(userId);
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {}
  const importTempPath = `${importsDir.uri}import_nonconf_${Date.now()}.db`;
  const content = await readAsStringAsync(sourceUri, { encoding: "base64" });
  await writeAsStringAsync(importTempPath, content, { encoding: "base64" });
  const importDb = await openDatabaseAsync(importTempPath);
  const db = getDatabase();
  try {
    await importDb.execAsync(`PRAGMA key = '${passphrase}';`);
    const allRows = await importDb.getAllAsync<Record<string, any>>(
      "SELECT * FROM subscriptions",
    );
    const conflictSet = new Set(nonConflictingIds);
    let inserted = 0;
    await db.withTransactionAsync(async () => {
      for (const row of allRows) {
        if (!conflictSet.has(row.id)) {
          await db.runAsync(
            `INSERT OR IGNORE INTO subscriptions (id,name,plan,category,payment_method,status,start_date,price,currency,billing,frequency,renewal_date,color,icon_key) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
            row.id,
            row.name,
            row.plan,
            row.category,
            row.payment_method,
            row.status,
            row.start_date,
            row.price,
            row.currency,
            row.billing,
            row.frequency,
            row.renewal_date,
            row.color,
            row.icon_key,
          );
          inserted++;
        }
      }
    });
    return inserted;
  } finally {
    await importDb.closeAsync();
    try {
      const tempFile = new File(importTempPath);
      await tempFile.delete();
    } catch {}
  }
}

export async function deleteTempImportFile(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    await file.delete();
  } catch {}
}

// ---------------------------------------------------------------------------
// Cloud Sync Metadata (unchanged)
// ---------------------------------------------------------------------------

export interface SyncMetadata {
  syncEnabled: boolean;
  provider: string | null;
  providerUserId: string | null;
  remoteFileId: string | null;
  remoteFileHash: string | null;
  remoteFileModified: string | null;
  lastSyncTimestamp: string | null;
  serverUrl: string | null;
}

export async function getSyncMetadata(): Promise<SyncMetadata> {
  const db = getDatabase();
  const row = await db.getFirstAsync<Record<string, any>>(
    "SELECT * FROM sync_metadata WHERE id = 1",
  );
  if (!row)
    return {
      syncEnabled: false,
      provider: null,
      providerUserId: null,
      remoteFileId: null,
      remoteFileHash: null,
      remoteFileModified: null,
      lastSyncTimestamp: null,
      serverUrl: null,
    };
  return {
    syncEnabled: row.sync_enabled === 1,
    provider: row.provider ?? null,
    providerUserId: row.provider_user_id ?? null,
    remoteFileId: row.remote_file_id ?? null,
    remoteFileHash: row.remote_file_hash ?? null,
    remoteFileModified: row.remote_file_modified ?? null,
    lastSyncTimestamp: row.last_sync_timestamp ?? null,
    serverUrl: row.server_url ?? null,
  };
}

export async function updateSyncMetadata(
  updates: Record<string, any>,
): Promise<void> {
  const db = getDatabase();
  const current = await getSyncMetadata();
  const syncEnabled =
    "syncEnabled" in updates
      ? (updates.syncEnabled ?? false)
      : current.syncEnabled;
  const provider =
    "provider" in updates ? (updates.provider ?? null) : current.provider;
  const providerUserId =
    "providerUserId" in updates
      ? (updates.providerUserId ?? null)
      : current.providerUserId;
  const remoteFileId =
    "remoteFileId" in updates
      ? (updates.remoteFileId ?? null)
      : current.remoteFileId;
  const remoteFileHash =
    "remoteFileHash" in updates
      ? (updates.remoteFileHash ?? null)
      : current.remoteFileHash;
  const remoteFileModified =
    "remoteFileModified" in updates
      ? (updates.remoteFileModified ?? null)
      : current.remoteFileModified;
  const lastSyncTimestamp =
    "lastSyncTimestamp" in updates
      ? (updates.lastSyncTimestamp ?? null)
      : current.lastSyncTimestamp;
  const serverUrl =
    "serverUrl" in updates ? (updates.serverUrl ?? null) : current.serverUrl;
  await db.runAsync(
    `INSERT OR REPLACE INTO sync_metadata (id, sync_enabled, provider, provider_user_id, remote_file_id, remote_file_hash, remote_file_modified, last_sync_timestamp, server_url) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
    syncEnabled ? 1 : 0,
    provider,
    providerUserId,
    remoteFileId,
    remoteFileHash,
    remoteFileModified,
    lastSyncTimestamp,
    serverUrl,
  );
}

/** Full-file hash (closes DB briefly). Prefer computeUserDataHash for sync. */
export async function computeDatabaseHash(): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session");
  const db = getDatabase();
  const dbPath = db.databasePath;
  await closeDatabase();
  const sourceUri = dbPath.startsWith("file://") ? dbPath : `file://${dbPath}`;
  const base64Content = await readAsStringAsync(sourceUri, {
    encoding: "base64",
  });
  await openDatabase(userId);
  return Crypto.digestStringAsync(CryptoDigestAlgorithm.SHA256, base64Content);
}

async function hashUserTables(db: {
  getAllAsync: <T>(sql: string, ...params: any[]) => Promise<T[]>;
}): Promise<string> {
  const subscriptions = await db.getAllAsync(
    "SELECT * FROM subscriptions ORDER BY id",
  );
  const preferences = await db.getAllAsync(
    "SELECT * FROM preferences ORDER BY key",
  );
  // Fingerprint icons without dumping entire base64 into the hash string twice
  const icons = await db.getAllAsync(
    `SELECT icon_key, source, format, original_url, fallback_tier,
            original_width, original_height, updated_at,
            length(IFNULL(image_data,'')) AS image_len,
            substr(IFNULL(image_data,''), 1, 96) AS image_head
     FROM icon_cache ORDER BY icon_key`,
  );
  const payload = JSON.stringify({
    v: 1,
    subscriptions,
    preferences,
    icons,
  });
  return Crypto.digestStringAsync(CryptoDigestAlgorithm.SHA256, payload);
}

/**
 * Hash of user-facing data only (subscriptions, prefs, chosen icons).
 * Crawl activity does not change this hash — keeps sync honest and quiet.
 */
export async function computeUserDataHash(): Promise<string> {
  return hashUserTables(getDatabase());
}

/** Same hash from an encrypted backup file (for remote comparison). */
export async function computeUserDataHashFromBackup(
  sourceUri: string,
): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session");
  const passphrase = await getOrCreateDbKey(userId);
  const path = sourceUri.startsWith("file://")
    ? sourceUri.replace("file://", "")
    : sourceUri;
  const importDb = await openDatabaseAsync(path);
  try {
    await importDb.execAsync(`PRAGMA key = '${passphrase}';`);
    return await hashUserTables(importDb);
  } finally {
    await importDb.closeAsync();
  }
}

/**
 * Merge chosen icons from a backup/sync file into local icon_cache.
 * Does not touch crawl_results / crawled_urls.
 */
export async function mergeIconCacheFromBackup(
  sourceUri: string,
): Promise<number> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session");
  const passphrase = await getOrCreateDbKey(userId);
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {}
  const importTempPath = `${importsDir.uri}import_icons_${Date.now()}.db`;
  const content = await readAsStringAsync(sourceUri, { encoding: "base64" });
  await writeAsStringAsync(importTempPath, content, { encoding: "base64" });
  const importDb = await openDatabaseAsync(importTempPath);
  const db = getDatabase();
  let merged = 0;
  try {
    await importDb.execAsync(`PRAGMA key = '${passphrase}';`);
    let rows: Record<string, any>[] = [];
    try {
      rows = await importDb.getAllAsync<Record<string, any>>(
        "SELECT * FROM icon_cache",
      );
    } catch {
      return 0;
    }
    for (const row of rows) {
      if (!row.icon_key || !row.image_data) continue;
      const local = await db.getFirstAsync<{ updated_at: string | null }>(
        "SELECT updated_at FROM icon_cache WHERE icon_key = ?",
        row.icon_key,
      );
      const remoteUpdated = row.updated_at ?? "";
      const localUpdated = local?.updated_at ?? "";
      if (local && localUpdated >= remoteUpdated) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO icon_cache
          (icon_key, image_data, source, format, original_url, fallback_tier,
           original_width, original_height, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))`,
        row.icon_key,
        row.image_data,
        row.source ?? "local",
        row.format ?? "png",
        row.original_url ?? null,
        row.fallback_tier ?? 0,
        row.original_width ?? null,
        row.original_height ?? null,
        row.updated_at ?? null,
      );
      merged++;
    }
    if (merged > 0) {
      setTimeout(async () => {
        const { notifyCacheUpdate } =
          await import("../src/services/iconLoadingRegistry");
        notifyCacheUpdate();
      }, 0);
    }
    return merged;
  } finally {
    await importDb.closeAsync();
    try {
      await new File(importTempPath).delete();
    } catch {}
  }
}

export async function needsSync(): Promise<boolean> {
  const localHash = await computeUserDataHash();
  const metadata = await getSyncMetadata();
  if (!metadata.syncEnabled) return false;
  if (localHash === metadata.remoteFileHash) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Cache & Crawl Data management (Settings → Clear data for repeatable re-crawl)
// ---------------------------------------------------------------------------

export interface IconCacheStats {
  iconCache: number;
  crawlResults: number;
  crawlQueue: number;
  crawledUrls: number;
}

export async function getIconCacheStats(): Promise<IconCacheStats> {
  const db = getDatabase();
  const cacheRow = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM icon_cache",
  );
  const resultsRow = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM icon_crawl_results",
  );
  const queueRow = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM icon_crawl_queue",
  );
  const urlsRow = await db.getFirstAsync<{ cnt: number }>(
    "SELECT COUNT(*) as cnt FROM crawled_urls",
  );
  return {
    iconCache: cacheRow?.cnt ?? 0,
    crawlResults: resultsRow?.cnt ?? 0,
    crawlQueue: queueRow?.cnt ?? 0,
    crawledUrls: urlsRow?.cnt ?? 0,
  };
}

/**
 * Clears stored icon image data: the chosen icon cache, all crawl candidate
 * results, and the pending background fetch queue. The crawled_urls dedup
 * table is preserved, so previously crawled URLs may not be re-downloaded.
 */
export async function clearIconCache(): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await db.execAsync("DELETE FROM icon_cache");
    await db.execAsync("DELETE FROM icon_crawl_results");
    await db.execAsync("DELETE FROM icon_crawl_queue");
  });
  // Notify listeners so in-memory cache state is invalidated.
  setTimeout(async () => {
    const { notifyCacheUpdate } =
      await import("../src/services/iconLoadingRegistry");
    notifyCacheUpdate();
  }, 0);
}

/**
 * Clears spider/crawl history so deduplication and rate-limit cooldowns no
 * longer block re-spidering: the universal crawled_urls dedup table, the
 * persisted rate-limit cooldowns, and reported/rejected icon records.
 */
export async function clearCrawlHistory(): Promise<void> {
  const db = getDatabase();
  await db.withTransactionAsync(async () => {
    await db.execAsync("DELETE FROM crawled_urls");
    // icon_reports is created lazily; swallow errors if it doesn't exist yet.
    try {
      await db.execAsync("DELETE FROM icon_reports");
    } catch {
      /* table not yet created */
    }
  });
  // Reset persisted rate-limit cooldowns (SecureStore + in-memory).
  try {
    const { clearAllRateLimits } =
      await import("../src/services/rateLimitTracker");
    await clearAllRateLimits();
  } catch {
    /* rate-limit module unavailable */
  }
}
