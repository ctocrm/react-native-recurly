Run these commands **in this order** from the updated project:

```bash
cd /home/d/Desktop/jsmastery
```

### 1. Generate every Fast model — 32 models

```bash
node scripts/generate-model.js --quality=fast --force --output-dir=/home/d/Desktop/jsmastery/assets/models
```

### 2. Generate every Sharp model — 33 models

```bash
node scripts/generate-model.js --quality=sharp --force --output-dir=/home/d/Desktop/jsmastery/assets/models
```

Do **not** use `--no-perceptual` for this production build.

### 3. Confirm all 65 models exist

```bash
test "$(find assets/models -maxdepth 1 -name 'espcn_*.tflite' | wc -l)" -eq 32
```

```bash
test "$(find assets/models -maxdepth 1 -name 'fsrcnn_*.tflite' | wc -l)" -eq 33
```

```bash
echo "All 65 models exist"
```

If either `test` command fails, stop and do not build.

### 4. Generate the model map

```bash
npm run generate-model-map
```

It must report:

```text
65 models: 32 espcn, 33 fsrcnn
```

### 5. Build all four release APK architectures

```bash
npm run build:android:all
```

Final APKs:

```text
app-release-arm64-v8a.apk
app-release-armeabi-v7a.apk
app-release-x86.apk
app-release-x86_64.apk
```

That is the complete procedure. These commands use the same `assets/models` directory, the model map is generated from that directory, and the build bundles that generated map.

You are right. You asked for **one separate command per model** so each call can run independently. Here are the exact commands.

```bash
cd /home/d/Desktop/jsmastery
```

## Fast — 32 separate commands

```bash
node scripts/generate-model.js --quality=fast --model=16_64   --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=16_128  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=16_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=16_256  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=16_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=16_512  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=fast --model=32_64   --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=32_128  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=32_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=32_256  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=32_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=32_512  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=fast --model=48_96   --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=48_144  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=48_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=48_240  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=48_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=48_576  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=fast --model=64_128  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=64_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=64_256  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=64_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=64_512  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=fast --model=96_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=96_288  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=96_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=96_480  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=fast --model=128_256 --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=128_384 --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=fast --model=192_384 --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=fast --model=192_576 --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=fast --model=256_512 --force --output-dir=/home/d/Desktop/jsmastery/assets/models
```

## Sharp — 33 separate commands

Do not add `--no-perceptual`.

```bash
node scripts/generate-model.js --quality=sharp --model=16_64   --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=16_128  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=16_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=16_256  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=16_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=16_512  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=sharp --model=32_64   --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=32_128  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=32_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=32_256  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=32_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=32_512  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=sharp --model=48_96   --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=48_144  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=48_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=48_240  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=48_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=48_576  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=sharp --model=64_128  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=64_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=64_256  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=64_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=64_512  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=sharp --model=96_192  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=96_288  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=96_384  --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=96_480  --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=sharp --model=128_256 --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=128_384 --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=128_512 --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=sharp --model=192_384 --force --output-dir=/home/d/Desktop/jsmastery/assets/models
node scripts/generate-model.js --quality=sharp --model=192_576 --force --output-dir=/home/d/Desktop/jsmastery/assets/models

node scripts/generate-model.js --quality=sharp --model=256_512 --force --output-dir=/home/d/Desktop/jsmastery/assets/models
```

## Verify, generate map, build

```bash
test "$(find assets/models -maxdepth 1 -name 'espcn_*.tflite' | wc -l)" -eq 32
```

```bash
test "$(find assets/models -maxdepth 1 -name 'fsrcnn_*.tflite' | wc -l)" -eq 33
```

```bash
npm run generate-model-map
```

```bash
npm run build:android:all
```

These are **65 independent model calls**, followed by the model-map call and the all-architecture build call.
