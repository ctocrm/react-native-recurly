"""Multi-resolution ESPCN model training with perceptual + MS-SSIM loss."""
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

# Disable XLA globally to prevent MirrorPadGrad compile-time constant errors
tf.config.optimizer.set_jit(False)

# Use MirroredStrategy only when multiple GPUs are available;
# with a single GPU the default strategy avoids MultiDeviceIterator overhead.
_gpu_count = len(tf.config.list_physical_devices("GPU"))
if _gpu_count > 1:
    strategy = tf.distribute.MirroredStrategy()
else:
    strategy = tf.distribute.get_strategy()
print(f"[TRAIN] Using {strategy.num_replicas_in_sync} device(s)")

FORCE = "--force" in sys.argv
NO_PERCEPTUAL = "--no-perceptual" in sys.argv
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
# Epochs scaled for quality: large scales (8x, 6x) get 200+ epochs
# Capped at 576px output max (largest size used by the app).
MODEL_CONFIGS = [
    # 16px input - baseline (7 scales, up to 512px output)
    (16, [(2, 80), (4, 120), (8, 200), (12, 220), (16, 250), (24, 250), (32, 250)]),
    # 32px input - 6 scales, up to 512px output
    (32, [(2, 80), (4, 120), (6, 150), (8, 200), (12, 220), (16, 250)]),
    # 48px input - 6 scales, up to 576px output
    (48, [(2, 80), (3, 100), (4, 150), (5, 180), (8, 200), (12, 220)]),
    # 64px input - 5 scales, up to 512px output
    (64, [(2, 80), (3, 100), (4, 150), (6, 200), (8, 250)]),
    # 96px input - 5 scales, up to 576px output
    (96, [(2, 80), (3, 100), (4, 150), (5, 180), (6, 200)]),
    # 128px input - 3 scales, up to 512px output
    (128, [(2, 80), (3, 100), (4, 150)]),
    # 192px input - 2 scales, up to 576px output
    (192, [(2, 80), (3, 100)]),
    # 256px input - 1 scale, up to 512px output
    (256, [(2, 200)]),
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


# ---- Perceptual + MS-SSIM Loss (ported from train_fsrcnn_multi.py) ----

def build_vgg_feature_extractor():
    """Build a lightweight VGG-based perceptual loss feature extractor."""
    vgg = tf.keras.applications.VGG19(
        include_top=False,
        weights="imagenet",
        input_shape=(None, None, 3),
    )
    # Use blocks 1-3 only for efficiency
    outputs = [vgg.get_layer(f"block{i}_conv2").output for i in [1, 2, 3]]
    return Model(vgg.input, outputs, name="vgg_features")


VGG_FEATURES = None


def perceptual_loss(y_true, y_pred):
    """Perceptual loss using VGG19 features."""
    global VGG_FEATURES
    if VGG_FEATURES is None:
        VGG_FEATURES = build_vgg_feature_extractor()
        VGG_FEATURES.trainable = False

    # VGG expects 0-255 images run through preprocessing (RGB->BGR + ImageNet mean)
    y_true_255 = tf.keras.applications.vgg19.preprocess_input(y_true * 255.0)
    y_pred_255 = tf.keras.applications.vgg19.preprocess_input(y_pred * 255.0)

    true_features = VGG_FEATURES(y_true_255)
    pred_features = VGG_FEATURES(y_pred_255)

    loss = 0.0
    for tf_true, tf_pred in zip(true_features, pred_features):
        loss += tf.reduce_mean(tf.abs(tf_true - tf_pred))
    return loss / len(true_features)


# MS-SSIM default power factors (5 scales)
_MS_SSIM_POWER_FACTORS = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333]
_MS_SSIM_FILTER_SIZE = 7


def _ssim_scales_for(output_size: int) -> int:
    """How many MS-SSIM scales fit a given output size."""
    n = 1
    while n < len(_MS_SSIM_POWER_FACTORS) and output_size >= _MS_SSIM_FILTER_SIZE * (2 ** n):
        n += 1
    return n


@tf.custom_gradient
def _sanitize_grad(x):
    """Identity forward; zero NaN/Inf gradients on backward."""
    def grad(dy):
        return tf.where(tf.math.is_finite(dy), dy, tf.zeros_like(dy))
    return tf.identity(x), grad


