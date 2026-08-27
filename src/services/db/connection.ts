/**
 * Encrypted SQLite connection lifecycle (per Clerk user).
 */
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { type SQLiteDatabase, openDatabaseAsync } from "expo-sqlite";
import { applySchema } from "./schema";

function getSecureStoreKey(userId: string): string {
  return `db_key_${userId}`;
}

export async function getOrCreateDbKey(userId: string): Promise<string> {
  const existing = await SecureStore.getItemAsync(getSecureStoreKey(userId));
  if (existing) return existing;

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

export async function openDatabase(userId: string): Promise<SQLiteDatabase> {
  if (activeDb && activeUserId === userId) return activeDb;
  if (activeDb && activeUserId !== userId) await closeDatabase();

  const passphrase = await getOrCreateDbKey(userId);
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
