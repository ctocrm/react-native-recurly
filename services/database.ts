import { icons } from "@/constants/icons";
import * as Crypto from "expo-crypto";
import { CryptoDigestAlgorithm } from "expo-crypto";
import { Directory, File, Paths } from "expo-file-system";
import { readAsStringAsync, writeAsStringAsync } from "expo-file-system/legacy";
import * as SecureStore from "expo-secure-store";
import { type SQLiteDatabase, openDatabaseAsync } from "expo-sqlite";

// ---------------------------------------------------------------------------
// Key Management
// ---------------------------------------------------------------------------

function getSecureStoreKey(userId: string): string {
  return `db_key_${userId}`;
}

async function getOrCreateDbKey(userId: string): Promise<string> {
  const existing = await SecureStore.getItemAsync(getSecureStoreKey(userId));
  if (existing) return existing;

  // Generate a 256-bit (32-byte) random hex string as the passphrase
  const randomBytes = Crypto.getRandomBytes(32);
  const passphrase = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await SecureStore.setItemAsync(getSecureStoreKey(userId), passphrase, {
    requireAuthentication: false,
  });
  return passphrase;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS subscriptions (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  plan          TEXT,
  category      TEXT,
  payment_method TEXT,
  status        TEXT DEFAULT 'active',
  start_date    TEXT,
  price         REAL NOT NULL,
  currency      TEXT DEFAULT 'USD',
  billing       TEXT NOT NULL,
  frequency     TEXT,
  renewal_date  TEXT,
  color         TEXT,
  icon_key      TEXT,
  created_at    TEXT DEFAULT (datetime('now')),
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS icon_cache (
  icon_key      TEXT PRIMARY KEY,
  image_data    TEXT,
  source        TEXT DEFAULT 'local',
  updated_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS preferences (
  key           TEXT PRIMARY KEY,
  value         TEXT NOT NULL
);

-- Seed default preferences if not present
INSERT OR IGNORE INTO preferences (key, value) VALUES ('notification_enabled', 'true');

-- Cloud sync metadata
CREATE TABLE IF NOT EXISTS sync_metadata (
  id                     INTEGER PRIMARY KEY CHECK (id = 1),
  sync_enabled           INTEGER DEFAULT 0,
  provider               TEXT,
  provider_user_id       TEXT,
  remote_file_id         TEXT,
  remote_file_hash       TEXT,
  remote_file_modified   TEXT,
  last_sync_timestamp    TEXT,
  server_url             TEXT
);
`;

// ---------------------------------------------------------------------------
// Database Lifecycle
// ---------------------------------------------------------------------------

let activeDb: SQLiteDatabase | null = null;
let activeUserId: string | null = null;

export async function openDatabase(userId: string): Promise<SQLiteDatabase> {
  // If same user already open, return cached handle
  if (activeDb && activeUserId === userId) {
    return activeDb;
  }

  // Close previous connection if different user
  if (activeDb && activeUserId !== userId) {
    await closeDatabase();
  }

  const passphrase = await getOrCreateDbKey(userId);
  const filename = `user_${userId}.db`;

  const db = await openDatabaseAsync(filename);

  // Unlock the encrypted database via SQLCipher
  await db.execAsync(`PRAGMA key = '${passphrase}';`);

  // Run schema migrations
  await db.execAsync(SCHEMA_SQL);

  activeDb = db;
  activeUserId = userId;

  return db;
}

export async function closeDatabase(): Promise<void> {
  if (activeDb) {
    await activeDb.closeAsync();
    activeDb = null;
    activeUserId = null;
  }
}

export function getDatabase(): SQLiteDatabase {
  if (!activeDb) {
    throw new Error("Database not opened. Call openDatabase(userId) first.");
  }
  return activeDb;
}

export function getCurrentUserId(): string | null {
  return activeUserId;
}

// ---------------------------------------------------------------------------
// Utility: get the file path for the user's DB
// ---------------------------------------------------------------------------

function getDbFile(userId: string): File {
  // expo-sqlite stores DBs in the default database directory
  // We need to find it. For backup, we get the path from the active DB.
  const db = activeDb;
  if (!db) throw new Error("Database not open");
  return new File(db.databasePath);
}

// ---------------------------------------------------------------------------
// CRUD: Subscriptions
// ---------------------------------------------------------------------------

export type DbSubscription = Omit<Subscription, "icon"> & {
  icon_key: string | null;
};

function rowToSubscription(row: Record<string, any>): Subscription {
  // Resolve icon: if icon_key exists in the icons map, use it; otherwise fall back to plus icon
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
  // Resolve icon key from the icons map
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

export async function getCachedIcon(
  iconKey: string,
): Promise<{ imageData: string; source: string } | null> {
  const db = getDatabase();
  const row = await db.getFirstAsync<{
    image_data: string;
    source: string;
  }>("SELECT image_data, source FROM icon_cache WHERE icon_key = ?", iconKey);
  return row ? { imageData: row.image_data, source: row.source } : null;
}

export async function setCachedIcon(
  iconKey: string,
  imageData: string,
  source: "local" | "url" | "base64" = "local",
): Promise<void> {
  const db = getDatabase();
  await db.runAsync(
    "INSERT OR REPLACE INTO icon_cache (icon_key, image_data, source, updated_at) VALUES (?, ?, ?, datetime('now'))",
    iconKey,
    imageData,
    source,
  );
}

// ---------------------------------------------------------------------------
// Backup / Export
// ---------------------------------------------------------------------------

export async function exportBackup(): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session for backup");

  const db = getDatabase();
  const dbPath = db.databasePath;

  // Close DB to ensure all WAL content is checkpointed
  await closeDatabase();

  try {
    const backupsDir = new Directory(Paths.cache, "backups");
    try {
      await backupsDir.create({ intermediates: true });
    } catch {
      // Directory already exists - that's fine
    }

    const tempFile = new File(backupsDir, `backup_${userId}_${Date.now()}.db`);

    // dbPath from SQLite is a raw filesystem path; prefix with file:// for expo-file-system File
    const sourceUri = dbPath.startsWith("file://")
      ? dbPath
      : `file://${dbPath}`;
    const sourceFile = new File(sourceUri);
    await sourceFile.copy(tempFile);

    return tempFile.uri;
  } finally {
    // Always re-open the DB after copy succeeds or fails
    await openDatabase(userId);
  }
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

  // Copy the imported file to a temp location
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {
    // Directory already exists - that's fine
  }

  const importTempPath = `${importsDir.uri}import_${Date.now()}.db`;

  // Use legacy FileSystem to handle content:// URIs from DocumentPicker
  const content = await readAsStringAsync(sourceUri, {
    encoding: "base64",
  });
  await writeAsStringAsync(importTempPath, content, {
    encoding: "base64",
  });

  // Open the imported database with the SAME passphrase
  const importDb = await openDatabaseAsync(importTempPath);
  try {
    await importDb.execAsync(`PRAGMA key = '${passphrase}';`);

    // Test if it's a valid encrypted DB by reading schema
    const testRow = await importDb.getFirstAsync<Record<string, any>>(
      "SELECT count(*) as cnt FROM sqlite_master WHERE type='table' AND name='subscriptions'",
    );

    if (!testRow || testRow.cnt === 0) {
      throw new Error(
        "Invalid backup file. The database does not contain expected tables.",
      );
    }

    // Read all subscriptions from the imported DB
    const importedRows = await importDb.getAllAsync<Record<string, any>>(
      "SELECT * FROM subscriptions",
    );

    // Check which IDs conflict with the active DB in a single query
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
        if (existingIdSet.has(row.id)) {
          conflictingIds.push(row.id);
        }
      }
    }

    const conflictingRows = importedRows.filter((r) =>
      conflictingIds.includes(r.id),
    );

    return {
      totalRows: importedRows.length,
      conflictingIds,
      conflictingRows,
    };
  } finally {
    await importDb.closeAsync();
    // Clean up temp file after reading
    try {
      const tempFile = new File(importTempPath);
      await tempFile.delete();
    } catch {
      // ignore cleanup errors
    }
  }
}

