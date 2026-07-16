#!/usr/bin/env node
/**
 * Multi-model generation script for super-resolution models.
 *
 * Requires a pre-configured Python virtual environment at `.venv/` in the
 * project root. Run `bash scripts/train-setup.sh` to create it.
 *
 * Usage:
 *   node scripts/generate-model.js [--force] [--model=N] [--input-size=N]
 *     [--output-dir=PATH] [--quality=fast|sharp] [--no-perceptual]
 *
 * Options:
 *   --force            Force regeneration even if models exist and are fresh
 *   --model=N          Train only a specific model (by input_size_output_size, e.g., 16_32 for 16->32)
 *   --input-size=N     Train every configured model for one input size
 *   --output-dir=PATH  Write models and the merged registry to this directory
 *   --quality=fast     Train the small ESPCN models instead of the default FSRCNN sharp models
 *   --no-perceptual    Skip VGG perceptual loss for sharp dev/test runs
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const FORCE = process.argv.includes("--force");
const NO_PERCEPTUAL = process.argv.includes("--no-perceptual");
const SPECIFIC_MODEL = process.argv
  .find((arg) => arg.startsWith("--model="))
  ?.split("=")[1];
const INPUT_SIZE = process.argv
  .find((arg) => arg.startsWith("--input-size="))
  ?.split("=")[1];
const OUTPUT_DIR = process.argv
  .find((arg) => arg.startsWith("--output-dir="))
  ?.split("=")[1];
const QUALITY =
  process.argv.find((arg) => arg.startsWith("--quality="))?.split("=")[1] ||
  "sharp";

if (!["fast", "sharp"].includes(QUALITY)) {
  console.error(
    `[MODEL] Invalid quality "${QUALITY}"; expected fast or sharp.`,
  );
  process.exit(1);
}

for (const [flag, value] of [
  ["--model", SPECIFIC_MODEL],
  ["--input-size", INPUT_SIZE],
  ["--output-dir", OUTPUT_DIR],
]) {
  if (value === "") {
    console.error(`[MODEL] ${flag} requires a value.`);
    process.exit(1);
  }
}

const pythonScript = path.join(
  __dirname,
  QUALITY === "fast" ? "train_espcn_multi.py" : "train_fsrcnn_multi.py",
);

function main() {
  console.log("[MODEL] Starting multi-model generation process...");
  console.log(`[MODEL] Quality mode: ${QUALITY}`);

  const venvPython = path.join(__dirname, "..", ".venv", "bin", "python");

  // Fail fast if virtual environment is not set up — no auto-setup logic.
  if (!fs.existsSync(venvPython)) {
    console.error(
      "[MODEL] Python virtual environment not found at " +
        path.join(__dirname, "..", ".venv") +
        ".",
    );
    console.error("");
    console.error("[MODEL] Run the setup script first:");
    console.error("  bash scripts/train-setup.sh");
    console.error("");
    console.error("[MODEL] Or via npm:");
    console.error("  npm run train:setup");
    process.exit(1);
  }

  try {
    const args = [pythonScript];
    if (FORCE) {
      args.push("--force");
    }
    if (SPECIFIC_MODEL) {
      args.push(`--model=${SPECIFIC_MODEL}`);
    }
    if (INPUT_SIZE) {
      args.push(`--input-size=${INPUT_SIZE}`);
    }
    if (OUTPUT_DIR) {
      args.push(`--output-dir=${OUTPUT_DIR}`);
    }
    if (NO_PERCEPTUAL) {
      args.push("--no-perceptual");
    }
    console.log(`[MODEL] Running training script: ${args.join(" ")}`);
    execFileSync(venvPython, args, {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
    });
    console.log("[MODEL] Multi-model generation completed successfully!");
  } catch (err) {
    console.error("[MODEL] Error during model generation:", err);
    process.exit(1);
  }
}

main();
