/**
 * Lightweight heuristics to reject empty / blank / fully-transparent
 * icons before they reach the picker UI or get auto-assigned to a card.
 *
 * Sync checks run at save time and again when the card / create preview
 * reads a cache row. PNG uses UPNG; JPEG/WebP/GIF/ICO use signatures +
 * a near-uniform sample so cream/white blanks cannot become defaults.
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
const MIN_DISTINCT_COLORS = 4;
const UNIFORM_LUMA_SPREAD = 8;

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

function sampleDistinctAndLuma(
  rgba: Uint8Array,
  w: number,
  h: number,
): { visibleRatio: number; distinct: number; lumaSpread: number } {
  const totalPixels = w * h;
  const step = Math.max(1, Math.floor(Math.sqrt(totalPixels) / 20));
  let sampled = 0;
  let visible = 0;
  const colors = new Set<number>();
  let minLuma = 255;
  let maxLuma = 0;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      const i = (y * w + x) * 4;
      const r = rgba[i];
      const g = rgba[i + 1];
      const b = rgba[i + 2];
      const a = rgba[i + 3];
      sampled++;
      if (a > VISIBLE_ALPHA_THRESHOLD) {
        visible++;
        colors.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
        const luma = (r * 299 + g * 587 + b * 114) / 1000;
        if (luma < minLuma) minLuma = luma;
        if (luma > maxLuma) maxLuma = luma;
      }
    }
  }
  return {
    visibleRatio: sampled === 0 ? 0 : visible / sampled,
    distinct: colors.size,
    lumaSpread: maxLuma - minLuma,
  };
}

/**
 * Sample PNG pixels. Returns false when nearly all pixels are transparent
 * or the visible area is a flat cream/white plate.
 */
function pngHasVisiblePixels(bytes: Uint8Array): boolean {
  try {
    if (bytes.length < 24 || bytes[0] !== 0x89) return true;
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
    const sample = sampleDistinctAndLuma(rgba, w, h);
    if (sample.visibleRatio < MIN_VISIBLE_ALPHA_RATIO) return false;
    if (
      sample.distinct < MIN_DISTINCT_COLORS &&
      sample.lumaSpread < UNIFORM_LUMA_SPREAD
    ) {
      return false;
    }
    return true;
  } catch {
    return true;
  }
}

function byteSpreadLooksBlank(bytes: Uint8Array, start: number, minLen: number): boolean {
  if (bytes.length < minLen) return true;
  const first = bytes[start];
  let different = 0;
  const step = Math.max(1, Math.floor(bytes.length / 200));
  for (let i = start; i < bytes.length; i += step) {
    if (Math.abs(bytes[i] - first) > 12) different++;
    if (different >= 8) return false;
  }
  return true;
}

function jpegHasContent(bytes: Uint8Array): boolean {
  if (bytes.length < 20 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return true;
  return !byteSpreadLooksBlank(bytes, 20, 800);
}

function webpHasContent(bytes: Uint8Array): boolean {
  if (bytes.length < 16) return false;
  const riff = String.fromCharCode(...bytes.subarray(0, 4));
  const webp = String.fromCharCode(...bytes.subarray(8, 12));
  if (riff !== "RIFF" || webp !== "WEBP") return true;
  return !byteSpreadLooksBlank(bytes, 16, 800);
}

function gifHasContent(bytes: Uint8Array): boolean {
  const head = String.fromCharCode(...bytes.subarray(0, 6));
  if (!head.startsWith("GIF")) return true;
  if (bytes.length < 400) return false;
  if (bytes.length >= 10) {
    const w = bytes[6] | (bytes[7] << 8);
    const h = bytes[8] | (bytes[9] << 8);
    if (w > 0 && h > 0 && (w < MIN_DIMENSION_PX || h < MIN_DIMENSION_PX)) {
      return false;
    }
  }
  return true;
}

function icoHasContent(bytes: Uint8Array): boolean {
  if (bytes.length < 6) return false;
  const isIco =
    bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && bytes[3] === 0;
  if (!isIco) return true;
  const count = bytes[4] | (bytes[5] << 8);
  if (count < 1) return false;
  if (bytes.length < 22) return false;
  const w = bytes[6] === 0 ? 256 : bytes[6];
  const h = bytes[7] === 0 ? 256 : bytes[7];
  if (w < MIN_DIMENSION_PX || h < MIN_DIMENSION_PX) return false;
  return bytes.length >= 200;
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
    // Tiny chrome (hamburger, chevron, user-circle) is a real <path> but not a
    // brand mark. RN Image also cannot paint SVG on the card, so auto-assign
    // must not promote these as the default.
    if (bytes.length < 1200) return false;
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
    return true;
  }

  const fmt = (format || "").toLowerCase();
  if (fmt === "jpg" || fmt === "jpeg") return jpegHasContent(bytes);
  if (fmt === "webp") return webpHasContent(bytes);
  if (fmt === "gif") return gifHasContent(bytes);
  if (fmt === "ico") return icoHasContent(bytes);

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
