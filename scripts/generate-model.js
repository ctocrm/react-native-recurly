#!/usr/bin/env node
/**
 * Multi-model generation script for super-resolution models.
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

  // Always invoke the trainer. It checks every selected output file and skips
  // existing models individually, which is reliable for partial and
  // distributed output directories. Registry timestamps cannot prove that a
  // complete quality family is present.

  const venvPath = path.join(__dirname, "..", ".venv");
  const venvPython = path.join(venvPath, "bin", "python");
  const requirementsPath = path.join(__dirname, "..", "requirements.txt");

  // Helper: check if a python command has required packages
  function hasRequiredPackages(pythonPath) {
    try {
      execFileSync(
        pythonPath,
        ["-c", "import numpy; import tensorflow; import PIL"],
        {
          stdio: "pipe",
        },
      );
      return true;
    } catch (e) {
      return false;
    }
  }

  // Run a required environment-setup step, reporting failures through the same
  // clean, actionable [MODEL] Error handling used by the training invocation
  // instead of letting a raw exception escape.
  function runSetupStep(description, file, args) {
    try {
      execFileSync(file, args, { stdio: "inherit" });
    } catch (err) {
      console.error(`[MODEL] Error during ${description}:`, err.message || err);
      process.exit(1);
    }
  }

  // Determine python command with auto-setup logic
  let pythonCmd;

  // 1. Try /tmp/tfenv first (if it has packages)
  const tfEnvPython = "/tmp/tfenv/bin/python";
  if (fs.existsSync(tfEnvPython) && hasRequiredPackages(tfEnvPython)) {
    pythonCmd = tfEnvPython;
    console.log(`[MODEL] Using tfenv python at ${pythonCmd}`);
  }
  // 2. Try .venv (create/install if needed)
  else if (fs.existsSync(venvPython)) {
    if (hasRequiredPackages(venvPython)) {
      pythonCmd = venvPython;
      console.log(`[MODEL] Using venv python at ${pythonCmd}`);
    } else {
      pythonCmd = venvPython;
      console.log(`[MODEL] Setting up Python packages in .venv...`);
      runSetupStep("pip install into .venv", venvPython, [
        "-m",
        "pip",
        "install",
        "-r",
        requirementsPath,
      ]);
      console.log(`[MODEL] Using venv python at ${pythonCmd}`);
    }
  }
  // 3. Create .venv and install packages
  else {
    console.log(`[MODEL] Creating Python virtual environment...`);
    runSetupStep("virtual-environment creation", "python3", [
      "-m",
      "venv",
      venvPath,
    ]);
    pythonCmd = venvPython;
    console.log(`[MODEL] Installing required packages...`);
    runSetupStep("pip install into new .venv", pythonCmd, [
      "-m",
      "pip",
      "install",
      "-r",
      requirementsPath,
    ]);
    console.log(`[MODEL] Using venv python at ${pythonCmd}`);
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
    execFileSync(pythonCmd, args, {
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
