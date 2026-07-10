/**
 * Edge-AI icon processing for the picker.
 *
 * - `upscaleIconAi` uses react-native-fast-tflite with a bundled super-resolution
 *   model (ESPCN/LapSRN style). The model is loaded lazily once and reused.
 *   If the native module or model is unavailable, it transparently falls back to
 *   the existing bilinear `upscaleIconIfSmall` so the button always works.
 * - `isLowResIcon` detects icons small enough to benefit from upscaling.
 * - White-background removal is handled by whiteBgRemoval.ts using
 *   expo-image-manipulator + upng-js (no WebView needed).
 */

import { Image } from "react-native";
import { mimeForFormat, upscaleIconIfSmall } from "./iconUpscaler";

// Below this max dimension an icon is "low-res" and worth upscaling.
const LOW_RES_THRESHOLD_PX = 64;

// Input size we feed the ESPCN model (matches training resolution for fast model).
const MODEL_INPUT_PX = 32;
// Output is 2x the input.
const MODEL_SCALE = 2;

export function isLowResIcon(
  base64: string,
  format: string,
  originalWidth?: number,
  originalHeight?: number,
): Promise<boolean> {
  return new Promise((resolve) => {
    if (format === "svg") {
      resolve(false);
      return;
    }
    // If we have original dimensions stored (from before upscaling), use those
    // directly -- no need to decode the image again. This is the key fix for the
    // "Upscale" button not appearing: icons are upscaled to 256px before storage,
    // so the current imageData always looks "large enough".
    if (originalWidth !== undefined && originalHeight !== undefined) {
      resolve(Math.max(originalWidth, originalHeight) < LOW_RES_THRESHOLD_PX);
      return;
    }
    const mime = mimeForFormat(format);
    const uri = `data:${mime};base64,${base64}`;
    Image.getSize(
      uri,
      (w: number, h: number) => {
        resolve(Math.max(w, h) < LOW_RES_THRESHOLD_PX);
      },
      () => resolve(false),
    );
  });
}

let modelPromise: Promise<any> | null = null;
let modelFailed = false;

/**
 * Check if the Tflite native module is available by probing NativeModules
 * before attempting any import/require. The package's top-level code calls
 * TurboModuleRegistry.getEnforcing(...) which crashes if the native module
 * isn't linked (e.g. Expo Go), so we must avoid loading the JS module at all.
 */
function tfliteModuleExists(): boolean {
  try {
    const TurboModuleRegistry = require("react-native").TurboModuleRegistry;
    // react-native-fast-tflite exposes its TurboModule under the name "Tflite".
    const mod =
      TurboModuleRegistry &&
      (TurboModuleRegistry.get
        ? TurboModuleRegistry.get("Tflite")
        : TurboModuleRegistry.getEnforcing("Tflite"));
    return !!mod;
  } catch {
    return false;
  }
}

function loadModel(): Promise<any | null> {
  if (modelFailed) return Promise.resolve(null);
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    try {
      if (!tfliteModuleExists()) {
        modelFailed = true;
        console.warn("[ICON_AI] RNTflite native module not available");
        return null;
      }

      // Safe to require now since native module exists.
      const { loadTensorflowModel } = require("react-native-fast-tflite");
      if (!loadTensorflowModel) return null;

      // Bundled model resolved at build time.
      const model = await loadTensorflowModel(
        require("../../assets/models/espcn_2x.tflite"),
      );
      console.log("[ICON_AI] super-resolution model loaded");
      return model;
    } catch (err) {
      modelFailed = true;
      console.warn(
        "[ICON_AI] native model unavailable, using bilinear fallback:",
        err,
      );
      return null;
    }
  })();

  return modelPromise;
}

/**
 * Upscale a small raster icon using the edge-AI model when available, else the
 * bilinear fallback. Always returns a base64 plus the output format.
 *
 * `force` skips the "already large enough" short-circuit so an explicit user
 * tap always produces a crisper, larger icon (the stored bytes may already be
 * a 256px bilinear upscale from crawl time, which is still low quality).
 */
