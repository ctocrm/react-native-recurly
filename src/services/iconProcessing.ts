/**
 * Edge-AI icon processing for the picker.
 *
 * - `upscaleIconAi` uses react-native-fast-tflite with multiple bundled super-resolution
 *   models. Model is selected dynamically based on input size, target output size
 *   (determined by device pixel density), and quality mode.
 * - Two quality modes are supported:
 *     - `fast`: small ESPCN models (lower quality, fastest inference).
 *     - `sharp`: FSRCNN residual models (MAE + color preserve + light edge).
 * - After the model runs, output is blended with bilinear (brand-safe lerp):
 *     out = (1-t)*bilin + t*clamp(model)  with t≈0.25 (between 80/20 and 70/30).
 *   Keeps stroke weight / branding from bilin; model only adds a little snap.
 * - If the native module or model is unavailable, it transparently falls back to
 *   the existing bilinear `upscaleIconIfSmall` so the button always works.
 * - `isLowResIcon` detects icons small enough to benefit from upscaling.
 * - White-background removal is handled by whiteBgRemoval.ts using
 *   expo-image-manipulator + upng-js (no WebView needed).
 */

import { Image, PixelRatio } from "react-native";
import { MODEL_CATALOG, MODEL_MAP } from "./generatedModelMap";
import { mimeForFormat, upscaleIconIfSmall } from "./iconUpscaler";

// Below this max dimension an icon is "low-res" and worth upscaling.
const LOW_RES_THRESHOLD_PX = 64;

// Base display size for icons (what we want to show on screen)
const BASE_DISPLAY_SIZE = 64;

export type UpscaleQuality = "fast" | "sharp";

// Selection matrix: MODEL_CATALOG from generatedModelMap.ts (registry → codegen).
// Do not hardcode model lists here.

// MODEL_MAP + MODEL_CATALOG are generated from assets/models/model_registry.json
// by scripts/generate-model-map.js (build + npm run generate-model-map).

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
  const sizes = Object.keys(MODEL_CATALOG[quality])
    .map(Number)
    .sort((a, b) => a - b);

  // Exact match
  if (sizes.includes(actualSize)) return actualSize;

  // Find nearest smaller or equal input size
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
  const scaleMap = MODEL_CATALOG[quality][inputSize];
  if (!scaleMap) return null;

  // Only consider scales whose model file is actually bundled. This keeps us
  // within the same quality tier and lets us pick another bundled scale when
  // the mathematically-closest one isn't shipped, instead of failing over to
  // bilinear in resolveBundledModel.
  const scales = Object.keys(scaleMap)
    .map(Number)
    .filter((s) => !!MODEL_MAP[scaleMap[s]])
    .sort((a, b) => a - b);

  if (scales.length === 0) return null;

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
  const byInput = MODEL_CATALOG[quality];
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

  const modelFile = MODEL_CATALOG[quality][nearestInput][scale];
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
/**
 * Brand-safe hybrid (Ace POC 2026-08-08): bilin owns stroke mass; model is a
 * residual. Base t≈0.25 for mid/large LR; tiny favicons need stronger model mix
 * or thumbs look identical to bilinear. See AI_UPSCALING.md.
 */
const BRAND_SAFE_LERP_T = 0.25;
const BRAND_SAFE_MAX_DARKEN = 0.12;
const BRAND_SAFE_MAX_BRIGHTEN = 0.35;

/** Adaptive model mix: more snap on tiny LR, still not full model (avoids hollow letters). */
function brandSafeLerpTForInput(inputPx: number): number {
  if (inputPx <= 24) return 0.48;
  if (inputPx <= 48) return 0.38;
  if (inputPx <= 96) return 0.32;
  return BRAND_SAFE_LERP_T;
}

/** Bilinear upsample RGB float32 planar [H*W*3] in 0..1. */
function bilinearUpsampleRgb(
  src: Float32Array,
  inW: number,
  inH: number,
  outW: number,
  outH: number,
): Float32Array {
  const dst = new Float32Array(outW * outH * 3);
  const scaleX = inW / outW;
  const scaleY = inH / outH;
  for (let y = 0; y < outH; y++) {
    const fy = (y + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(inH - 1, Math.floor(fy)));
    const y1 = Math.min(inH - 1, y0 + 1);
    const wy = Math.min(1, Math.max(0, fy - y0));
    for (let x = 0; x < outW; x++) {
      const fx = (x + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.min(inW - 1, Math.floor(fx)));
      const x1 = Math.min(inW - 1, x0 + 1);
      const wx = Math.min(1, Math.max(0, fx - x0));
      const i00 = (y0 * inW + x0) * 3;
      const i01 = (y0 * inW + x1) * 3;
      const i10 = (y1 * inW + x0) * 3;
      const i11 = (y1 * inW + x1) * 3;
      const o = (y * outW + x) * 3;
      for (let c = 0; c < 3; c++) {
        const v0 = src[i00 + c] * (1 - wx) + src[i01 + c] * wx;
        const v1 = src[i10 + c] * (1 - wx) + src[i11 + c] * wx;
        dst[o + c] = v0 * (1 - wy) + v1 * wy;
      }
    }
  }
  return dst;
}

