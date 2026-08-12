/**
 * Lightweight heuristics to reject empty / blank / fully-transparent
 * icons before they reach the picker UI or get auto-assigned to a card.
 *
 * Sync checks (byte size + PNG IHDR + PNG alpha sample) run at save time.
 * Async Image.getSize is a best-effort second pass when a data URI is handy.
 */

import { Image } from "react-native";
import UPNG from "upng-js";

// Below this many decoded bytes, an image is almost certainly blank/placeholder.
const MIN_DECODED_BYTES = 300;

// Below this many pixels on either axis, the icon is effectively empty.
const MIN_DIMENSION_PX = 8;

// At least this fraction of sampled pixels must have meaningful alpha.
const MIN_VISIBLE_ALPHA_RATIO = 0.01;

// Alpha above this counts as "visible" (not fully transparent).
const VISIBLE_ALPHA_THRESHOLD = 12;

/**
 * Read width/height from a PNG IHDR (bytes 16-24) synchronously.
 * Returns null if not a PNG or unreadable.
 */
function readPngDimensions(bytes: Uint8Array): { w: number; h: number } | null {
  try {
    if (bytes.length < 24) return null;
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

function decodeBase64ToBytes(base64: string): Uint8Array | null {
  try {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Sample PNG alpha channel. Returns false when nearly all pixels are transparent
 * (empty / blank icons that still have valid dimensions and non-trivial size).
 */
function pngHasVisiblePixels(bytes: Uint8Array): boolean {
  try {
    if (bytes.length < 24 || bytes[0] !== 0x89) return true; // not PNG → skip
    const decoded = UPNG.decode(
      bytes.buffer.slice(
        bytes.byteOffset,
        bytes.byteOffset + bytes.byteLength,
      ) as ArrayBuffer,
    );
    const w = decoded.width;
    const h = decoded.height;
    if (w < MIN_DIMENSION_PX || h < MIN_DIMENSION_PX) return false;

    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);
    const totalPixels = w * h;
    if (totalPixels <= 0) return false;

    // Sample a grid (up to ~400 points) for speed on large images.
    const step = Math.max(1, Math.floor(Math.sqrt(totalPixels) / 20));
    let sampled = 0;
    let visible = 0;
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const a = rgba[(y * w + x) * 4 + 3];
        sampled++;
        if (a > VISIBLE_ALPHA_THRESHOLD) visible++;
      }
    }
    if (sampled === 0) return false;
    const ratio = visible / sampled;
    return ratio >= MIN_VISIBLE_ALPHA_RATIO;
  } catch {
    // Decode failure: don't block — size/dimension checks already ran.
    return true;
  }
}

/**
 * Synchronous validity check using only the base64 + format.
 * Returns false for blank/placeholder/fully-transparent images.
 */
export function isBase64IconValid(base64: string, format: string): boolean {
  if (!base64 || typeof base64 !== "string") return false;

  // SVG payload is base64 of the SVG text — decode before tag checks.
  // Checking tags on the base64 string always fails (no "<path" in base64).
  if (format === "svg") {
    if (base64.length <= 64) return false;
    const bytes = decodeBase64ToBytes(base64);
    if (!bytes || bytes.length < 32) return false;
    let svgText = "";
    try {
      for (let i = 0; i < bytes.length; i++) {
        svgText += String.fromCharCode(bytes[i]);
      }
    } catch {
      return false;
    }
    const lower = svgText.toLowerCase();
    if (!lower.includes("<svg")) return false;
    // Reject SVGs with no drawing commands / only empty groups.
    if (
      !/<path|<rect|<circle|<polygon|<ellipse|<line|<polyline|<text|<image|<use/i.test(
        lower,
      )
    ) {
      return false;
    }
    return true;
  }

  const bytes = decodeBase64ToBytes(base64);
  if (!bytes) return false;

  // Byte-size heuristic (decoded length in bytes).
  if (bytes.length < MIN_DECODED_BYTES) return false;

  const isPng =
    format === "png" ||
    (bytes.length >= 4 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47);

  // PNG dimension check from IHDR.
  if (isPng) {
    const dims = readPngDimensions(bytes);
    if (dims && (dims.w < MIN_DIMENSION_PX || dims.h < MIN_DIMENSION_PX)) {
      return false;
    }
    // Reject fully / nearly fully transparent PNGs (empty icons).
    if (!pngHasVisiblePixels(bytes)) {
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
