/**
 * Rudimentary icon upscaling for low-resolution icons (e.g. 16x16 favicons
 * shown at 48–64px, which look pixelated).
 *
 * Uses expo-image-manipulator (native) to resample small raster icons up to a
 * clean target size once, so the upscaled bytes are what get cached and shown
 * everywhere. Vector (SVG) icons are passed through untouched.
 */

import {
  cacheDirectory,
  deleteAsync,
  EncodingType,
  readAsStringAsync,
  writeAsStringAsync,
} from "expo-file-system/legacy";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { Image } from "react-native";

// Below this max dimension an icon is considered "low-res" and worth upscaling.
const UPSCALE_THRESHOLD_PX = 64;

// Target size for upscaled icons (power-of-two friendly, crisp at card size).
const TARGET_SIZE_PX = 256;

export function mimeForFormat(format: string): string {
  switch (format) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "ico":
      return "image/x-icon";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/png";
  }
}

function saveFormatFor(format: string): SaveFormat {
  switch (format) {
    case "png":
      return SaveFormat.PNG;
    case "jpg":
    case "jpeg":
      return SaveFormat.JPEG;
    case "webp":
      return SaveFormat.WEBP;
    default:
      return SaveFormat.PNG;
  }
}

export interface UpscaleResult {
  base64: string;
  format: string;
}

/**
 * Upscale a small raster icon (base64 + format) to TARGET_SIZE_PX if needed.
 * Returns the (possibly) upscaled base64 AND the actual output format so
 * callers don't keep treating re-encoded PNG bytes as the original MIME type
 * (e.g. ico/gif inputs are encoded to PNG). On any error, or if the icon is
 * not small / is an SVG, returns the inputs unchanged.
 */
export async function upscaleIconIfSmall(
  base64: string,
  format: string,
  force = false,
): Promise<UpscaleResult> {
  // Vector icons scale natively — nothing to do.
  if (format === "svg") return { base64, format };

  // Temp files are declared outside the try so cleanup always runs.
  const tmpUri = `${cacheDirectory}icon_upscale_${Date.now()}.${format}`;
  let resultUri: string | undefined;
  try {
    const mime = mimeForFormat(format);
    const dataUri = `data:${mime};base64,${base64}`;

    // Measure real dimensions.
    const size = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        Image.getSize(
          dataUri,
          (width, height) => resolve({ width, height }),
          (err) => reject(err),
        );
      },
    );

    const maxDim = Math.max(size.width, size.height);
    if (maxDim >= UPSCALE_THRESHOLD_PX && !force) {
      // Already large enough — no upscaling needed (unless forced by an
      // explicit user tap on the "Upscale (AI)" button).
      return { base64, format };
    }

    // When forced, ensure we still grow the icon to at least TARGET_SIZE_PX
    // (or double its current size if it's already larger than the target).
    const targetWidth = Math.max(TARGET_SIZE_PX, maxDim * 2);

    await writeAsStringAsync(tmpUri, base64, {
      encoding: EncodingType.Base64,
    });

    // Resize with a single dimension so non-square icons keep their aspect
    // ratio; manipulateAsync scales the other side proportionally.
    const result = await manipulateAsync(
      tmpUri,
      [{ resize: { width: targetWidth } }],
      { compress: 1, format: saveFormatFor(format) },
    );
    resultUri = result.uri;

    // Read the upscaled bytes back as base64.
    const upscaled = await readAsStringAsync(result.uri, {
      encoding: EncodingType.Base64,
    });

    // The encoder maps ico/gif (and the default) to PNG — report that so the
    // stored/displayed format matches the actual bytes.
    const outFormat = saveFormatFor(format) === SaveFormat.PNG ? "png" : format;

    console.log(
      `[UPSCALE] ${format} icon ${size.width}x${size.height} -> ${TARGET_SIZE_PX}px (${outFormat})`,
    );
    return { base64: upscaled, format: outFormat };
  } catch (err) {
    // Never break the icon pipeline over upscaling; fall back to original.
    console.log(`[UPSCALE] skipped (${format}):`, err);
    return { base64, format };
  } finally {
    // Always clean up temp files, even on error, to avoid leaking them.
    await deleteAsync(tmpUri, { idempotent: true }).catch(() => {});
    if (resultUri) {
      await deleteAsync(resultUri, { idempotent: true }).catch(() => {});
    }
  }
}
