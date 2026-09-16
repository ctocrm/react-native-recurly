/**
 * Phase O: encrypted cross-install backup envelope (pure logic, no imports).
 *
 * Format: a JSON file with
 *   magic "cadence-encrypted-backup", v: 1,
 *   kdf { salt b64, iterations, bits },       — PBKDF2-HMAC-SHA256 params
 *   wrappedKey b64,                            — AES-256-GCM(KDF(pass), utf8(dbKeyHex))
 *   db b64,                                    — the stripped SQLCipher database
 *
 * The wrap lives in services/auth/vault.ts (same primitives as the app-pass
 * vault). The envelope itself is inert bytes — pure module so jest can test
 * it without native or file-system mocks.
 */

export const ENCRYPTED_BACKUP_MAGIC = "cadence-encrypted-backup";
export const ENCRYPTED_BACKUP_VERSION = 1;

export type BackupKdfMeta = {
  salt: string;
  iterations: number;
  bits: number;
};

export type EncryptedBackupEnvelope = {
  magic: string;
  v: number;
  kdf: BackupKdfMeta;
  wrappedKey: string;
  db: string;
};

export type EnvelopeInput = {
  kdf: BackupKdfMeta;
  wrappedKey: string;
  db: string;
};

export function buildEncryptedBackupEnvelope(
  input: EnvelopeInput,
): string {
  const envelope: EncryptedBackupEnvelope = {
    magic: ENCRYPTED_BACKUP_MAGIC,
    v: ENCRYPTED_BACKUP_VERSION,
    kdf: input.kdf,
    wrappedKey: input.wrappedKey,
    db: input.db,
  };
  return JSON.stringify(envelope);
}

export function parseEncryptedBackupEnvelope(text: string): EncryptedBackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Not a Cadence encrypted backup (invalid JSON).");
  }
  const env = parsed as Partial<EncryptedBackupEnvelope> | null;
  if (!env || env.magic !== ENCRYPTED_BACKUP_MAGIC) {
    throw new Error("Not a Cadence encrypted backup.");
  }
  if (env.v !== ENCRYPTED_BACKUP_VERSION) {
    throw new Error("Unsupported backup version.");
  }
  if (
    !env.kdf ||
    typeof env.kdf.salt !== "string" ||
    typeof env.kdf.iterations !== "number" ||
    typeof env.kdf.bits !== "number" ||
    typeof env.wrappedKey !== "string" ||
    typeof env.db !== "string" ||
    env.db.length === 0
  ) {
    throw new Error("Backup file is incomplete or corrupted.");
  }
  return env as EncryptedBackupEnvelope;
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
