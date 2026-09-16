/**
 * Phase O: encrypted cross-install backup (the proven SQLCipher escape
 * hatch). R25-b proved raw-DB file backups are unrestorable across installs
 * — the DB key is a per-install random secret in SecureStore, which pm
 * clear/uninstall destroys.
 *
 * Design (streaming, OOM-safe): the stripped database is re-encrypted
 * NATIVELY under a passphrase-derived key via SQLCipher's sqlcipher_export,
 * with a 512-byte PLAINTEXT header (PRAGMA cipher_plaintext_header_size)
 * carrying the KDF parameters. Import reads only that small header, derives
 * the key, and PRAGMA-rekeys the database under the new install's key so the
 * existing two-phase import flow works unchanged. The DB payload never
 * enters the JS heap.
 */
import { Directory, File, Paths } from "expo-file-system";
import { openDatabaseAsync } from "expo-sqlite";

import { deriveBackupKey } from "../auth/vault";
import { getOrCreateDbKey } from "../db/connection";
import { exportSyncBackup } from "../database";
import {
  buildEncryptedBackupHeader,
  ENCRYPTED_BACKUP_HEADER_SIZE,
  parseEncryptedBackupHeader,
} from "./encryptedBackupEnvelope";

const IMPORT_MIN_LENGTH = 8;

function encoder(): TextEncoder {
  return new TextEncoder();
}

function decoder(): TextDecoder {
  return new TextDecoder();
}

function toPath(uri: string): string {
  return uri.startsWith("file://") ? uri.replace("file://", "") : uri;
}

/** Random 16-byte salt as base64 (native RNG via the vault module). */
async function randomSaltB64(): Promise<string> {
  const { NativeModules, Platform } = await import("react-native");
  const mod = NativeModules.CadenceVault as
    | { randomBytesB64(count: number): Promise<string> }
    | undefined;
  if (!mod || Platform.OS !== "android") {
    throw new Error("CadenceVault needs the native Vault module (Android).");
  }
  return mod.randomBytesB64(16);
}

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
  const localKey = await getOrCreateDbKey(userId);
  const saltB64 = await randomSaltB64();
  const keyHex = await deriveBackupKey(pass, saltB64, 600_000, 256);
  const exportsDir = new Directory(Paths.cache, "exports");
  try {
    await exportsDir.create({ intermediates: true });
  } catch {}
  const out = new File(exportsDir, `cadence_encrypted_${Date.now()}.cbak`);
  const db = await openDatabaseAsync(plainUri);
  try {
    await db.execAsync(`PRAGMA key = '${localKey}';`);
    await db.execAsync(
      `ATTACH DATABASE '${toPath(out.uri)}' AS exp KEY '${keyHex}';`,
    );
    // Reserve a plaintext header region on the exported database.
    await db.execAsync(
      `PRAGMA exp.cipher_plaintext_header_size = ${ENCRYPTED_BACKUP_HEADER_SIZE};`,
    );
    await db.execAsync(`SELECT sqlcipher_export('exp');`);
    await db.execAsync(`DETACH DATABASE exp;`);
  } finally {
    await db.closeAsync();
  }
  // Inject the self-describing plaintext header into the reserved region.
  const headerText = buildEncryptedBackupHeader({
    salt: saltB64,
    iterations: 600_000,
    bits: 256,
  });
  const handle = out.open();
  try {
    handle.offset = 0;
    handle.writeBytes(encoder().encode(headerText));
  } finally {
    handle.close();
  }
  try {
    await new File(plainUri).delete();
  } catch {}
  return out.uri;
}

/** Read ONLY the plaintext header of a backup file (small, OOM-safe). */
async function readBackupHeader(fileUri: string) {
  const f = new File(fileUri);
  const handle = f.open();
  try {
    handle.offset = 0;
    const bytes = handle.readBytes(ENCRYPTED_BACKUP_HEADER_SIZE);
    return parseEncryptedBackupHeader(decoder().decode(bytes));
  } finally {
    handle.close();
  }
}

/**
 * Re-encrypt a picked backup file under THIS install's key into a temporary
 * database, so the existing two-phase import flow (scan → conflict resolve →
 * execute) works on it unchanged. A wrong passphrase is detected by a
 * decryption failure before the rekey commits.
 */
export async function decryptEncryptedBackupToPlain(
  fileUri: string,
  pass: string,
  userId: string,
): Promise<string> {
  if (!userId) throw new Error("No active user session for import");
  const meta = await readBackupHeader(fileUri);
  const keyHex = await deriveBackupKey(
    pass,
    meta.salt,
    meta.iterations,
    meta.bits,
  );
  const localKey = await getOrCreateDbKey(userId);
  const importsDir = new Directory(Paths.cache, "imports");
  try {
    await importsDir.create({ intermediates: true });
  } catch {}
  const tmp = new File(importsDir, `import_plain_${Date.now()}.db`);
  new File(fileUri).copy(tmp);
  const db = await openDatabaseAsync(tmp.uri);
  try {
    // Order matters: the plaintext header size must be set before the key.
    await db.execAsync(
      `PRAGMA cipher_plaintext_header_size = ${ENCRYPTED_BACKUP_HEADER_SIZE};`,
    );
    await db.execAsync(`PRAGMA key = '${keyHex}';`);
    // Prove the key is right before rekeying (a wrong key only fails at
    // first read in this format).
    await db.getFirstAsync("SELECT count(*) AS cnt FROM sqlite_master");
    await db.execAsync(`PRAGMA rekey = '${localKey}';`);
  } catch (error) {
    await db.closeAsync();
    try {
      await tmp.delete();
    } catch {}
    const message =
      error instanceof Error &&
      /file is not a database|decryption|malformed/i.test(error.message)
        ? "Wrong passphrase or corrupted backup file."
        : error instanceof Error
          ? error.message
          : "Import failed.";
    throw new Error(message);
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