// ---------------------------------------------------------------------------
// Import Conflict Resolution – Batch Execution
// ---------------------------------------------------------------------------

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

  // Copy and open the imported DB again
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {
    // Directory already exists - that's fine
  }

  const importTempPath = `${importsDir.uri}import_exec_${Date.now()}.db`;

  // Use legacy FileSystem to handle content:// URIs from DocumentPicker
  const content = await readAsStringAsync(sourceUri, {
    encoding: "base64",
  });
  await writeAsStringAsync(importTempPath, content, {
    encoding: "base64",
  });

  const importDb = await openDatabaseAsync(importTempPath);
  const db = getDatabase();

  try {
    await importDb.execAsync(`PRAGMA key = '${passphrase}';`);

    let merged = 0;
    let duplicated = 0;

    await db.withTransactionAsync(async () => {
      for (const conflict of conflicts) {
        if (conflict.action === "merge_skip") {
          merged++;
        } else if (conflict.action === "merge_overwrite") {
          const importedRow = await importDb.getFirstAsync<Record<string, any>>(
            "SELECT * FROM subscriptions WHERE id = ?",
            conflict.id,
          );
          if (importedRow) {
            await db.runAsync(
              `UPDATE subscriptions SET
                 name = ?, plan = ?, category = ?, payment_method = ?,
                 status = ?, start_date = ?, price = ?, currency = ?,
                 billing = ?, frequency = ?, renewal_date = ?, color = ?,
                 icon_key = ?, updated_at = datetime('now')
               WHERE id = ?`,
              importedRow.name,
              importedRow.plan,
              importedRow.category,
              importedRow.payment_method,
              importedRow.status,
              importedRow.start_date,
              importedRow.price,
              importedRow.currency,
              importedRow.billing,
              importedRow.frequency,
              importedRow.renewal_date,
              importedRow.color,
              importedRow.icon_key,
              conflict.id,
            );
            merged++;
          }
        } else if (conflict.action === "duplicate") {
          const importedRow = await importDb.getFirstAsync<Record<string, any>>(
            "SELECT * FROM subscriptions WHERE id = ?",
            conflict.id,
          );
          if (importedRow && conflict.newId) {
            await db.runAsync(
              `INSERT INTO subscriptions (id, name, plan, category, payment_method, status, start_date, price, currency, billing, frequency, renewal_date, color, icon_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              conflict.newId,
              importedRow.name,
              importedRow.plan,
              importedRow.category,
              importedRow.payment_method,
              importedRow.status,
              importedRow.start_date,
              importedRow.price,
              importedRow.currency,
              importedRow.billing,
              importedRow.frequency,
              importedRow.renewal_date,
              importedRow.color,
              importedRow.icon_key,
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
    } catch {
      // ignore
    }
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
  } catch {
    // Directory already exists - that's fine
  }

  const importTempPath = `${importsDir.uri}import_nonconf_${Date.now()}.db`;

  // Use legacy FileSystem to handle content:// URIs from DocumentPicker
  const content = await readAsStringAsync(sourceUri, {
    encoding: "base64",
  });
  await writeAsStringAsync(importTempPath, content, {
    encoding: "base64",
  });

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
            `INSERT OR IGNORE INTO subscriptions (id, name, plan, category, payment_method, status, start_date, price, currency, billing, frequency, renewal_date, color, icon_key)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    } catch {
      // ignore
    }
  }
}

export async function deleteTempImportFile(uri: string): Promise<void> {
  try {
    const file = new File(uri);
    await file.delete();
  } catch {
    // ignore
  }
}

// ---------------------------------------------------------------------------
// Cloud Sync Metadata
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
  const row = await db.getFirstAsync<{
    sync_enabled: number;
    provider: string;
    provider_user_id: string;
    remote_file_id: string;
    remote_file_hash: string;
    remote_file_modified: string;
    last_sync_timestamp: string;
    server_url: string;
  }>("SELECT * FROM sync_metadata WHERE id = 1");

  if (!row) {
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
  }

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

export async function updateSyncMetadata(updates: {
  syncEnabled?: boolean;
  provider?: string | null;
  providerUserId?: string | null;
  remoteFileId?: string | null;
  remoteFileHash?: string | null;
  remoteFileModified?: string | null;
  lastSyncTimestamp?: string | null;
  serverUrl?: string | null;
}): Promise<void> {
  const db = getDatabase();

  const current = await getSyncMetadata();

  // Use "key in updates" to distinguish "not provided" from "explicitly set to null/undefined"
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
    `INSERT OR REPLACE INTO sync_metadata (id, sync_enabled, provider, provider_user_id, remote_file_id, remote_file_hash, remote_file_modified, last_sync_timestamp, server_url)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

export async function computeDatabaseHash(): Promise<string> {
  const userId = getCurrentUserId();
  if (!userId) throw new Error("No active user session");

  const db = getDatabase();
  const dbPath = db.databasePath;

  // Close and reopen DB to checkpoint WAL changes
  await closeDatabase();

  // dbPath from SQLite is a raw filesystem path; prefix with file:// for expo-file-system
  const sourceUri = dbPath.startsWith("file://") ? dbPath : `file://${dbPath}`;
  const base64Content = await readAsStringAsync(sourceUri, {
    encoding: "base64",
  });

  // Reopen the DB
  await openDatabase(userId);

  // Compute SHA256 hash of the base64-encoded bytes
  const hash = await Crypto.digestStringAsync(
    CryptoDigestAlgorithm.SHA256,
    base64Content,
  );

  return hash;
}

export async function needsSync(): Promise<boolean> {
  const localHash = await computeDatabaseHash();
  const metadata = await getSyncMetadata();

  // If sync is not enabled, no need to sync
  if (!metadata.syncEnabled) {
    return false;
  }

  // If hashes match, nothing changed
  if (localHash === metadata.remoteFileHash) {
    return false;
  }

  return true;
}
