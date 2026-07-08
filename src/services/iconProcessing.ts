/**
 * Edge-AI icon processing for the picker.
 *
 * - `upscaleIconAi` uses react-native-fast-tflite with a bundled super-resolution
 *   model (ESPCN/LapSRN style). The model is loaded lazily once and reused.
 *   If the native module or model is unavailable, it transparently falls back to
 *   the existing bilinear `upscaleIconIfSmall` so the button always works.
 * - `isLowResIcon` detects icons small enough to benefit from upscaling.
 * - White-background removal is handled in the WebView canvas processor
 *   (ImageProcessWebView) which is cheaper and needs no ML model.
 */

import { Image } from "react-native";
import { mimeForFormat, upscaleIconIfSmall } from "./iconUpscaler";

// Below this max dimension an icon is "low-res" and worth upscaling.
const LOW_RES_THRESHOLD_PX = 64;

// Heuristic upper bound for the input size we feed the model (keeps latency low).
const MAX_MODEL_INPUT_PX = 128;

export function isLowResIcon(base64: string, format: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (format === "svg") {
      resolve(false);
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

// Expect a model file at assets/models/espcn_2x.tflite. The user provides the
// actual .tflite; we resolve it from the app bundle via require(). The native
// module is imported dynamically so the app still builds/runs (Expo Go) where
// it isn't linked — the import is deliberately `any`-typed because the package
// is added via a dev build, not present in this type environment.
function loadModel(): Promise<any | null> {
  if (modelFailed) return Promise.resolve(null);
  if (modelPromise) return modelPromise;

  modelPromise = (async () => {
    try {
      const TfliteModule: any = await import("react-native-fast-tflite");
      const loadTfliteModel = TfliteModule.loadTfliteModel;
      if (!loadTfliteModel) return null;

      // Bundled model resolved at build time.
      const modelPath: any = require("../../assets/models/espcn_2x.tflite");
      const model = await loadTfliteModel(modelPath);
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
 */
export async function upscaleIconAi(
  base64: string,
  format: string,
): Promise<{ base64: string; format: string }> {
  if (format === "svg") return { base64, format };

  const model = await loadModel();
  if (!model) {
    return upscaleIconIfSmall(base64, format);
  }

  try {
    const { manipulateAsync, SaveFormat } =
      await import("expo-image-manipulator");
    const { readAsStringAsync, EncodingType } =
      await import("expo-file-system/legacy");
    const { deleteAsync } = await import("expo-file-system/legacy");

    const mime = mimeForFormat(format);
    const srcUri = `data:${mime};base64,${base64}`;

    // Bound input size for the model.
    const bounded = await manipulateAsync(
      srcUri,
      [{ resize: { width: MAX_MODEL_INPUT_PX } }],
      { compress: 1, format: SaveFormat.PNG },
    );

    // Read the normalized PNG back as base64 to feed the model tensor.
    const inputB64 = await readAsStringAsync(bounded.uri, {
      encoding: EncodingType.Base64,
    });

    const binary = atob(inputB64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const out: Uint8Array[] = await model.runSync([bytes]);
    const outBytes = out[0] as Uint8Array;
    let outB64 = "";
    for (let i = 0; i < outBytes.length; i++) {
      outB64 += String.fromCharCode(outBytes[i]);
    }
    const result = btoa(outB64);

    await deleteAsync(bounded.uri, { idempotent: true }).catch(() => {});
    return { base64: result, format: "png" };
  } catch (err) {
    console.warn("[ICON_AI] model run failed, bilinear fallback:", err);
    return upscaleIconIfSmall(base64, format);
  }
}
