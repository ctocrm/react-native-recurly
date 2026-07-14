/**
 * Edge-AI icon processing for the picker.
 *
 * - `upscaleIconAi` uses react-native-fast-tflite with multiple bundled super-resolution
 *   models. Model is selected dynamically based on input size, target output size
 *   (determined by device pixel density), and quality mode.
 * - Two quality modes are supported:
 *     - `fast`: small ESPCN models (lower quality, fastest inference).
 *     - `sharp`: FSRCNN models trained with MAE + MS-SSIM + VGG perceptual loss.
 * - If the native module or model is unavailable, it transparently falls back to
 *   the existing bilinear `upscaleIconIfSmall` so the button always works.
 * - `isLowResIcon` detects icons small enough to benefit from upscaling.
 * - White-background removal is handled by whiteBgRemoval.ts using
 *   expo-image-manipulator + upng-js (no WebView needed).
 */

import { Image, PixelRatio } from "react-native";
import { MODEL_MAP } from "./generatedModelMap";
import { mimeForFormat, upscaleIconIfSmall } from "./iconUpscaler";

// Below this max dimension an icon is "low-res" and worth upscaling.
const LOW_RES_THRESHOLD_PX = 64;

// Base display size for icons (what we want to show on screen)
const BASE_DISPLAY_SIZE = 64;

export type UpscaleQuality = "fast" | "sharp";

// Model registry - maps quality -> input_size -> { scale -> model_file }
const MODEL_REGISTRY: Record<
  UpscaleQuality,
  Record<number, Record<number, string>>
> = {
  fast: {
    16: {
      4: "espcn_16x_64x.tflite",
      8: "espcn_16x_128x.tflite",
      12: "espcn_16x_192x.tflite",
      16: "espcn_16x_256x.tflite",
      24: "espcn_16x_384x.tflite",
      32: "espcn_16x_512x.tflite",
    },
    32: {
      2: "espcn_32x_64x.tflite",
      4: "espcn_32x_128x.tflite",
      6: "espcn_32x_192x.tflite",
      8: "espcn_32x_256x.tflite",
      12: "espcn_32x_384x.tflite",
      16: "espcn_32x_512x.tflite",
    },
    48: {
      2: "espcn_48x_96x.tflite",
      3: "espcn_48x_144x.tflite",
      4: "espcn_48x_192x.tflite",
      5: "espcn_48x_240x.tflite",
      8: "espcn_48x_384x.tflite",
      12: "espcn_48x_576x.tflite",
    },
    64: {
      2: "espcn_64x_128x.tflite",
      3: "espcn_64x_192x.tflite",
      4: "espcn_64x_256x.tflite",
      6: "espcn_64x_384x.tflite",
      8: "espcn_64x_512x.tflite",
    },
    96: {
      2: "espcn_96x_192x.tflite",
      3: "espcn_96x_288x.tflite",
      4: "espcn_96x_384x.tflite",
      5: "espcn_96x_480x.tflite",
    },
    128: {
      2: "espcn_128x_256x.tflite",
      3: "espcn_128x_384x.tflite",
    },
  },
  sharp: {
    16: {
      4: "fsrcnn_16x_64x.tflite",
      8: "fsrcnn_16x_128x.tflite",
      12: "fsrcnn_16x_192x.tflite",
      16: "fsrcnn_16x_256x.tflite",
      24: "fsrcnn_16x_384x.tflite",
      32: "fsrcnn_16x_512x.tflite",
    },
    32: {
      2: "fsrcnn_32x_64x.tflite",
      4: "fsrcnn_32x_128x.tflite",
      6: "fsrcnn_32x_192x.tflite",
      8: "fsrcnn_32x_256x.tflite",
      12: "fsrcnn_32x_384x.tflite",
      16: "fsrcnn_32x_512x.tflite",
    },
    48: {
      2: "fsrcnn_48x_96x.tflite",
      3: "fsrcnn_48x_144x.tflite",
      4: "fsrcnn_48x_192x.tflite",
      5: "fsrcnn_48x_240x.tflite",
      8: "fsrcnn_48x_384x.tflite",
      12: "fsrcnn_48x_576x.tflite",
    },
    64: {
      2: "fsrcnn_64x_128x.tflite",
      3: "fsrcnn_64x_192x.tflite",
      4: "fsrcnn_64x_256x.tflite",
      6: "fsrcnn_64x_384x.tflite",
      8: "fsrcnn_64x_512x.tflite",
    },
    96: {
      2: "fsrcnn_96x_192x.tflite",
      3: "fsrcnn_96x_288x.tflite",
      4: "fsrcnn_96x_384x.tflite",
      5: "fsrcnn_96x_480x.tflite",
    },
    128: {
      2: "fsrcnn_128x_256x.tflite",
      3: "fsrcnn_128x_384x.tflite",
      4: "fsrcnn_128x_512x.tflite",
    },
  },
};

