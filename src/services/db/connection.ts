/**
 * Encrypted SQLite connection lifecycle (per identity — the local session
 * uses LOCAL_USER_ID; a future backend id must never collide with it).
 */
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { type SQLiteDatabase, openDatabaseAsync } from "expo-sqlite";
import { applySchema } from "./schema";

function getSecureStoreKey(userId: string): string {
  return `db_key_${userId}`;
}

/**
 * `noCreate` (Phase A): return the stored key or null — never mint a new
 * one. The vault-locked open path uses this so a locked app cannot
 * silently replace the DB key of an existing encrypted database.
 */
export async function getOrCreateDbKey(
  userId: string,
  opts?: { noCreate?: boolean },
): Promise<string> {
  const existing = await SecureStore.getItemAsync(getSecureStoreKey(userId));
  if (existing) return existing;
  if (opts?.noCreate) return "";

  const randomBytes = Crypto.getRandomBytes(32);
  const passphrase = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  await SecureStore.setItemAsync(getSecureStoreKey(userId), passphrase, {
    requireAuthentication: false,
  });
  return passphrase;
}

let activeDb: SQLiteDatabase | null = null;
let activeUserId: string | null = null;

export async function openDatabase(
  userId: string,
  opts?: { passphrase?: string },
): Promise<SQLiteDatabase> {
  if (activeDb && activeUserId === userId) return activeDb;
  if (activeDb && activeUserId !== userId) await closeDatabase();

  const passphrase =
    opts?.passphrase ?? (await getOrCreateDbKey(userId, { noCreate: true }));
  if (!passphrase) {
    throw new Error(
      "Vault is locked — unlock the app pass (or recovery phrase) before opening the database.",
    );
  }
  const filename = `user_${userId}.db`;
  const db = await openDatabaseAsync(filename);
  // Passphrase is hex-only from getOrCreateDbKey — safe for PRAGMA string.
  await db.execAsync(`PRAGMA key = '${passphrase}';`);
  await applySchema(db);

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
  if (!activeDb)
    throw new Error("Database not opened. Call openDatabase(userId) first.");
  return activeDb;
}

export function getCurrentUserId(): string | null {
  return activeUserId;
}
