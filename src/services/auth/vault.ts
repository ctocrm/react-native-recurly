/**
 * Phase A key vault — the app-pass leg and recovery phrase.
 *
 * Custody model (user-approved 2026-09-15):
 * - The SQLCipher passphrase stays a random 256-bit secret. The app-pass
 *   never IS the key; it WRAPS it.
 * - `plain` mode: passphrase lives in SecureStore under db_key_<user>
 *   (Keystore-wrapped) — the pre-Phase-A layout; the gate is the OS
 *   device-credential challenge (biometry if enrolled, else the phone's
 *   own PIN/pattern/password — never forced).
 * - `pass` mode: the plaintext key is DELETED from SecureStore. Two
 *   AES-256-GCM blobs hold wrapped copies: one keyed by KDF(appPass),
 *   one keyed by KDF(recoveryPhrase). GCM's auth tag is the wrong-key
 *   detector; wrong pass and wrong phrase are the same native failure.
 * - `none` mode: fresh install — no DB key exists yet.
 *
 * The recovery phrase is shown ONCE at enrollment (FLAG_SECURE screen)
 * and never persisted, logged, or re-displayed. Regenerate re-wraps the
 * recovery blob and invalidates the old phrase.
 */
import { NativeModules, Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

import { getOrCreateDbKey } from "../db/connection";
import { b64ToUtf8, utf8ToB64 } from "./bytes";
import {
  generateRecoveryPhrase,
  validateRecoveryPhrase,
} from "./bip39";

// ---------------------------------------------------------------------------
// Native bridge
// ---------------------------------------------------------------------------

type NativeVault = {
  pbkdf2Sha256(
    password: string,
    saltB64: string,
    iterations: number,
    keyLenBits: number,
  ): Promise<string>;
  aesGcmEncrypt(keyB64: string, plaintextB64: string): Promise<string>;
  aesGcmDecrypt(keyB64: string, blobB64: string): Promise<string>;
  randomBytesB64(count: number): Promise<string>;
  isDeviceSecure(): Promise<boolean>;
  confirmDeviceCredential(
    title: string,
    description: string,
  ): Promise<boolean>;
  setSecureWindow(flag: boolean): void;
};

function native(): NativeVault {
  const mod = NativeModules.CadenceVault as NativeVault | undefined;
  if (!mod || Platform.OS !== "android") {
    throw new Error("CadenceVault needs the native Vault module (Android).");
  }
  return mod;
}

// ---------------------------------------------------------------------------
// SecureStore keys + kdf params
// ---------------------------------------------------------------------------

const KEY_WRAPPED = "cadence_vault_wrapped";
const KEY_META = "cadence_vault_meta";
const KEY_RECOVERY_WRAPPED = "cadence_recovery_wrapped";
const KEY_RECOVERY_META = "cadence_recovery_meta";

const PASS_ITERATIONS = 600_000;
const PHRASE_ITERATIONS = 200_000;
const KEY_BITS = 256;
const FORMAT_VERSION = 1;

type KdfMeta = { salt: string; iterations: number; version: number };

async function getMeta(key: string): Promise<KdfMeta | null> {
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as KdfMeta;
    if (parsed?.salt && parsed?.iterations) return parsed;
  } catch {}
  return null;
}

async function setMeta(key: string, meta: KdfMeta): Promise<void> {
  await SecureStore.setItemAsync(key, JSON.stringify(meta));
}

async function deriveKey(password: string, meta: KdfMeta): Promise<string> {
  return native().pbkdf2Sha256(
    password,
    meta.salt,
    meta.iterations,
    KEY_BITS,
  );
}

async function newSalt(): Promise<string> {
  return native().randomBytesB64(16);
}

// ---------------------------------------------------------------------------
// Mode detection
// ---------------------------------------------------------------------------

export type VaultMode = "none" | "plain" | "pass";

export async function getVaultMode(userId: string): Promise<VaultMode> {
  const wrapped = await SecureStore.getItemAsync(KEY_WRAPPED);
  if (wrapped) return "pass";
  const raw = await SecureStore.getItemAsync(`db_key_${userId}`);
  return raw ? "plain" : "none";
}

export async function isDeviceSecure(): Promise<boolean> {
  return native().isDeviceSecure();
}

// ---------------------------------------------------------------------------
// Enrollment (create app pass + recovery phrase)
// ---------------------------------------------------------------------------

