#!/usr/bin/env node
/**
 * Multi-model generation script for ESPCN super-resolution models.
 *
 * Usage:
 *   node scripts/generate-model.js [--force] [--model N]
 *
 * Options:
 *   --force    Force regeneration even if models exist and are fresh
 *   --model N  Train only a specific model (by input_size_scale, e.g., 16_32 for 16->32)
 */

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const modelDir = path.join(__dirname, "..", "assets", "models");
const pythonScript = path.join(__dirname, "train_espcn_multi.py");
const FORCE = process.argv.includes("--force");
const SPECIFIC_MODEL = process.argv
  .find((arg) => arg.startsWith("--model="))
  ?.split("=")[1];

function fileExists(p) {
  return fs.existsSync(p);
}

function getFileModTime(p) {
  return fs.statSync(p).mtime.getTime();
}

function checkModelsFresh() {
  // Check if registry exists and is fresh
  const registryPath = path.join(modelDir, "model_registry.json");
  if (!fileExists(registryPath)) return false;

  // If specific model requested, check only that model
  if (SPECIFIC_MODEL) {
    const modelFile = `espcn_${SPECIFIC_MODEL.replace("_", "x_")}x.tflite`;
    const modelPath = path.join(modelDir, modelFile);
    if (!fileExists(modelPath)) return false;
    const modelTime = getFileModTime(modelPath);
    const scriptTime = getFileModTime(pythonScript);
    return modelTime > scriptTime;
  }

  // Check registry freshness
  const registryTime = getFileModTime(registryPath);
  const scriptTime = getFileModTime(pythonScript);
  return registryTime > scriptTime;
}

function main() {
  console.log("[MODEL] Starting multi-model generation process...");

  // Check if models exist and are fresh (unless --force)
  if (
    !FORCE &&
    fileExists(modelDir) &&
    fileExists(pythonScript) &&
    checkModelsFresh()
  ) {
    console.log("[MODEL] Models exist and are fresh");
    console.log("[MODEL] Skipping regeneration. Use --force to regenerate.");
    process.exit(0);
  }

  const venvPath = path.join(__dirname, "..", ".venv");
  const venvPython = path.join(venvPath, "bin", "python");
  const requirementsPath = path.join(__dirname, "..", "requirements.txt");

  // Helper: check if a python command has required packages
  function hasRequiredPackages(pythonPath) {
    try {
      execFileSync(pythonPath, ["-c", "import numpy; import tensorflow"], {
        stdio: "pipe",
      });
      return true;
    } catch (e) {
      return false;
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
      execFileSync(
        venvPython,
        ["-m", "pip", "install", "-r", requirementsPath],
        {
          stdio: "inherit",
        },
      );
      console.log(`[MODEL] Using venv python at ${pythonCmd}`);
    }
  }
  // 3. Create .venv and install packages
  else {
    console.log(`[MODEL] Creating Python virtual environment...`);
    execFileSync("python3", ["-m", "venv", venvPath], { stdio: "inherit" });
    pythonCmd = venvPython;
    console.log(`[MODEL] Installing required packages (numpy, tensorflow)...`);
    execFileSync(pythonCmd, ["-m", "pip", "install", "-r", requirementsPath], {
      stdio: "inherit",
    });
    console.log(`[MODEL] Using venv python at ${pythonCmd}`);
  }

  try {
    const args = [pythonScript];
    if (SPECIFIC_MODEL) {
      args.push(`--model=${SPECIFIC_MODEL}`);
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