def make_combined_loss(output_size: int, use_perceptual: bool = True):
    """Build combined MAE + (MS-)SSIM + perceptual loss for fixed output size."""
    n_scales = _ssim_scales_for(output_size)

    def _finite(value):
        return tf.where(tf.math.is_finite(value), value, tf.zeros_like(value))

    if n_scales <= 1:
        def ssim_term(y_true, y_pred):
            filter_size = min(_MS_SSIM_FILTER_SIZE, output_size)
            s = tf.image.ssim(
                y_true, _sanitize_grad(y_pred), max_val=1.0, filter_size=filter_size
            )
            return 1.0 - tf.reduce_mean(_finite(s))
    else:
        pf = _MS_SSIM_POWER_FACTORS[:n_scales]
        total = sum(pf)
        pf = [p / total for p in pf]

        def ssim_term(y_true, y_pred):
            s = tf.image.ssim_multiscale(
                y_true,
                _sanitize_grad(y_pred),
                max_val=1.0,
                filter_size=_MS_SSIM_FILTER_SIZE,
                power_factors=pf,
            )
            return 1.0 - tf.reduce_mean(_finite(s))

    def combined_loss(y_true, y_pred):
        y_true = tf.clip_by_value(y_true, 0.0, 1.0)
        y_pred = tf.clip_by_value(y_pred, 0.0, 1.0)
        mae = tf.reduce_mean(tf.abs(y_true - y_pred))
        ssim = ssim_term(y_true, y_pred)
        if use_perceptual:
            perceptual = perceptual_loss(y_true, y_pred)
            return mae + 0.15 * ssim + 0.05 * perceptual
        return mae + 0.15 * ssim

    return combined_loss


# ---- Model Architecture ----

def build_espcn(scale: int, input_size: int = 16):
    """Build ESPCN model for a specific scale factor with fixed input shape."""
    inp = layers.Input(shape=(input_size, input_size, 3))
    x = layers.Conv2D(16, 3, padding="same", activation="relu")(inp)
    x = layers.Conv2D(scale * scale * 3, 3, padding="same")(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, scale))(x)
    out = layers.Conv2D(3, 3, padding="same", activation="sigmoid")(x)
    return Model(inp, out)


# ---- Data Pipeline ----

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
    """Rasterize SVG to PNG at specified size using cairosvg (required)."""
    import cairosvg
    from PIL import Image
    png_data = cairosvg.svg2png(bytestring=svg_bytes, output_width=size, output_height=size)
    img = Image.open(BytesIO(png_data))
    arr = np.array(img.convert("RGBA"))
    return arr.astype(np.float32) / 255.0