/**
 * Wrap the DB passphrase under the new app pass and the new recovery
 * phrase, then delete the plaintext. Works for BOTH fresh installs (no
 * key yet — mints one via getOrCreateDbKey) and migration (plaintext key
 * exists — wraps it). Returns the phrase for the one-time FLAG_SECURE
 * display; the passphrase never leaves this function.
 */
export async function enrollAppPass(
  userId: string,
  pass: string,
): Promise<string[]> {
  const mod = native();
  // Creates-or-returns the plaintext key (hex, owned by connection.ts).
  const secret = await getOrCreateDbKey(userId);
  const secretB64 = utf8ToB64(secret);

  // Recovery-phrase wrap FIRST: a crash mid-enrollment must leave `plain`
  // (recoverable), never `pass`-mode without a recovery blob. The pass
  // blob is the mode switch and is therefore written LAST.
  const phrase = await generateRecoveryPhrase();
  const phraseMeta: KdfMeta = {
    salt: await newSalt(),
    iterations: PHRASE_ITERATIONS,
    version: FORMAT_VERSION,
  };
  const phraseKey = await deriveKey(phrase.join(" "), phraseMeta);
  const recoveryBlob = await mod.aesGcmEncrypt(phraseKey, secretB64);
  await setMeta(KEY_RECOVERY_META, phraseMeta);
  await SecureStore.setItemAsync(KEY_RECOVERY_WRAPPED, recoveryBlob);

  // App-pass wrap (the atomic switch).
  const passMeta: KdfMeta = {
    salt: await newSalt(),
    iterations: PASS_ITERATIONS,
    version: FORMAT_VERSION,
  };
  const passKey = await deriveKey(pass, passMeta);
  const passBlob = await mod.aesGcmEncrypt(passKey, secretB64);
  await setMeta(KEY_META, passMeta);
  await SecureStore.setItemAsync(KEY_WRAPPED, passBlob);

  // Custody switch: the plaintext must not survive enrollment.
  await SecureStore.deleteItemAsync(`db_key_${userId}`);
  return phrase;
}

// ---------------------------------------------------------------------------
// Unlock paths
// ---------------------------------------------------------------------------

async function unwrap(
  password: string,
  wrappedKey: string,
  metaKey: string,
): Promise<string> {
  const meta = await getMeta(metaKey);
  if (!meta) throw new Error("vault: missing kdf meta");
  const key = await deriveKey(password, meta);
  const blob = await SecureStore.getItemAsync(wrappedKey);
  if (!blob) throw new Error("vault: missing wrapped blob");
  const secretB64 = await native().aesGcmDecrypt(key, blob);
  return b64ToUtf8(secretB64);
}

/** Returns the SQLCipher passphrase. Throws "WRONG_PASS" on a bad pass. */
export async function unlockWithPass(pass: string): Promise<string> {
  try {
    return await unwrap(pass, KEY_WRAPPED, KEY_META);
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "WRONG_KEY") throw new Error("WRONG_PASS");
    throw error;
  }
}

/** Returns the SQLCipher passphrase. Throws "WRONG_PHRASE" on a bad phrase. */
export async function unlockWithPhrase(words: string[]): Promise<string> {
  const valid = await validateRecoveryPhrase(words);
  if (!valid) throw new Error("WRONG_PHRASE");
  try {
    return await unwrap(
      words.join(" "),
      KEY_RECOVERY_WRAPPED,
      KEY_RECOVERY_META,
    );
  } catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "WRONG_KEY") throw new Error("WRONG_PHRASE");
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Maintenance: change pass, regenerate phrase, disable
// ---------------------------------------------------------------------------

/**
 * Re-wrap the pass blob under a new pass. The recovery blob STAYS AS-IS —
 * re-wrapping it would need the phrase, which is never stored by design.
 */
export async function changeAppPass(
  oldPass: string,
  nextPass: string,
): Promise<void> {
  const passphrase = await unlockWithPass(oldPass);
  const mod = native();
  const secretB64 = utf8ToB64(passphrase);

  const passMeta: KdfMeta = {
    salt: await newSalt(),
    iterations: PASS_ITERATIONS,
    version: FORMAT_VERSION,
  };
  const passKey = await deriveKey(nextPass, passMeta);
  const passBlob = await mod.aesGcmEncrypt(passKey, secretB64);

  await setMeta(KEY_META, passMeta);
  await SecureStore.setItemAsync(KEY_WRAPPED, passBlob);
}

