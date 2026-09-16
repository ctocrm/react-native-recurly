/**
 * Phase O: encrypted cross-install backup (the proven SQLCipher escape
 * hatch). R25-b proved raw-DB file backups are unrestorable across installs
 * — the DB key is a per-install random secret in SecureStore, which pm
 * clear/uninstall destroys.
 *
 * Design (streaming, OOM-safe): the export file IS a SQLCipher database
 * whose passphrase is the user's export passphrase — SQLCipher derives the
 * file key natively (PBKDF2-HMAC-SHA512, 256k iterations, random per-file
 * salt) and `sqlcipher_export` does the re-encryption natively, so the
 * ~30MB payload never enters the JS heap. Import copies the file, proves
 * the passphrase with a probe read, and `PRAGMA rekey`s it under THIS
 * install's key so the existing two-phase import flow works unchanged.
 */
import { Directory, File, Paths } from "expo-file-system";
import { openDatabaseAsync } from "expo-sqlite";

import { getOrCreateDbKey } from "../db/connection";
import { getDatabase, SYNC_LOCAL_ONLY_TABLES } from "../database";
import { escapeSqlText } from "./encryptedBackupEnvelope";

const IMPORT_MIN_LENGTH = 8;

function toPath(uri: string): string {
  return uri.startsWith("file://") ? uri.replace("file://", "") : uri;
}

/**
 * Build the encrypted backup file and return its URI (share via the native
 * share sheet). Keeps subscriptions, preferences and chosen icons; strips
 * crawl/ephemeral tables from the export copy.
 *
 * IMPORTANT: this must never closeDatabase() the live app database. The DB
 * is shared with background workers (icon crawl heal, sync timers); the old
 * close-copy-reopen flow raced their statements and SIGSEGV'd the process
 * natively (sqlite3_column_name use-after-free, tombstone 2026-09-16).
 * Instead, the passphrase-keyed output file is ATTACHed to the live
 * connection and `sqlcipher_export('exp')` re-encrypts natively — the
 * ~30MB payload never enters the JS heap and the live connection stays up.
 */
export async function exportEncryptedBackup(
  userId: string,
  pass: string,
): Promise<string> {
  if (!userId) throw new Error("No active user session for backup");
  if (pass.length < IMPORT_MIN_LENGTH) {
    throw new Error("Passphrase must be at least 8 characters.");
  }
  const exportsDir = new Directory(Paths.cache, "exports");
  try {
    await exportsDir.create({ intermediates: true });
  } catch {}
  const out = new File(exportsDir, `cadence_encrypted_${Date.now()}.cbak`);
  const db = getDatabase();
  await db.execAsync(
    `ATTACH DATABASE '${toPath(out.uri)}' AS exp KEY '${escapeSqlText(pass)}';`,
  );
  try {
    await db.execAsync(`SELECT sqlcipher_export('exp');`);
    for (const table of SYNC_LOCAL_ONLY_TABLES) {
      try {
        await db.execAsync(`DELETE FROM exp.${table}`);
      } catch {
        /* table may not exist in very old schemas */
      }
    }
    // Do not ship remote file ids from this device into another install's meta
    try {
      await db.execAsync(
        `UPDATE exp.sync_metadata SET remote_file_id = NULL, remote_file_hash = NULL, remote_file_modified = NULL WHERE id = 1`,
      );
    } catch {
      /* optional */
    }
  } finally {
    await db.execAsync(`DETACH DATABASE exp;`);
  }
  return out.uri;
}

/**
 * Re-key a picked backup file under THIS install's key into a temporary
 * database, so the existing two-phase import flow (scan → conflict resolve
 * → execute) works on it unchanged. A wrong passphrase is detected by the
 * probe read before the rekey commits.
 */
export async function decryptEncryptedBackupToPlain(
  fileUri: string,
  pass: string,
  userId: string,
): Promise<string> {
  if (!userId) throw new Error("No active user session for import");
  const localKey = await getOrCreateDbKey(userId);
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {}
  const tmp = new File(importsDir, `import_plain_${Date.now()}.db`);
  new File(fileUri).copy(tmp);
  const db = await openDatabaseAsync(tmp.uri);
  try {
    await db.execAsync(`PRAGMA key = '${escapeSqlText(pass)}';`);
    // Prove the passphrase before rekeying (a wrong key only fails at
    // first read).
    await db.getFirstAsync("SELECT count(*) AS cnt FROM sqlite_master");
    await db.execAsync(`PRAGMA rekey = '${escapeSqlText(localKey)}';`);
  } catch (error) {
    await db.closeAsync();
    try {
      await tmp.delete();
    } catch {}
    const raw = error instanceof Error ? error.message : "";
    throw new Error(
      /file is not a database|decryption|malformed/i.test(raw)
        ? "Wrong passphrase or corrupted backup file."
        : raw || "Import failed.",
    );
  }
  await db.closeAsync();
  return tmp.uri;
}

/** Best-effort temp cleanup (called when the import flow finishes). */
export async function deleteImportTemp(uri: string | null): Promise<void> {
  if (!uri || !uri.includes("import_plain_")) return;
  try {
    await new File(uri).delete();
  } catch {}
}
