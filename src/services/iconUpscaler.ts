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

function mimeForFormat(format: string): string {
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

/**
 * Upscale a small raster icon (base64 + format) to TARGET_SIZE_PX if needed.
 * Returns the (possibly) upscaled base64; on any error or if the icon is not
 * small, returns the original base64 unchanged. SVG is returned as-is.
 */
export async function upscaleIconIfSmall(
  base64: string,
  format: string,
): Promise<string> {
  // Vector icons scale natively — nothing to do.
  if (format === "svg") return base64;

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
    if (maxDim >= UPSCALE_THRESHOLD_PX) {
      // Already large enough — no upscaling needed.
      return base64;
    }

    // Write to a temp file so manipulateAsync can process it.
    const tmpUri = `${cacheDirectory}icon_upscale_${Date.now()}.${format}`;
    await writeAsStringAsync(tmpUri, base64, {
      encoding: EncodingType.Base64,
    });

    const result = await manipulateAsync(
      tmpUri,
      [{ resize: { width: TARGET_SIZE_PX, height: TARGET_SIZE_PX } }],
      { compress: 1, format: saveFormatFor(format) },
    );

    // Read the upscaled bytes back as base64.
    const upscaled = await readAsStringAsync(result.uri, {
      encoding: EncodingType.Base64,
    });

    // Clean up temp files.
    try {
      await deleteAsync(tmpUri, { idempotent: true });
      await deleteAsync(result.uri, { idempotent: true });
    } catch {
      // Best-effort cleanup.
    }

    console.log(
      `[UPSCALE] ${format} icon ${size.width}x${size.height} -> ${TARGET_SIZE_PX}px`,
    );
    return upscaled;
  } catch (err) {
    // Never break the icon pipeline over upscaling; fall back to original.
    console.log(`[UPSCALE] skipped (${format}):`, err);
    return base64;
  }
}