/**
 * out = (1-t)*bilin + t*(bilin + clamp(model-bilin))
 *     = bilin + t*clamp(residual)
 * Preserves brand mass; limits how much the model can carve letter fill.
 */
function brandSafeHybridRgb(
  bilin: Float32Array,
  modelOut: Float32Array,
  t: number = BRAND_SAFE_LERP_T,
  maxDarken: number = BRAND_SAFE_MAX_DARKEN,
  maxBrighten: number = BRAND_SAFE_MAX_BRIGHTEN,
): Float32Array {
  const n = Math.min(bilin.length, modelOut.length);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let r = modelOut[i] - bilin[i];
    if (r < -maxDarken) r = -maxDarken;
    if (r > maxBrighten) r = maxBrighten;
    let v = bilin[i] + t * r;
    if (v < 0) v = 0;
    else if (v > 1) v = 1;
    out[i] = v;
  }
  return out;
}

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
    // Only record this specific model as failed; do NOT set the global
    // modelLoadFailed flag here. A single model failing to load (e.g. a
    // corrupt/absent file) should not disable AI upscaling for every other
    // model. The systemic native-module-unavailable path above keeps that flag.
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
export type AiUpscaleResult = {
  base64: string;
  format: string;
  width?: number;
  height?: number;
};

export async function upscaleIconAi(
  base64: string,
  format: string,
  force = false,
  quality: UpscaleQuality = "fast",
): Promise<AiUpscaleResult> {
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

    // Decode PNG → RGBA8. UPNG.decode() only returns metadata + compressed
    // frames; pixel bytes come from UPNG.toRGBA8(img)[0]. Using decoded.data
    // directly fed zeros into the model (range=0 → silent bilinear fallback).
    const pngBytes = Uint8Array.from(atob(inputB64), (c) => c.charCodeAt(0));
    const decoded = UPNG.decode(pngBytes.buffer) as {
      width: number;
      height: number;
    };
    const frames = UPNG.toRGBA8(decoded as any) as ArrayBuffer[];
    if (!frames?.length) {
      console.warn("[ICON_AI] UPNG.toRGBA8 returned no frames, bilinear");
      return upscaleIconIfSmall(base64, format, true);
    }
    const rgbaIn = new Uint8ClampedArray(frames[0]);
    const pxCount = decoded.width * decoded.height;
    if (rgbaIn.length < pxCount * 4) {
      console.warn(
        `[ICON_AI] RGBA buffer too small (${rgbaIn.length} < ${pxCount * 4}), bilinear`,
      );
      return upscaleIconIfSmall(base64, format, true);
    }

    // Match training domain (train_espcn/fsrcnn_multi.py):
    //   base = rgb * alpha + (1 - alpha)   // composite onto white
    // Models never saw raw premultiplied-black holes under transparency.
    // Prefer the decoded dimensions; fall back to model input size.
    const inW = decoded.width || modelInfo.inputSize;
    const inH = decoded.height || modelInfo.inputSize;
    const rgbIn = new Float32Array(inW * inH * 3);
    // Keep source alpha so we can NN-restore it on the SR output.
    const alphaIn = new Float32Array(inW * inH);
    let srcP = 0;
    let inMin = 1;
    let inMax = 0;
    let alphaMin = 1;
    let alphaMax = 0;
    for (let i = 0; i < inW * inH; i++) {
      const r = rgbaIn[srcP++] / 255;
      const g = rgbaIn[srcP++] / 255;
      const b = rgbaIn[srcP++] / 255;
      const a = rgbaIn[srcP++] / 255;
      alphaIn[i] = a;
      if (a < alphaMin) alphaMin = a;
      if (a > alphaMax) alphaMax = a;
      // White composite (same formula as training rasterize path)
      const cr = r * a + (1 - a);
      const cg = g * a + (1 - a);
      const cb = b * a + (1 - a);
      rgbIn[i * 3] = cr;
      rgbIn[i * 3 + 1] = cg;
      rgbIn[i * 3 + 2] = cb;
      if (cr < inMin) inMin = cr;
      if (cg < inMin) inMin = cg;
      if (cb < inMin) inMin = cb;
      if (cr > inMax) inMax = cr;
      if (cg > inMax) inMax = cg;
      if (cb > inMax) inMax = cb;
    }
    console.log(
      `[ICON_AI] input ${inW}x${inH} white-comp rgb range=${(inMax - inMin).toFixed(3)} alpha=[${alphaMin.toFixed(2)},${alphaMax.toFixed(2)}] len=${rgbIn.length} modelIn=${modelInfo.inputSize}`,
    );
    if (inMax - inMin < 1e-6) {
      console.warn("[ICON_AI] input image is constant, bilinear");
      return upscaleIconIfSmall(base64, format, true);
    }

    // Run the selected super-resolution model
    const out: Float32Array[] = await model.runSync([rgbIn]);
    const outBytes = out?.[0];
    const outW = modelInfo.outputSize;
    const outH = modelInfo.outputSize;
    const expectedOut = outW * outH * 3;

    if (!outBytes || outBytes.length < expectedOut) {
      console.warn(
        `[ICON_AI] unexpected output length ${outBytes?.length ?? 0} (expected ${expectedOut}), bilinear`,
      );
      return upscaleIconIfSmall(base64, format, true);
    }

    // Detect useless model output: if all values are nearly identical (low
    // variance), the model is producing a constant gray patch instead of
    // actual upscaled content. Fall back to bilinear in that case.
    // Sample across the full buffer (not just the first 100 floats, which can
    // be a single flat edge of a valid image).
    {
      let min = Infinity;
      let max = -Infinity;
      const step = Math.max(1, Math.floor(outBytes.length / 256));
      for (let i = 0; i < outBytes.length; i += step) {
        const v = outBytes[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      console.log(
        `[ICON_AI] output len=${outBytes.length} range=${(max - min).toFixed(4)} sample min/max`,
      );
      if (max - min < 0.05) {
        console.warn(
          `[ICON_AI] Model output has insufficient variance (range=${(max - min).toFixed(4)}), falling back to bilinear`,
        );
        return upscaleIconIfSmall(base64, format, true);
      }
    }

    // Brand-safe hybrid: bilin mass + clamped residual; adaptive t for tiny LR.
    const bilinRgb = bilinearUpsampleRgb(rgbIn, inW, inH, outW, outH);
    const hybridT = brandSafeLerpTForInput(inW);
    const hybridRgb = brandSafeHybridRgb(bilinRgb, outBytes, hybridT);
    console.log(
      `[ICON_AI] brand-safe hybrid t=${hybridT.toFixed(2)} in=${inW}px (bilin + clamped residual)`,
    );

    // NN-upscale alpha from LR → HR (models are RGB-only; alpha is geometry).
    const scaleX = outW / inW;
    const scaleY = outH / inH;
    const hasTransparency = alphaMin < 0.999;

    // Allocate RGBA buffer for upng-js (expects 4 channels).
    // Hybrid is white-composited RGB. If the source had transparency,
    // un-composite via restored alpha so holes stay transparent.
    const rgba = new Uint8Array(outW * outH * 4);
    let p = 0;
    for (let y = 0; y < outH; y++) {
      const sy = Math.min(inH - 1, Math.floor(y / scaleY));
      for (let x = 0; x < outW; x++) {
        const sx = Math.min(inW - 1, Math.floor(x / scaleX));
        const a = hasTransparency ? alphaIn[sy * inW + sx] : 1;
        let r = hybridRgb[p++];
        let g = hybridRgb[p++];
        let b = hybridRgb[p++];
        // Clamp model output
        r = r < 0 ? 0 : r > 1 ? 1 : r;
        g = g < 0 ? 0 : g > 1 ? 1 : g;
        b = b < 0 ? 0 : b > 1 ? 1 : b;
        if (hasTransparency && a > 1e-3 && a < 0.999) {
          // Invert white composite: rgb = (comp - (1-a)) / a
          r = (r - (1 - a)) / a;
          g = (g - (1 - a)) / a;
          b = (b - (1 - a)) / a;
          r = r < 0 ? 0 : r > 1 ? 1 : r;
          g = g < 0 ? 0 : g > 1 ? 1 : g;
          b = b < 0 ? 0 : b > 1 ? 1 : b;
        } else if (hasTransparency && a <= 1e-3) {
          r = 0;
          g = 0;
          b = 0;
        }
        const i = (y * outW + x) * 4;
        rgba[i] = Math.round(r * 255);
        rgba[i + 1] = Math.round(g * 255);
        rgba[i + 2] = Math.round(b * 255);
        rgba[i + 3] = Math.round(a * 255);
      }
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
      `[ICON_AI] Upscaled ${inputSize}px → ${outW}x${outH}px using ${modelInfo.modelFile} + brand-safe hybrid`,
    );
    return { base64: result, format: "png", width: outW, height: outH };
  } catch (err) {
    console.warn("[ICON_AI] model run failed, bilinear fallback:", err);
    return upscaleIconIfSmall(base64, format, true);
  }
}
