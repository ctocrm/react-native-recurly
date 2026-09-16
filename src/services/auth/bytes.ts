/**
 * Base64 <-> UTF-8 for the vault (Phase A). Hermes has no Buffer/atob —
 * these are pure and directly unit-tested (incl. multibyte round-trips).
 */

const B64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function utf8ToB64(text: string): string {
  const bytes = Array.from(new TextEncoder().encode(text));
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b1 = bytes[i];
    const b2 = bytes[i + 1];
    const b3 = bytes[i + 2];
    out += B64_ALPHABET[b1 >> 2];
    out += B64_ALPHABET[((b1 & 3) << 4) | ((b2 ?? 0) >> 4)];
    out +=
      b2 === undefined
        ? "="
        : B64_ALPHABET[((b2 & 15) << 2) | ((b3 ?? 0) >> 6)];
    out += b3 === undefined ? "=" : B64_ALPHABET[b3 & 63];
  }
  return out;
}

export function b64ToUtf8(b64: string): string {
  const clean = b64.replace(/=+$/, "");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const c = [
      B64_ALPHABET.indexOf(clean[i]),
      B64_ALPHABET.indexOf(clean[i + 1] ?? "A"),
      B64_ALPHABET.indexOf(clean[i + 2] ?? "A"),
      B64_ALPHABET.indexOf(clean[i + 3] ?? "A"),
    ];
    bytes.push((c[0] << 2) | (c[1] >> 4));
    if (clean[i + 2] !== undefined && clean[i + 2] !== "=") {
      bytes.push(((c[1] & 15) << 4) | (c[2] >> 2));
    }
    if (clean[i + 3] !== undefined && clean[i + 3] !== "=") {
      bytes.push(((c[2] & 3) << 6) | c[3]);
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Base64 (of raw bytes) to lowercase hex — for native PBKDF2 output → SQLCipher keys. */
export function b64ToHex(b64: string): string {
  const clean = b64.replace(/=+$/, "");
  let out = "";
  for (let i = 0; i < clean.length; i += 4) {
    const c = [
      B64_ALPHABET.indexOf(clean[i]),
      B64_ALPHABET.indexOf(clean[i + 1] ?? "A"),
      B64_ALPHABET.indexOf(clean[i + 2] ?? "A"),
      B64_ALPHABET.indexOf(clean[i + 3] ?? "A"),
    ];
    const bytes = [(c[0] << 2) | (c[1] >> 4)];
    if (clean[i + 2] !== undefined && clean[i + 2] !== "=") {
      bytes.push(((c[1] & 15) << 4) | (c[2] >> 2));
    }
    if (clean[i + 3] !== undefined && clean[i + 3] !== "=") {
      bytes.push(((c[2] & 3) << 6) | c[3]);
    }
    for (const b of bytes) {
      out += b.toString(16).padStart(2, "0");
    }
  }
  return out;
}