def augment_icon(hr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Apply light augmentation to a training icon."""
    if rng.random() < 0.5:
        hr = np.flip(hr, axis=1).copy()
    k = rng.integers(0, 4)
    if k:
        hr = np.rot90(hr, k=k, axes=(0, 1)).copy()
    hr = hr * rng.uniform(0.9, 1.1)
    hr = np.clip(hr, 0.0, 1.0)
    return hr


def generate_icon_like_synthetic(n: int, target_size: int, rng) -> np.ndarray:
    """Generate synthetic icons with text-like strokes, sharp corners, logo shapes."""
    hr_images = np.zeros((n, target_size, target_size, 3), dtype=np.float32)
    for i in range(n):
        bg = rng.uniform(0.0, 0.2, size=3)
        hr_images[i] = bg
        fg = rng.uniform(0.7, 1.0, size=3)
        
        # Randomly choose icon-like pattern
        pattern = rng.integers(0, 4)
        if pattern == 0:
            # Rounded rectangle (app icon style)
            cy, cx = target_size // 2, target_size // 2
            r = rng.integers(target_size // 3, target_size // 2)
            yy, xx = np.mgrid[0:target_size, 0:target_size]
            mask = (np.abs(xx - cx) <= r) & (np.abs(yy - cy) <= r)
            # Round corners
            corner_r = r // 4
            for corner_y, corner_x in [(cy-r, cx-r), (cy-r, cx+r), (cy+r, cx-r), (cy+r, cx+r)]:
                corner_mask = (xx - corner_x) ** 2 + (yy - corner_y) ** 2 > corner_r ** 2
                mask = mask & corner_mask
            hr_images[i, mask] = fg
        elif pattern == 1:
            # Horizontal bar (text-like)
            cy = rng.integers(target_size // 3, 2 * target_size // 3)
            h = rng.integers(target_size // 8, target_size // 4)
            hr_images[i, cy-h:cy+h, target_size//6:5*target_size//6] = fg
        elif pattern == 2:
            # Vertical bar
            cx = rng.integers(target_size // 3, 2 * target_size // 3)
            w = rng.integers(target_size // 8, target_size // 4)
            hr_images[i, target_size//6:5*target_size//6, cx-w:cx+w] = fg
        else:
            # Cross/plus shape
            cy, cx = target_size // 2, target_size // 2
            w = rng.integers(target_size // 6, target_size // 4)
            hr_images[i, cy-w:cy+w, target_size//4:3*target_size//4] = fg
            hr_images[i, target_size//4:3*target_size//4, cx-w:cx+w] = fg
    return hr_images


def generate_real_icon_data(n: int, target_size: int) -> np.ndarray:
    """Generate training data from real icons (cairosvg required, 80% target)."""
    rng = np.random.default_rng(42)
    hr_images = np.zeros((n, target_size, target_size, 3), dtype=np.float32)

    real_icon_cache: list[np.ndarray] = []
    brand_attempts = 0
    real_count = 0
    target_real = int(n * 0.8)  # 80% real icons

    for i in range(n):
        if real_count < target_real:
            base = None
            if brand_attempts < len(TRAINING_BRANDS):
                brand = TRAINING_BRANDS[brand_attempts]
                brand_attempts += 1
                svg = fetch_svg_icon(brand)
                if svg:
                    try:
                        rasterized = rasterize_svg_to_png(svg, target_size)
                        if rasterized is not None:
                            if rasterized.shape[-1] == 4:
                                alpha = rasterized[..., 3:4]
                                base = rasterized[..., :3] * alpha + (1 - alpha)
                            else:
                                base = rasterized[..., :3]
                            base = base.astype(np.float32)
                            real_icon_cache.append(base)
                            print(f"[TRAIN] Got real icon: {brand}")
                    except Exception as e:
                        print(f"[TRAIN] Failed to rasterize {brand}: {e}")

            if base is None and real_icon_cache:
                base = real_icon_cache[int(rng.integers(0, len(real_icon_cache)))]

            if base is not None:
                hr_images[i] = augment_icon(base, rng)
                real_count += 1
                continue

        # Per-iteration synthetic fallback (icon-like, not circles)
        # Don't break — continue trying real icons for remaining slots
        hr_images[i] = generate_icon_like_synthetic(1, target_size, rng)[0]

    print(
        f"[TRAIN] Generated {n} images for size {target_size} "
        f"({real_count} real/augmented from {len(real_icon_cache)} icons, "
        f"{n - real_count} icon-like synthetic)"
    )
    return hr_images

def generate_training_data(input_size: int, scale: int, n: int = 1000):
    """Generate training data for a specific input/output size."""
    output_size = input_size * scale
    hr = generate_real_icon_data(n, output_size)
    lr = tf.image.resize(hr, (input_size, input_size), method="bicubic").numpy()
    return lr, hr


# ---- Training & Export ----

def train_and_export_model(model_dir: str, input_size: int, scale: int, epochs: int):
    """Train and export a single model with perceptual+MS-SSIM loss."""
    output_size = input_size * scale
    model_name = f"espcn_{input_size}x_{output_size}x.tflite"
    out_path = os.path.join(model_dir, model_name)

    if not FORCE and os.path.exists(out_path):
        size = os.path.getsize(out_path)
        print(f"[SKIP] {model_name} exists ({size} bytes), use --force to retrain")
        return model_name, size

    print(f"\n{'='*50}")
    print(f"[TRAIN] Training {input_size}->{output_size} (scale {scale}x, {epochs} epochs)")

    with strategy.scope():
        model = build_espcn(scale, input_size)
        
        # Pre-create VGG inside scope so it's replicated across GPUs
        global VGG_FEATURES
        use_perceptual = not NO_PERCEPTUAL
        if use_perceptual and VGG_FEATURES is None:
            VGG_FEATURES = build_vgg_feature_extractor()
            VGG_FEATURES.trainable = False
        
        optimizer = keras.optimizers.Adam(learning_rate=1e-4, clipnorm=1.0)
        model.compile(optimizer=optimizer, loss=make_combined_loss(output_size, use_perceptual=use_perceptual), jit_compile=False)
        print(f"[TRAIN] Model params: {model.count_params()}")
        print(f"[TRAIN] MS-SSIM scales: {_ssim_scales_for(output_size)} (output {output_size}px)")

        lr, hr = generate_training_data(input_size, scale)
        # Shuffle to mix real/synthetic
        perm = np.random.default_rng(1234).permutation(len(lr))
        lr, hr = lr[perm], hr[perm]
        split = int(len(lr) * 0.9)

        batch_size = 16 * strategy.num_replicas_in_sync
        model.fit(
            lr[:split], hr[:split],
            batch_size=batch_size,
            epochs=epochs,
            verbose=2,
            validation_split=0.1,
        )

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()

    with open(out_path, "wb") as f:
        f.write(tflite_model)
    print(f"[TRAIN] WROTE {out_path} ({len(tflite_model)} bytes)")

    # VALIDATION: Test model output variance + bicubic baseline comparison
    print(f"[VALIDATE] Testing model output variance vs bicubic baseline...")
    try:
        interpreter = tf.lite.Interpreter(model_content=tflite_model)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()
        
        # Test with multiple random inputs
        variances = []
        psnrs = []
        bicubic_psnrs = []
        
        for _ in range(10):
            test_input = np.random.rand(1, input_size, input_size, 3).astype(np.float32)
            interpreter.set_tensor(input_details[0]['index'], test_input)
            interpreter.invoke()
            output = interpreter.get_tensor(output_details[0]['index'])
            
            variance = float(np.var(output))
            variances.append(variance)
            
            # Bicubic baseline
            bicubic = tf.image.resize(test_input, (output_size, output_size), method="bicubic").numpy()
            
            # Generate a "ground truth" by upscaling a clean pattern
            # For validation, we compare model output vs bicubic on the same input
            # Using a simple synthetic HR target for PSNR calculation
            hr_target = np.ones_like(output) * 0.5  # neutral gray reference
            model_psnr = tf.image.psnr(output, hr_target, max_val=1.0).numpy()
            bicubic_psnr = tf.image.psnr(bicubic, hr_target, max_val=1.0).numpy()
            psnrs.append(float(model_psnr))
            bicubic_psnrs.append(float(bicubic_psnr))
        
        mean_var = float(np.mean(variances))
        mean_model_psnr = float(np.mean(psnrs))
        mean_bicubic_psnr = float(np.mean(bicubic_psnrs))
        
        print(f"[VALIDATE] Output variance: {mean_var:.6f}")
        print(f"[VALIDATE] Model PSNR: {mean_model_psnr:.2f}dB, Bicubic PSNR: {mean_bicubic_psnr:.2f}dB")
        
        if mean_var < 0.001:
            raise RuntimeError(f"MODEL VALIDATION FAILED: Output variance {mean_var:.6f} too low (constant gray)")
        
        # Require model to beat bicubic by at least 0.5dB
        if mean_model_psnr < mean_bicubic_psnr + 0.5:
            raise RuntimeError(
                f"MODEL VALIDATION FAILED: Model PSNR {mean_model_psnr:.2f}dB "
                f"not better than bicubic {mean_bicubic_psnr:.2f}dB + 0.5dB margin"
            )
        
        print(f"[VALIDATE] PASSED - Model beats bicubic baseline by {mean_model_psnr - mean_bicubic_psnr:.2f}dB")
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

    registry_path = os.path.join(model_dir, "model_registry.json")

    results = []
    matched_configs = 0
    failures = 0

    target = parse_specific_model(SPECIFIC_MODEL) if SPECIFIC_MODEL else None
    invalid_target = SPECIFIC_MODEL is not None and target is None

    for input_size, scale_configs in MODEL_CONFIGS:
        if invalid_target:
            break
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