export async function upscaleIconAi(
  base64: string,
  format: string,
  force = false,
): Promise<{ base64: string; format: string }> {
  if (format === "svg") return { base64, format };

  const model = await loadModel();
  if (!model) {
    return upscaleIconIfSmall(base64, format, force);
  }

  try {
    const { manipulateAsync, SaveFormat } =
      await import("expo-image-manipulator");
    const { readAsStringAsync, EncodingType } =
      await import("expo-file-system/legacy");
    const { deleteAsync } = await import("expo-file-system/legacy");
    const UPNG = (await import("upng-js")).default;

    const mime = mimeForFormat(format);
    const srcUri = `data:${mime};base64,${base64}`;

    // Resize to the model's expected square input size (32x32).
    const bounded = await manipulateAsync(
      srcUri,
      [{ resize: { width: MODEL_INPUT_PX, height: MODEL_INPUT_PX } }],
      { compress: 1, format: SaveFormat.PNG },
    );

    // Read the resized PNG and decode to get RGB pixels for the model.
    const inputB64 = await readAsStringAsync(bounded.uri, {
      encoding: EncodingType.Base64,
    });

    // Decode PNG to get raw RGBA pixels.
    const decoded = UPNG.decode(
      Uint8Array.from(atob(inputB64), (c) => c.charCodeAt(0)).buffer,
    ) as any;
    const rgbaIn = new Uint8ClampedArray(
      decoded.data as unknown as ArrayBuffer,
    );

    // Extract RGB planes (model expects 3 channels, no alpha).
    const rgbIn = new Float32Array(MODEL_INPUT_PX * MODEL_INPUT_PX * 3);
    let srcP = 0;
    for (let i = 0; i < MODEL_INPUT_PX * MODEL_INPUT_PX; i++) {
      rgbIn[i * 3] = rgbaIn[srcP++] / 255;
      rgbIn[i * 3 + 1] = rgbaIn[srcP++] / 255;
      rgbIn[i * 3 + 2] = rgbaIn[srcP++] / 255;
      srcP++; // skip alpha
    }

    // Run ESPCN: output is the 2x RGB image (shape: 1x64x64x3).
    const out: Float32Array[] = await model.runSync([rgbIn]);
    const outBytes = out[0];
    const outW = MODEL_INPUT_PX * MODEL_SCALE;
    const outH = MODEL_INPUT_PX * MODEL_SCALE;

    // Allocate RGBA buffer for upng-js (expects 4 channels).
    // Model outputs float32 0-1, convert to uint8 0-255.
    const rgba = new Uint8Array(outW * outH * 4);
    let p = 0;
    for (let i = 0; i < outW * outH; i++) {
      rgba[i * 4] = Math.round(outBytes[p++] * 255);
      rgba[i * 4 + 1] = Math.round(outBytes[p++] * 255);
      rgba[i * 4 + 2] = Math.round(outBytes[p++] * 255);
      rgba[i * 4 + 3] = 255;
    }

    // Encode the upscaled RGBA back to a PNG (cnum=0 → full 32-bit RGBA, no palette quantization).
    const pngData = UPNG.encode([rgba.buffer as ArrayBuffer], outW, outH, 0);
    const uint8 = new Uint8Array(pngData);
    let outB64 = "";
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, uint8.length);
      outB64 += String.fromCharCode(...uint8.subarray(i, end));
    }
    const result = btoa(outB64);

    await deleteAsync(bounded.uri, { idempotent: true }).catch(() => {});
    return { base64: result, format: "png" };
  } catch (err) {
    console.warn("[ICON_AI] model run failed, bilinear fallback:", err);
    // Must pass force=true so the fallback actually upscales instead of
    // short-circuiting on the already-stored (≥64px) bytes.
    return upscaleIconIfSmall(base64, format, true);
  }
}
