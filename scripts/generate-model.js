#!/usr/bin/env node
/**
 * Model generation script for ESPCN 2x upscaling model.
 *
 * Usage:
 *   node scripts/generate-model.ts [--force]
 *
 * Options:
 *   --force    Force regeneration even if model exists and is fresh
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const MODEL_PATH = path.join(
  __dirname,
  "..",
  "assets",
  "models",
  "espcn_2x.tflite",
);
const PYTHON_SCRIPT = path.join(__dirname, "train_espcn_fast.py");

const FORCE = process.argv.includes("--force");

function fileExists(p) {
  return fs.existsSync(p);
}

function getFileModTime(p) {
  return fs.statSync(p).mtime.getTime();
}

function main() {
  console.log("[MODEL] Starting model generation process...");

  // Check if model exists and is fresh (unless --force)
  if (!FORCE && fileExists(MODEL_PATH) && fileExists(PYTHON_SCRIPT)) {
    const modelTime = getFileModTime(MODEL_PATH);
    const scriptTime = getFileModTime(PYTHON_SCRIPT);

    if (modelTime > scriptTime) {
      console.log(
        `[MODEL] Model exists and is fresh (${new Date(modelTime).toISOString()})`,
      );
      console.log("[MODEL] Skipping regeneration. Use --force to regenerate.");
      process.exit(0);
    }
    console.log("[MODEL] Model is stale, regenerating...");
  }

  // Try to use existing tfenv, otherwise use system python
  const tfEnvPython = "/tmp/tfenv/bin/python";
  const venvPython = path.join(__dirname, "..", ".venv", "bin", "python");

  let pythonCmd;

  if (fs.existsSync(tfEnvPython)) {
    pythonCmd = tfEnvPython;
    console.log(`[MODEL] Using tfenv python at ${pythonCmd}`);
  } else if (fs.existsSync(venvPython)) {
    pythonCmd = venvPython;
    console.log(`[MODEL] Using venv python at ${pythonCmd}`);
  } else {
    pythonCmd = "python3";
    console.log(`[MODEL] Using system python (${pythonCmd})`);
  }

  try {
    console.log(`[MODEL] Running training script: ${PYTHON_SCRIPT}`);
    execFileSync(pythonCmd, [PYTHON_SCRIPT], {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
    });
    console.log("[MODEL] Model generation completed successfully!");
  } catch (err) {
    console.error("[MODEL] Error during model generation:", err);
    process.exit(1);
  }
}

main();
