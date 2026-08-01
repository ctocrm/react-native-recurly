"""Multi-resolution ESPCN model training with optimized epochs per scale ratio."""
import os
import sys
import re
import json
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model
import urllib.request
from io import BytesIO

FORCE = "--force" in sys.argv
SPECIFIC_MODEL = None
INPUT_SIZE = None
OUTPUT_DIR = None
for arg in sys.argv:
    if arg.startswith("--model="):
        SPECIFIC_MODEL = arg.split("=")[1]
    elif arg.startswith("--input-size="):
        INPUT_SIZE = int(arg.split("=")[1])
    elif arg.startswith("--output-dir="):
        OUTPUT_DIR = arg.split("=")[1]

# Model configurations: input_size -> list of (scale, epochs) tuples
# Scale = output_size / input_size
# Epochs scaled to match 16px baseline: target_output / 16 * base_epochs
# All input sizes now have 7 scales (2x through 32x where output <= 1024)
# and epochs proportional to output resolution.
MODEL_CONFIGS = [
    # 16px input - baseline (7 scales, up to 512px output)
    (16, [(2, 40), (4, 64), (8, 80), (12, 100), (16, 120), (24, 130), (32, 150)]),
    # 32px input - 7 scales, up to 512px output
    (32, [(2, 35), (4, 60), (6, 70), (8, 80), (12, 100), (16, 120), (24, 130)]),
    # 48px input - 7 scales, up to 576px output
    (48, [(2, 40), (3, 60), (4, 70), (5, 80), (8, 100), (12, 120), (16, 150)]),
    # 64px input - 7 scales, up to 512px output
    (64, [(2, 40), (3, 60), (4, 70), (6, 80), (8, 100), (12, 120), (16, 150)]),
    # 96px input - 7 scales, up to 576px output
    (96, [(2, 50), (3, 60), (4, 70), (5, 80), (6, 90), (8, 100), (12, 120)]),
    # 128px input - 7 scales, up to 512px output
    (128, [(2, 40), (3, 50), (4, 70), (6, 90), (8, 100), (12, 120), (16, 150)]),
    # 192px input - 7 scales, up to 576px output
    (192, [(2, 40), (3, 60), (4, 70), (6, 90), (8, 100), (12, 120), (16, 150)]),
    # 256px input - 7 scales, up to 1024px output (match 16px pattern)
    (256, [(2, 100), (3, 120), (4, 140), (6, 160), (8, 180), (12, 200), (16, 220)]),
]


# Icon sources for real training data
ICON_SOURCES = [
    # Simple Icons CDN URLs (these are actual brand icons)
    "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/{}.svg",
    # Tabler Icons
    "https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/{}.svg",
]

# Popular brand names for training data
TRAINING_BRANDS = [
    "netflix", "spotify", "github", "figma", "notion", "dropbox", "google",
    "microsoft", "apple", "amazon", "hulu", "disney", "youtube",
    "twitter", "instagram", "linkedin", "facebook", "slack", "discord",
    "zoom", "shopify", "stripe", "paypal", "airbnb", "uber", "lyft",
    "adobe", "canva", "openai", "claude", "medium",
]


def augment_icon(img: np.ndarray, rng) -> np.ndarray:
    """Apply light random augmentations to an RGB float (0-1) icon.

    Mirrors the augmentation used in the FSRCNN pipeline so a small set of real
    icons yields varied training samples instead of exact duplicates.
    """
    out = img
    if rng.random() < 0.5:
        out = out[:, ::-1, :]  # horizontal flip
    if rng.random() < 0.5:
        out = out[::-1, :, :]  # vertical flip
    k = int(rng.integers(0, 4))
    if k:
        out = np.rot90(out, k=k, axes=(0, 1))  # 0/90/180/270 rotation
    factor = float(rng.uniform(0.85, 1.15))  # brightness jitter
    out = np.clip(out * factor, 0.0, 1.0)
    return np.ascontiguousarray(out, dtype=np.float32)


def build_espcn(scale: int, input_size: int = 16):

    """Build ESPCN model for a specific scale factor with fixed input shape."""
    inp = layers.Input(shape=(input_size, input_size, 3))
    x = layers.Conv2D(16, 3, padding="same", activation="relu")(inp)
    x = layers.Conv2D(scale * scale * 3, 3, padding="same")(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, scale))(x)
    out = layers.Conv2D(3, 3, padding="same", activation="sigmoid")(x)
    return Model(inp, out)