// MODEL_MAP (the static `require()` list Metro bundles at build time) is
// auto-generated from the `*.tflite` files present in assets/models/ by
// `scripts/generate-model-map.js` (run during the build and via
// `npm run generate-model-map`). It only ever references files that exist, so
// the build never fails on missing models and newly generated ones (e.g. the
// sharp FSRCNN family) are bundled automatically. See `./generatedModelMap`.

// Cache for loaded models

const loadedModels: Map<string, any> = new Map();
let modelLoadFailed = false;

/**
 * Get the target output size based on device pixel density.
 * Returns the size needed to appear crisp on the current device.
 */
export function getTargetOutputSize(): number {
  const pixelRatio = PixelRatio.get();

  // For icons displayed at BASE_DISPLAY_SIZE pixels, we need to account for pixel density
  // On high-DPI screens (pixelRatio > 1), we need larger images
  const targetSize = Math.round(BASE_DISPLAY_SIZE * pixelRatio);

  // Clamp to reasonable bounds
  return Math.min(Math.max(targetSize, 64), 512);
}

/**
 * Find the nearest input size in our model registry for a given quality mode.
 */
function findNearestInputSize(
  actualSize: number,
  quality: UpscaleQuality,
): number {
  const sizes = Object.keys(MODEL_REGISTRY[quality])
    .map(Number)
    .sort((a, b) => a - b);

  // Exact match
  if (sizes.includes(actualSize)) return actualSize;

  // Find nearest smaller size
  const candidates = sizes.filter((s) => s <= actualSize);
  if (candidates.length > 0) return Math.max(...candidates);

  // If icon is smaller than all supported, use smallest input size
  return sizes[0];
}

/**
 * Find the best scale factor for achieving target output from input.
 */
function findBestScale(
  inputSize: number,
  targetOutput: number,
  quality: UpscaleQuality,
): number | null {
  const scaleMap = MODEL_REGISTRY[quality][inputSize];
  if (!scaleMap) return null;

  // Find scales that get us closest to target
  const scales = Object.keys(scaleMap)
    .map(Number)
    .sort((a, b) => a - b);

  // Exact match first
  const exactScale = targetOutput / inputSize;
  if (scales.includes(exactScale)) return exactScale;

  // Find scale that minimizes difference
  let bestScale = scales[0];
  let minDiff = Math.abs(targetOutput - inputSize * bestScale);

  for (const scale of scales) {
    const output = inputSize * scale;
    const diff = Math.abs(targetOutput - output);
    if (diff < minDiff) {
      minDiff = diff;
      bestScale = scale;
    }
  }

  return bestScale;
}

/**
 * Whether a given quality family has at least one model that is actually
 * bundled (present in MODEL_MAP). The `sharp` FSRCNN family will report
 * `false` until the `fsrcnn_*.tflite` files are generated and wired into
 * MODEL_MAP. Consumers (e.g. the picker UI) can use this to disable a mode.
 */
export function isQualityAvailable(quality: UpscaleQuality): boolean {
  const byInput = MODEL_REGISTRY[quality];
  for (const inputSize of Object.keys(byInput)) {
    const scaleMap = byInput[Number(inputSize)];
    for (const scale of Object.keys(scaleMap)) {
      if (MODEL_MAP[scaleMap[Number(scale)]]) return true;
    }
  }
  return false;
}

/**
 * The quality families that currently have bundled models available.
 */
export const AVAILABLE_QUALITIES: UpscaleQuality[] = (
  ["fast", "sharp"] as UpscaleQuality[]
).filter(isQualityAvailable);

type ModelInfo = {
  inputSize: number;
  scale: number;
  modelFile: string;
  outputSize: number;
};

/**
 * Try to resolve a bundled model for a single quality family. Returns null if
 * no scale matches OR if the matched model file is not actually bundled.
 */
function resolveBundledModel(
  inputSize: number,
  targetOutput: number,
  quality: UpscaleQuality,
): ModelInfo | null {
  const nearestInput = findNearestInputSize(inputSize, quality);
  const scale = findBestScale(nearestInput, targetOutput, quality);

  if (scale === null) return null;

  const modelFile = MODEL_REGISTRY[quality][nearestInput][scale];
  // Only return models that are physically bundled (see MODEL_MAP note).
  if (!modelFile || !MODEL_MAP[modelFile]) return null;

  return {
    inputSize: nearestInput,
    scale,
    modelFile,
    outputSize: nearestInput * scale,
  };
}

/**
 * Get model info for a given input size, target output, and quality.
 * Returns { inputSize, scale, modelFile, outputSize } or null if no match.
 *
 * If the requested quality family has no bundled model for this input/output
 * (e.g. `sharp` before the FSRCNN files are generated), it transparently
 * degrades to the `fast` family so AI upscaling still runs when possible.
 */