/** New phrase, old phrase invalidated. Requires the current pass. */
export async function regenerateRecoveryPhrase(
  pass: string,
): Promise<string[]> {
  const passphrase = await unlockWithPass(pass);
  const mod = native();
  const secretB64 = utf8ToB64(passphrase);
  const phrase = await generateRecoveryPhrase();
  const phraseMeta: KdfMeta = {
    salt: await newSalt(),
    iterations: PHRASE_ITERATIONS,
    version: FORMAT_VERSION,
  };
  const phraseKey = await deriveKey(phrase.join(" "), phraseMeta);
  const blob = await mod.aesGcmEncrypt(phraseKey, secretB64);
  await setMeta(KEY_RECOVERY_META, phraseMeta);
  await SecureStore.setItemAsync(KEY_RECOVERY_WRAPPED, blob);
  return phrase;
}

/**
 * Recovery-path variant: the passphrase is already in hand (unwrapped via
 * the phrase), so this re-wraps ONLY the pass blob under the new pass.
 * The recovery blob stays as-is — the phrase just used remains valid
 * until explicitly regenerated in Settings.
 */
export async function setAppPassFromKey(
  passphrase: string,
  nextPass: string,
): Promise<void> {
  const mod = native();
  const secretB64 = utf8ToB64(passphrase);

  const passMeta: KdfMeta = {
    salt: await newSalt(),
    iterations: PASS_ITERATIONS,
    version: FORMAT_VERSION,
  };
  const passKey = await deriveKey(nextPass, passMeta);
  const passBlob = await mod.aesGcmEncrypt(passKey, secretB64);

  await setMeta(KEY_META, passMeta);
  await SecureStore.setItemAsync(KEY_WRAPPED, passBlob);
}

/** Back to `plain` mode (device-credential gate). Requires the pass. */
export async function disableAppPass(
  userId: string,
  pass: string,
): Promise<void> {
  const passphrase = await unlockWithPass(pass);
  await SecureStore.setItemAsync(`db_key_${userId}`, passphrase);
  await SecureStore.deleteItemAsync(KEY_WRAPPED);
  await SecureStore.deleteItemAsync(KEY_META);
  await SecureStore.deleteItemAsync(KEY_RECOVERY_WRAPPED);
  await SecureStore.deleteItemAsync(KEY_RECOVERY_META);
}

// ---------------------------------------------------------------------------
// Device credential challenge + secure window passthroughs
// ---------------------------------------------------------------------------

export function confirmDeviceCredential(
  title: string,
  description: string,
): Promise<boolean> {
  return native().confirmDeviceCredential(title, description);
}

export function setSecureWindow(flag: boolean): void {
  native().setSecureWindow(flag);
}

export { generateRecoveryPhrase, validateRecoveryPhrase };

// ---------------------------------------------------------------------------
// Passphrase-wrapped secrets (Phase O: encrypted cross-install backup)
// ---------------------------------------------------------------------------

export type BackupKdfMeta = { salt: string; iterations: number; bits: number };

/**
 * Wrap an arbitrary secret string (the hex DB key for backups) under a
 * user-chosen passphrase: AES-256-GCM(KDF(pass), utf8(secret)). Same
 * primitives and parameters as the app-pass vault leg.
 */
export async function wrapSecretWithPassphrase(
  secret: string,
  pass: string,
): Promise<{ kdf: BackupKdfMeta; wrappedKey: string }> {
  if (!pass) throw new Error("Passphrase required");
  const meta: KdfMeta = {
    salt: await newSalt(),
    iterations: PASS_ITERATIONS,
    version: FORMAT_VERSION,
  };
  const key = await deriveKey(pass, meta);
  const wrappedKey = await native().aesGcmEncrypt(key, utf8ToB64(secret));
  return {
    kdf: { salt: meta.salt, iterations: meta.iterations, bits: KEY_BITS },
    wrappedKey,
  };
}

/**
 * Unwrap a secret wrapped by wrapSecretWithPassphrase. GCM's auth tag is the
 * wrong-passphrase detector — a wrong pass throws like a corrupted blob.
 */
export async function unwrapSecretWithPassphrase(
  wrappedKey: string,
  kdf: BackupKdfMeta,
  pass: string,
): Promise<string> {
  if (!pass) throw new Error("Passphrase required");
  const key = await deriveKey(pass, {
    salt: kdf.salt,
    iterations: kdf.iterations,
    version: FORMAT_VERSION,
  });
  return b64ToUtf8(await native().aesGcmDecrypt(key, wrappedKey));
}




