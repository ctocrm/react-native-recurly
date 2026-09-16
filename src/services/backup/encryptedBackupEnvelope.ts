/**
 * Phase O: encrypted cross-install backup header codec (pure, no imports).
 *
 * Format: a single file =
 *   [headerSize-byte plaintext JSON header (padded with '\n')]
 *   [SQLCipher database, key = PBKDF2-HMAC-SHA256(passphrase, salt), with
 *    `cipher_plaintext_header_size = headerSize` so the header stays plain]
 *
 * The database itself is written/read natively by SQLCipher (sqlcipher_export
 * / PRAGMA rekey) — the 30MB payload never enters the JS heap. This module
 * only builds/parses the small self-describing header.
 */

export const ENCRYPTED_BACKUP_MAGIC = "cadence-encrypted-backup";
export const ENCRYPTED_BACKUP_VERSION = 1;
export const ENCRYPTED_BACKUP_HEADER_SIZE = 512;

export type BackupKdfMeta = {
  salt: string; // base64
  iterations: number;
  bits: number;
};

export type EncryptedBackupHeader = BackupKdfMeta & {
  magic: string;
  v: number;
  headerSize: number;
};

export function buildEncryptedBackupHeader(
  meta: BackupKdfMeta,
): string {
  const header: EncryptedBackupHeader = {
    magic: ENCRYPTED_BACKUP_MAGIC,
    v: ENCRYPTED_BACKUP_VERSION,
    headerSize: ENCRYPTED_BACKUP_HEADER_SIZE,
    salt: meta.salt,
    iterations: meta.iterations,
    bits: meta.bits,
  };
  const json = JSON.stringify(header);
  if (json.length > ENCRYPTED_BACKUP_HEADER_SIZE) {
    throw new Error("Backup header overflow");
  }
  // Pad to exactly the header size (JSON.parse ignores trailing whitespace).
  return json.padEnd(ENCRYPTED_BACKUP_HEADER_SIZE, "\n");
}

export function parseEncryptedBackupHeader(
  firstBytes: string,
): BackupKdfMeta {
  const json = firstBytes.replace(/\n+$/, "").trim();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Not a Cadence encrypted backup.");
  }
  const header = parsed as Partial<EncryptedBackupHeader> | null;
  if (!header || header.magic !== ENCRYPTED_BACKUP_MAGIC) {
    throw new Error("Not a Cadence encrypted backup.");
  }
  if (header.v !== ENCRYPTED_BACKUP_VERSION) {
    throw new Error("Unsupported backup version.");
  }
  if (
    typeof header.salt !== "string" ||
    typeof header.iterations !== "number" ||
    typeof header.bits !== "number" ||
    typeof header.headerSize !== "number"
  ) {
    throw new Error("Backup header is incomplete or corrupted.");
  }
  return {
    salt: header.salt,
    iterations: header.iterations,
    bits: header.bits,
  };
}

/** The passphrase rules for a new export (pure; UI-agnostic). */
export function validateExportPassphrase(
  pass: string,
  confirm: string,
): string | null {
  if (pass.length < 8) return "Passphrase must be at least 8 characters.";
  if (pass !== confirm) return "Passphrases do not match.";
  return null;
}
