/**
 * Phase O: encrypted cross-install backup — pure helpers.
 *
 * Format: a bare SQLCipher database whose passphrase IS the user's export
 * passphrase. SQLCipher derives the file key itself (PBKDF2-HMAC-SHA512,
 * 256k iterations, random per-file salt) — no key material is stored or
 * wrapped by the app, and the 30MB payload never enters the JS heap (the
 * re-encryption runs natively via sqlcipher_export / PRAGMA rekey).
 */

/** The passphrase rules for a new export (pure; UI-agnostic). */
export function validateExportPassphrase(
  pass: string,
  confirm: string,
): string | null {
  if (pass.length < 8) return "Passphrase must be at least 8 characters.";
  if (pass !== confirm) return "Passphrases do not match.";
  return null;
}

/**
 * Escape a passphrase for use inside a single-quoted SQL literal (PRAGMA
 * key / ATTACH ... KEY). SQL doubles embedded single quotes.
 */
export function escapeSqlText(text: string): string {
  return text.replace(/'/g, "''");
}
