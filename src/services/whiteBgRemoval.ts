/**
 * White-background detection and removal for icons.
 *
 * Uses expo-image-manipulator to normalise the image to PNG, then upng-js to
 * decode/encode the raw pixel data — no WebView needed, no postMessage limits.
 */

import {
  cacheDirectory,
  deleteAsync,
  EncodingType,
  readAsStringAsync,
} from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import UPNG from "upng-js";

/**
 * Detect whether an icon has a white/off-white background by sampling a grid
 * of points. Returns true if >= 50% of sampled pixels are white-like.
 */
export async function detectWhiteBg(
  base64: string,
  format: string,
  tolerance = 60,
): Promise<boolean> {
  if (format === "svg") return false;

  const tmpUri = `${cacheDirectory}white_detect_${Date.now()}.png`;
  try {
    const mime = format === "svg" ? "image/svg+xml" : `image/${format}`;
    const srcUri = `data:${mime};base64,${base64}`;

    // Normalise to PNG so upng-js can decode it.
    const result = await manipulateAsync(
      srcUri,
      [{ resize: { width: 128 } }], // keep it small for speed
      { compress: 1, format: SaveFormat.PNG },
    );

    const pngB64 = await readAsStringAsync(result.uri, {
      encoding: EncodingType.Base64,
    });

    const binary = atob(pngB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const decoded = UPNG.decode(bytes.buffer);
    const w = decoded.width;
    const h = decoded.height;
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);

    // Sample a grid of points.
    const stepX = Math.max(1, Math.floor(w / 5));
    const stepY = Math.max(1, Math.floor(h / 5));
    const pts: [number, number][] = [];
    for (let y = 0; y < h; y += stepY) {
      for (let x = 0; x < w; x += stepX) {
        pts.push([x, y]);
      }
    }
    pts.push([0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]);

    let whiteLike = 0;
    for (const [x, y] of pts) {
      const idx = (y * w + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const maxCh = Math.max(r, g, b);
      const minCh = Math.min(r, g, b);
      const spread = maxCh - minCh;
      const allBright = r > 200 && g > 200 && b > 200;
      const lowSaturation = spread < tolerance;
      if (allBright && lowSaturation) whiteLike++;
    }

    return whiteLike / pts.length >= 0.5;
  } catch (err) {
    console.warn("[WHITE_BG] detect failed:", err);
    return false;
  } finally {
    await deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
  }
}

/**
 * Remove white/off-white background from an icon by setting white-like pixels
 * to transparent. Returns the processed image as a base64 PNG string (without
 * the data URI prefix).
 */
export async function removeWhiteBg(
  base64: string,
  format: string,
  tolerance = 60,
): Promise<string | null> {
  if (format === "svg") return null;

  const tmpUri = `${cacheDirectory}white_remove_${Date.now()}.png`;
  const outUri = `${cacheDirectory}white_remove_out_${Date.now()}.png`;
  try {
    const mime = format === "svg" ? "image/svg+xml" : `image/${format}`;
    const srcUri = `data:${mime};base64,${base64}`;

    // Normalise to PNG at original size.
    const result = await manipulateAsync(srcUri, [], {
      compress: 1,
      format: SaveFormat.PNG,
    });

    const pngB64 = await readAsStringAsync(result.uri, {
      encoding: EncodingType.Base64,
    });

    const binary = atob(pngB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const decoded = UPNG.decode(bytes.buffer);
    const w = decoded.width;
    const h = decoded.height;
    const rgba = new Uint8Array(UPNG.toRGBA8(decoded)[0]);

    // Make white-like pixels transparent.
    for (let j = 0; j < rgba.length; j += 4) {
      const r = rgba[j];
      const g = rgba[j + 1];
      const b = rgba[j + 2];
      const maxCh = Math.max(r, g, b);
      const minCh = Math.min(r, g, b);
      const spread = maxCh - minCh;
      const allBright = r > 200 && g > 200 && b > 200;
      const lowSaturation = spread < tolerance;
      if (allBright && lowSaturation) {
        rgba[j + 3] = 0;
      }
    }

    // Encode back to PNG.
    const pngData = UPNG.encode([rgba.buffer as ArrayBuffer], w, h, 256);
    // Chunk the conversion to avoid "Maximum call stack size exceeded" from
    // spreading a large Uint8Array into String.fromCharCode() arguments.
    const uint8 = new Uint8Array(pngData);
    let outB64 = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, uint8.length);
      const chunk = uint8.subarray(i, end);
      outB64 += String.fromCharCode(...chunk);
    }
    outB64 = btoa(outB64);

    return outB64;
  } catch (err) {
    console.warn("[WHITE_BG] removal failed:", err);
    return null;
  } finally {
    await deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
    await deleteAsync(outUri, { idempotent: true }).catch(() => {});
  }
}
