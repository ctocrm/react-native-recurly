#!/usr/bin/env node
/**
 * Model registry generator — scans `assets/models/*.tflite` and produces
 * `model_registry.json` with actual file sizes.
 *
 * This replaces hand-maintained registry entries in the Python training scripts.
 * It is safe to run at any time and is idempotent.
 *
 * Usage:
 *   node scripts/generate-model-registry.js
 *
 * The resulting registry is written to `assets/models/model_registry.json`.
 * Known epochs are preserved from an existing registry; for new files they
 * default to 0.
 */

const fs = require("fs");
const path = require("path");

const MODEL_DIR = path.join(__dirname, "..", "assets", "models");
const REGISTRY_PATH = path.join(MODEL_DIR, "model_registry.json");

// Matches <family>_<in>x_<out>x.tflite, e.g. espcn_16x_64x.tflite
const MODEL_RE = /^(espcn|fsrcnn)_(\d+)x_(\d+)x\.tflite$/;

function main() {
  if (!fs.existsSync(MODEL_DIR)) {
    console.error(`[REGISTRY] Model dir not found: ${MODEL_DIR}`);
    process.exit(1);
  }

  // Load existing registry to preserve epoch info
  let existingEpochs = {};
  if (fs.existsSync(REGISTRY_PATH)) {
    try {
      const existing = JSON.parse(fs.readFileSync(REGISTRY_PATH, "utf8"));
      for (const m of existing.models || []) {
        existingEpochs[m.file] = m.epochs;
      }
    } catch (e) {
      console.warn(`[REGISTRY] Could not read existing registry: ${e.message}`);
    }
  }

  const files = fs
    .readdirSync(MODEL_DIR)
    .filter((f) => MODEL_RE.test(f))
    .sort();

  if (files.length === 0) {
    console.warn(
      `[REGISTRY] WARNING: no model files matched ${MODEL_RE} in ${MODEL_DIR}. Writing empty registry.`,
    );
  }

  const models = files.map((f) => {
    const [, family, inStr, outStr] = f.match(MODEL_RE);
    const inputSize = parseInt(inStr, 10);
    const outputSize = parseInt(outStr, 10);
    const scale = outputSize / inputSize;
    const filePath = path.join(MODEL_DIR, f);
    const sizeBytes = fs.statSync(filePath).size;
    const epochs = existingEpochs[f] || 0;

    return {
      input_size: inputSize,
      scale,
      output_size: outputSize,
      epochs,
      file: f,
      size_bytes: sizeBytes,
    };
  });

  const totalBytes = models.reduce((sum, m) => sum + m.size_bytes, 0);

  const registry = {
    models,
    total_size_bytes: totalBytes,
  };

  fs.writeFileSync(
    REGISTRY_PATH,
    JSON.stringify(registry, null, 2) + "\n",
    "utf8",
  );

  const espcnCount = models.filter((m) => m.file.startsWith("espcn_")).length;
  const fsrcnnCount = models.filter((m) => m.file.startsWith("fsrcnn_")).length;

  console.log(
    `[REGISTRY] Wrote ${REGISTRY_PATH} (` +
      `${espcnCount} espcn + ${fsrcnnCount} fsrcnn = ${models.length} models, ` +
      `total ~${Math.round(totalBytes / 1024)}KB)`,
  );
}

main();
