/**
 * Lightweight, dependency-free heuristics to reject empty / blank / placeholder
 * icons before they ever reach the picker UI.
 *
 * Note: synchronous checks (byte size + PNG IHDR) run at save/collection time.
 * The async runtime dimension check (Image.getSize) is used as a best-effort
 * second pass when we already have a decoded data URI handy.
 */

import { Image } from "react-native";

// Below this many decoded bytes, an image is almost certainly blank/placeholder.
const MIN_DECODED_BYTES = 300;

// Below this many pixels on either axis, the icon is effectively empty.
const MIN_DIMENSION_PX = 8;

/**
 * Read width/height from a PNG IHDR (bytes 16-24) synchronously.
 * Returns null if not a PNG or unreadable.
 */
function readPngDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  try {
    if (bytes.length < 24) return null;
    // PNG signature already verified by caller.
    const w =
      (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const h =
      (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (w <= 0 || h <= 0 || w > 100000 || h > 100000) return null;
    return { w, h };
  } catch {
    return null;
  }
}

/**
 * Synchronous validity check using only the base64 + format.
 * Returns false for blank/placeholder images.
 */
export function isBase64IconValid(base64: string, format: string): boolean {
  // SVG: accept any non-trivial markup.
  if (format === "svg") {
    return base64.length > 64;
  }

  let binary: string;
  try {
    binary = atob(base64);
  } catch {
    // Not decodable base64 — treat as invalid.
    return false;
  }

  // Byte-size heuristic (decoded length in bytes).
  if (binary.length < MIN_DECODED_BYTES) return false;

  // PNG dimension check from IHDR.
  if (format === "png" || binary.startsWith("\x89PNG")) {
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const dims = readPngDimensions(bytes);
    if (dims && (dims.w < MIN_DIMENSION_PX || dims.h < MIN_DIMENSION_PX)) {
      return false;
    }
  }

  return true;
}

/**
 * Best-effort async check that uses React Native's Image.getSize to confirm
 * a real, non-degenerate image. Resolves true only when dimensions are valid.
 */
export function isValidIconDimensions(dataUri: string): Promise<boolean> {
  return new Promise((resolve) => {
    Image.getSize(
      dataUri,
      (width, height) => {
        resolve(
          width >= MIN_DIMENSION_PX &&
            height >= MIN_DIMENSION_PX &&
            width <= 100000 &&
            height <= 100000,
        );
      },
      () => resolve(true), // On error, don't block the image — sync checks ran.
    );
  });
}
