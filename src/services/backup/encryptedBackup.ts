/**
 * Phase O: encrypted cross-install backup (the proven SQLCipher escape
 * hatch). R25-b proved raw-DB file backups are unrestorable across installs
 * — the DB key is a per-install random secret in SecureStore, which pm
 * clear/uninstall destroys. This module ships the stripped database together
 * with its key wrapped under a USER passphrase (AES-256-GCM over
 * PBKDF2-HMAC-SHA256), so a fresh install can unwrap, re-key the database
 * under its own key, and reuse the existing import flow unchanged.
 */
import { Directory, File, Paths } from "expo-file-system";
import { readAsStringAsync, writeAsStringAsync } from "expo-file-system/legacy";
import { openDatabaseAsync } from "expo-sqlite";

import {
  unwrapSecretWithPassphrase,
  wrapSecretWithPassphrase,
} from "../auth/vault";
import { getOrCreateDbKey } from "../db/connection";
import { exportSyncBackup } from "../database";
import {
  buildEncryptedBackupEnvelope,
  parseEncryptedBackupEnvelope,
} from "./encryptedBackupEnvelope";

const IMPORT_MIN_LENGTH = 8;

/**
 * Build the encrypted backup file and return its URI (share via the native
 * share sheet). Uses the cloud-sync variant: crawl/ephemeral tables are
 * stripped; subscriptions, preferences and chosen icons survive.
 */
export async function exportEncryptedBackup(
  userId: string,
  pass: string,
): Promise<string> {
  if (!userId) throw new Error("No active user session for backup");
  if (pass.length < IMPORT_MIN_LENGTH) {
    throw new Error("Passphrase must be at least 8 characters.");
  }
  const plainUri = await exportSyncBackup();
  try {
    const dbB64 = await readAsStringAsync(plainUri, { encoding: "base64" });
    const keyHex = await getOrCreateDbKey(userId);
    const { kdf, wrappedKey } = await wrapSecretWithPassphrase(keyHex, pass);
    const envelope = buildEncryptedBackupEnvelope({ kdf, wrappedKey, db: dbB64 });
    const dir = new Directory(Paths.cache, "exports");
    try {
      await dir.create({ intermediates: true });
    } catch {}
    const out = new File(dir, `cadence_encrypted_${Date.now()}.json`);
    await writeAsStringAsync(out.uri, envelope, { encoding: "utf8" });
    return out.uri;
  } finally {
    try {
      const plainFile = new File(plainUri);
      await plainFile.delete();
    } catch {}
  }
}

/**
 * Decrypt an encrypted backup into a temporary plain (SQLCipher) database
 * RE-KEYED under THIS install's key, so the existing two-phase import flow
 * (scan → conflict resolve → execute) works on it unchanged. Returns the
 * temp URI; the caller deletes it when the flow finishes.
 */
export async function decryptEncryptedBackupToPlain(
  fileUri: string,
  pass: string,
  userId: string,
): Promise<string> {
  if (!userId) throw new Error("No active user session for import");
  const text = await readAsStringAsync(fileUri, { encoding: "utf8" });
  const env = parseEncryptedBackupEnvelope(text);
  let keyHex: string;
  try {
    keyHex = await unwrapSecretWithPassphrase(env.wrappedKey, env.kdf, pass);
  } catch {
    throw new Error("Wrong passphrase or corrupted backup file.");
  }
  const localKey = await getOrCreateDbKey(userId);
  const dir = new Directory(Paths.cache, "imports");
  try {
    await dir.create({ intermediates: true });
  } catch {}
  const plainFile = new File(dir, `import_plain_${Date.now()}.db`);
  await writeAsStringAsync(plainFile.uri, env.db, { encoding: "base64" });
  const db = await openDatabaseAsync(plainFile.uri);
  try {
    // Both keys are hex-only from getOrCreateDbKey — safe for PRAGMA strings.
    await db.execAsync(`PRAGMA key = '${keyHex}';`);
    await db.execAsync(`PRAGMA rekey = '${localKey}';`);
  } finally {
    await db.closeAsync();
  }
  return plainFile.uri;
}

/** Best-effort temp cleanup (called when the import flow finishes). */
export async function deleteImportTemp(uri: string | null): Promise<void> {
  if (!uri || !uri.includes("import_plain_")) return;
  try {
    const f = new File(uri);
    await f.delete();
  } catch {}
}