export function getModelForUpscale(
  inputSize: number,
  targetOutput: number,
  quality: UpscaleQuality = "fast",
): ModelInfo | null {
  const primary = resolveBundledModel(inputSize, targetOutput, quality);
  if (primary) return primary;

  // Degrade to the fast family if the requested one has no bundled model.
  if (quality !== "fast") {
    return resolveBundledModel(inputSize, targetOutput, "fast");
  }

  return null;
}

/**
 * Check if the Tflite native module is available by probing NativeModules
 * before attempting any import/require. The package's top-level code calls
 * TurboModuleRegistry.getEnforcing(...) which crashes if the native module
 * isn't linked (e.g. Expo Go), so we must avoid loading the JS module at all.
 */
function tfliteModuleExists(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
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

/**
 * Load a specific model by file name.
 */
async function loadModel(modelFile: string): Promise<any | null> {
  if (modelLoadFailed) return null;

  // Return cached model if available
  if (loadedModels.has(modelFile)) {
    return loadedModels.get(modelFile);
  }

  if (!tfliteModuleExists()) {
    modelLoadFailed = true;
    console.warn("[ICON_AI] RNTflite native module not available");
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadTensorflowModel } = require("react-native-fast-tflite");

    if (!loadTensorflowModel) return null;

    const modelAsset = MODEL_MAP[modelFile];
    if (!modelAsset) {
      console.warn(`[ICON_AI] Model not found in map: ${modelFile}`);
      return null;
    }

    const model = await loadTensorflowModel(modelAsset);
    console.log(`[ICON_AI] Loaded model: ${modelFile}`);
    loadedModels.set(modelFile, model);
    return model;
  } catch (err) {
    modelLoadFailed = true;
    console.warn(`[ICON_AI] Failed to load model ${modelFile}:`, err);
    return null;
  }
}

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

/**
 * Upscale a small raster icon using the edge-AI model when available, else the
 * bilinear fallback. Always returns a base64 plus the output format.
 *
 * `force` skips the "already large enough" short-circuit so an explicit user
 * tap always produces a crisper, larger icon (the stored bytes may already be
 * a 256px bilinear upscale from crawl time, which is still low quality).
 *
 * `quality` selects the model family: "fast" (ESPCN) or "sharp" (FSRCNN).
 * The target output size is determined dynamically based on device pixel density.
 */
export async function upscaleIconAi(
  base64: string,
  format: string,
  force = false,
  quality: UpscaleQuality = "fast",
): Promise<{ base64: string; format: string }> {
  if (format === "svg") return { base64, format };

  // Get actual input dimensions
  const mime = mimeForFormat(format);
  const srcUri = `data:${mime};base64,${base64}`;

  const inputSize = await new Promise<number>((resolve, reject) => {
    Image.getSize(
      srcUri,
      (w, h) => resolve(Math.max(w, h)),
      (err) => reject(err),
    );
  }).catch(() => 32); // Default fallback

  // Get target output based on device pixel density
  const targetOutput = getTargetOutputSize();

  console.log(
    `[ICON_AI] Upscaling ${inputSize}px → target ${targetOutput}px (${quality})`,
  );

  // Find appropriate model
  const modelInfo = getModelForUpscale(inputSize, targetOutput, quality);

  if (!modelInfo) {
    console.log(
      `[ICON_AI] No ${quality} model found for ${inputSize}→${targetOutput}, using bilinear`,
    );
    return upscaleIconIfSmall(base64, format, force);
  }

  const model = await loadModel(modelInfo.modelFile);
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

    // Resize to the model's expected input size
    const bounded = await manipulateAsync(
      srcUri,
      [{ resize: { width: modelInfo.inputSize, height: modelInfo.inputSize } }],
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
    const rgbIn = new Float32Array(
      modelInfo.inputSize * modelInfo.inputSize * 3,
    );
    let srcP = 0;
    for (let i = 0; i < modelInfo.inputSize * modelInfo.inputSize; i++) {
      rgbIn[i * 3] = rgbaIn[srcP++] / 255;
      rgbIn[i * 3 + 1] = rgbaIn[srcP++] / 255;
      rgbIn[i * 3 + 2] = rgbaIn[srcP++] / 255;
      srcP++; // skip alpha
    }

    // Run the selected super-resolution model
    const out: Float32Array[] = await model.runSync([rgbIn]);
    const outBytes = out[0];
    const outW = modelInfo.outputSize;
    const outH = modelInfo.outputSize;

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

    // Encode the upscaled RGBA back to a PNG
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
    console.log(
      `[ICON_AI] Upscaled ${inputSize}px → ${outW}x${outH}px using ${modelInfo.modelFile}`,
    );
    return { base64: result, format: "png" };
  } catch (err) {
    console.warn("[ICON_AI] model run failed, bilinear fallback:", err);
    return upscaleIconIfSmall(base64, format, true);
  }
}