def fetch_svg_icon(slug: str) -> bytes | None:
    """Fetch SVG icon from CDN sources."""
    for template in ICON_SOURCES:
        url = template.format(slug)
        try:
            req = urllib.request.Request(
                url,
                headers={"User-Agent": "Mozilla/5.0"},
            )
            with urllib.request.urlopen(req, timeout=5) as response:
                return response.read()
        except Exception:
            continue
    return None


def rasterize_svg_to_png(svg_bytes: bytes, size: int) -> np.ndarray | None:
    """Rasterize SVG to PNG at specified size using cairosvg if available, else skip."""
    try:
        import cairosvg
        png_data = cairosvg.svg2png(bytestring=svg_bytes, output_width=size, output_height=size)
        from PIL import Image
        img = Image.open(BytesIO(png_data))
        arr = np.array(img.convert("RGBA"))
        return arr.astype(np.float32) / 255.0
    except ImportError:
        # If cairosvg not available, generate synthetic data
        return None


def generate_real_icon_data(n: int, target_size: int) -> np.ndarray:
    """Generate training data from real icons (fallback to synthetic if unavailable)."""
    rng = np.random.default_rng(42)
    hr_images = np.zeros((n, target_size, target_size, 3), dtype=np.float32)

    # Cache rasterized real icons so we can reuse and augment them without
    # re-fetching the same brand repeatedly.
    real_icon_cache: list[np.ndarray] = []
    # Track the next brand to attempt independently of the cache: a failed
    # fetch/rasterization must still advance so we don't retry the same broken
    # brand forever (and so every brand gets at most one attempt).
    brand_attempts = 0
    real_count = 0
    synthetic_count = 0
    target_real = n // 2  # aim for a half-real, half-synthetic distribution

    for i in range(n):
        if real_count < target_real:
            base = None
            # Attempt the next un-tried brand first, then fall back to reusing an
            # already-cached icon (augmented) so we don't keep re-selecting the
            # same brand sequence without variation.
            if brand_attempts < len(TRAINING_BRANDS):
                brand = TRAINING_BRANDS[brand_attempts]
                brand_attempts += 1
                svg = fetch_svg_icon(brand)
                if svg:
                    rasterized = rasterize_svg_to_png(svg, target_size)
                    if rasterized is not None:
                        if rasterized.shape[-1] == 4:
                            # Composite over white background
                            alpha = rasterized[..., 3:4]
                            base = rasterized[..., :3] * alpha + (1 - alpha)
                        else:
                            base = rasterized[..., :3]
                        base = base.astype(np.float32)
                        real_icon_cache.append(base)
                        print(f"[TRAIN] Got real icon: {brand}")


            if base is None and real_icon_cache:
                base = real_icon_cache[int(rng.integers(0, len(real_icon_cache)))]

            if base is not None:
                # Augment every real sample so repeated brands still add variety.
                hr_images[i] = augment_icon(base, rng)
                real_count += 1
                continue

        # Synthetic fallback (same as original)
        bg = rng.uniform(0.0, 0.3, size=3)
        hr_images[i] = bg
        fg = rng.uniform(0.6, 1.0, size=3)
        cy, cx = rng.integers(target_size // 4, 3 * target_size // 4, size=2)
        r = rng.integers(target_size // 5, target_size // 3)
        yy, xx = np.mgrid[0:target_size, 0:target_size]
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
        if rng.random() < 0.5:
            hr_images[i, mask] = fg
        else:
            half = r
            rect = ((np.abs(xx - cx) <= half) & (np.abs(yy - cy) <= half))
            hr_images[i, rect] = fg
        synthetic_count += 1

    print(
        f"[TRAIN] Generated {n} images for size {target_size} "
        f"({real_count} real/augmented from {len(real_icon_cache)} icons, "
        f"{synthetic_count} synthetic)"
    )
    return hr_images



def generate_training_data(input_size: int, scale: int, n: int = 1000):
    """Generate training data for a specific input/output size."""
    output_size = input_size * scale

    # Generate high-res images
    hr = generate_real_icon_data(n, output_size)

    # Downscale to create low-res inputs
    lr = tf.image.resize(hr, (input_size, input_size), method="bicubic").numpy()

    return lr, hr


def train_and_export_model(model_dir: str, input_size: int, scale: int, epochs: int):
    """Train and export a single model."""
    output_size = input_size * scale

    # Skip if model already exists and not forced
    model_name = f"espcn_{input_size}x_{output_size}x.tflite"
    out_path = os.path.join(model_dir, model_name)
    if not FORCE and os.path.exists(out_path):
        size = os.path.getsize(out_path)
        print(f"[SKIP] {model_name} exists ({size} bytes), use --force to retrain")
        return model_name, size

    print(f"\n{'='*50}")
    print(f"[TRAIN] Training {input_size}->{output_size} (scale {scale}x, {epochs} epochs)")

    model = build_espcn(scale, input_size)
    model.compile(optimizer="adam", loss="mae")
    print(f"[TRAIN] Model params: {model.count_params()}")

    lr, hr = generate_training_data(input_size, scale)
    split = int(len(lr) * 0.9)

    model.fit(lr[:split], hr[:split], batch_size=32, epochs=epochs, verbose=2)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    # Optimize for size
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()

    model_name = f"espcn_{input_size}x_{output_size}x.tflite"
    out_path = os.path.join(model_dir, model_name)
    with open(out_path, "wb") as f:
        f.write(tflite_model)
    print(f"[TRAIN] WROTE {out_path} ({len(tflite_model)} bytes)")

    # VALIDATION: Test model output variance to catch constant-gray models
    print(f"[VALIDATE] Testing model output variance...")
    try:
        import numpy as np
        interpreter = tf.lite.Interpreter(model_content=tflite_model)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        
        # Test with random input
        test_input = np.random.rand(1, input_size, input_size, 3).astype(np.float32)
        interpreter.set_tensor(input_details[0]['index'], test_input)
        interpreter.invoke()
        output = interpreter.get_tensor(output_details[0]['index'])
        
        # Check variance - constant gray has variance ~0
        variance = float(np.var(output))
        mean_val = float(np.mean(output))
        print(f"[VALIDATE] Output mean: {mean_val:.4f}, variance: {variance:.6f}")
        
        if variance < 0.001:
            raise RuntimeError(f"MODEL VALIDATION FAILED: Output variance {variance:.6f} too low (constant gray detected). Mean: {mean_val:.4f}")
        
        print(f"[VALIDATE] PASSED - Model produces varied output")
    except Exception as e:
        if "MODEL VALIDATION FAILED" in str(e):
            raise
        print(f"[VALIDATE] Warning: Could not validate model: {e}")

    return model_name, len(tflite_model)


def parse_specific_model(spec: str):
    """Parse --model= input_size_output_size into (input_size, output_size)."""
    nums = re.findall(r"\d+", spec)
    if len(nums) >= 2:
        return int(nums[0]), int(nums[1])
    return None


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = OUTPUT_DIR if OUTPUT_DIR else os.path.join(script_dir, "..", "assets", "models")
    os.makedirs(model_dir, exist_ok=True)

    # Load or initialize model registry
    registry_path = os.path.join(model_dir, "model_registry.json")

    results = []
    matched_configs = 0
    failures = 0

    target = parse_specific_model(SPECIFIC_MODEL) if SPECIFIC_MODEL else None
    invalid_target = SPECIFIC_MODEL is not None and target is None

    for input_size, scale_configs in MODEL_CONFIGS:
        if invalid_target:
            break
        # Skip if --input-size is set and doesn't match
        if INPUT_SIZE is not None and input_size != INPUT_SIZE:
            continue
        for scale, epochs in scale_configs:
            if target:
                t_in, t_out = target
                if input_size != t_in or input_size * scale != t_out:
                    continue
            matched_configs += 1
            try:
                model_name, size = train_and_export_model(model_dir, input_size, scale, epochs)
                results.append({
                    "input_size": input_size,
                    "scale": scale,
                    "output_size": input_size * scale,
                    "epochs": epochs,
                    "file": model_name,
                    "size_bytes": size
                })
            except Exception as e:
                print(f"[ERROR] Failed to train {input_size}->{input_size*scale}: {e}")
                failures += 1

    if matched_configs == 0:
        print("[ERROR] No model configuration matched the requested filters")
        failures += 1

    print(f"\n{'='*50}")
    print(f"[TRAIN] Generated {len(results)} models this run")
    print(f"[TRAIN] Run `node scripts/generate-model-registry.js` to update the registry")

    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
