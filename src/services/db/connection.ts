/**
 *  clerk user should be removed
 * Encrypted SQLite connection lifecycle (per identity — the local session
 * uses LOCAL_USER_ID; a future backend id must never collide with it).
 */
import * as Crypto from "expo-crypto";
import { File, Paths } from "expo-file-system";
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

  let passphrase =
    opts?.passphrase ?? (await getOrCreateDbKey(userId, { noCreate: true }));
  if (!passphrase) {
    // Phase O fresh-install fix: on a lock-screen device the gate routes a
    // brand-new install through device-prompt BEFORE any key exists. The OS
    // has just verified the user and there is NO existing encrypted
    // database file for this identity — mint the first key (same as the
    // pre-gate first run). If the file DOES exist, keep the locked error:
    // never silently replace the key of an encrypted database.
    if (new File(Paths.document, `SQLite/user_${userId}.db`).exists) {
      throw new Error(
        "Vault is locked — unlock the app pass (or recovery phrase) before opening the database.",
      );
    }
    passphrase = await getOrCreateDbKey(userId);
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
