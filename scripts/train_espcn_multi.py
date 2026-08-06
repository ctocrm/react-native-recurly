"""Multi-resolution ESPCN model training with perceptual + MS-SSIM loss."""
import os
import sys
import re
import json
import gc
import subprocess
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model
import urllib.request
from io import BytesIO

# Disable XLA globally to prevent MirrorPadGrad compile-time constant errors
tf.config.optimizer.set_jit(False)

# Grow VRAM as needed so one model does not reserve an entire card forever.
_gpus = tf.config.list_physical_devices("GPU")
for _gpu in _gpus:
    try:
        tf.config.experimental.set_memory_growth(_gpu, True)
    except Exception as exc:
        print(f"[TRAIN] Warning: memory growth not set on {_gpu}: {exc}")

# Data-parallel multi-GPU (MirroredStrategy): each card holds a full replica;
# peak VRAM ≈ one card, not N× pooled. Default ON when 2+ GPUs are visible.
# Override: USE_MULTI_GPU=false
_gpu_count = len(_gpus)
_use_multi_gpu = _gpu_count > 1 and os.environ.get("USE_MULTI_GPU", "true").lower() == "true"

if _use_multi_gpu:
    strategy = tf.distribute.MirroredStrategy()
    print(f"[TRAIN] Using MirroredStrategy with {strategy.num_replicas_in_sync} GPUs")
else:
    strategy = tf.distribute.get_strategy()
    print(
        f"[TRAIN] Using single device strategy "
        f"({_gpu_count} GPU(s) visible; multi-GPU default on when count>1, "
        f"USE_MULTI_GPU={os.environ.get('USE_MULTI_GPU', 'true')})"
    )

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
# Epochs scaled for quality: large scales (8x+) get 300+ epochs for ESPCN (small model)
# Capped at 576px output max (largest size used by the app).
MODEL_CONFIGS = [
    # 16px input - baseline (7 scales, up to 512px output)
    (16, [(2, 80), (4, 120), (8, 300), (12, 350), (16, 400), (24, 400), (32, 400)]),
    # 32px input - 6 scales, up to 512px output
    (32, [(2, 80), (4, 120), (6, 150), (8, 250), (12, 300), (16, 350)]),
    # 48px input - 6 scales, up to 576px output
    (48, [(2, 80), (3, 100), (4, 150), (5, 200), (8, 250), (12, 300)]),
    # 64px input - 5 scales, up to 512px output
    (64, [(2, 80), (3, 100), (4, 150), (6, 250), (8, 300)]),
    # 96px input - 5 scales, up to 576px output
    (96, [(2, 80), (3, 100), (4, 150), (5, 200), (6, 250)]),
    # 128px input - 3 scales, up to 512px output
    (128, [(2, 80), (3, 100), (4, 200)]),
    # 192px input - 2 scales, up to 576px output
    (192, [(2, 80), (3, 150)]),
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


def release_gpu_memory(label: str = "") -> None:
    """Drop Keras graphs and VGG so the next model does not OOM on a full card.

    Peak VRAM is one training step on one card (~20GB RTX 4000 Ada), not the
    sum of all models in the matrix. Without this, sequential trains leak until
    RESOURCE_EXHAUSTED / 'Dst tensor is not initialized'.
    """
    global VGG_FEATURES
    VGG_FEATURES = None
    try:
        tf.keras.backend.clear_session()
    except Exception:
        pass
    gc.collect()
    try:
        # Reset policy; next train() re-enables mixed_float16 inside strategy.scope()
        tf.keras.mixed_precision.set_global_policy("float32")
    except Exception:
        pass
    if label:
        print(f"[TRAIN] Released GPU memory after {label}")


def perceptual_loss(y_true, y_pred):
    """Perceptual loss using VGG19 features (normalized by feature map size)."""
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
        # Normalize by number of elements in feature map to keep loss scale consistent
        # across different VGG layers (block1_conv2: 64ch, block2_conv2: 128ch, block3_conv2: 256ch)
        num_elements = tf.cast(tf.size(tf_true), tf.float32)
        loss += tf.reduce_sum(tf.abs(tf_true - tf_pred)) / num_elements
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
            # Match FSRCNN perceptual weight for better feature learning at high scales
            return mae + 0.15 * ssim + 0.05 * perceptual
        return mae + 0.15 * ssim

    return combined_loss


# ---- Model Architecture ----

def build_espcn(scale: int, input_size: int = 16):
    """Build ESPCN model for a specific scale factor with fixed input shape.
    
    Channel capacity and depth scale with upscale factor:
    - 2x-4x: 16 channels, 0 mapping layers (baseline ESPCN)
    - 6x-8x: 32 channels, 0 mapping layers
    - 12x+: 64 channels, 2 mapping layers with residuals (hybrid)
    - 16x+: 80 channels, 2 mapping layers with residuals (hybrid)
    """
    # Scale internal channels and mapping layers with upscale factor
    if scale <= 4:
        channels, mapping_layers = 16, 0
    elif scale <= 8:
        channels, mapping_layers = 32, 0
    elif scale <= 12:
        channels, mapping_layers = 64, 2
    else:  # 16x+
        channels, mapping_layers = 80, 2
    
    inp = layers.Input(shape=(input_size, input_size, 3))
    x = layers.Conv2D(channels, 3, padding="same", activation="relu")(inp)
    
    # Mapping layers with residual connections for high scales (12x+)
    for _ in range(mapping_layers):
        residual = x
        x = layers.Conv2D(channels, 3, padding="same", activation="relu")(x)
        x = layers.Add()([x, residual])
    
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
        # Enable mixed precision for memory efficiency on large models
        tf.keras.mixed_precision.set_global_policy('mixed_float16')
        
        model = build_espcn(scale, input_size)
        
        # Pre-create VGG inside scope so it's replicated across GPUs
        global VGG_FEATURES
        # Disable perceptual loss for very high scales (>=256 output) to save VRAM
        # VGG19 feature extractor consumes significant memory at high resolutions
        use_perceptual = not NO_PERCEPTUAL and output_size < 256
        if use_perceptual and VGG_FEATURES is None:
            VGG_FEATURES = build_vgg_feature_extractor()
            VGG_FEATURES.trainable = False
        
        # Dynamic batch size based on GPU memory and OUTPUT size (VGG processes output_size)
        def get_optimal_batch_size(output_size, num_replicas, use_perceptual_loss):
            """Calculate optimal batch size based on GPU memory and output size."""
            # RTX 4000 Ada 18GB: base batch per GPU
            # VGG processes output_size x output_size images
            # With mixed_float16 and no perceptual loss for high scales, we can go slightly higher
            if output_size >= 512:
                base_per_gpu = 1
            elif output_size >= 384:
                base_per_gpu = 1 if use_perceptual_loss else 2
            elif output_size >= 256:
                base_per_gpu = 2 if use_perceptual_loss else 4
            elif output_size >= 192:
                # VGG@192–240 was OOM at batch 4 on RTX 4000 Ada 20GB (see matrix log)
                base_per_gpu = 2 if use_perceptual_loss else 4
            elif output_size >= 128:
                base_per_gpu = 4 if use_perceptual_loss else 8
            elif output_size >= 64:
                base_per_gpu = 16
            else:
                base_per_gpu = 32
            return base_per_gpu * num_replicas
        
        batch_size = get_optimal_batch_size(output_size, strategy.num_replicas_in_sync, use_perceptual)
        
        # Scale learning rate with batch size for stability
        base_lr = 1e-4
        lr = base_lr * (batch_size / 32)
        
        optimizer = keras.optimizers.Adam(learning_rate=lr, clipnorm=1.0)
        model.compile(optimizer=optimizer, loss=make_combined_loss(output_size, use_perceptual=use_perceptual), jit_compile=False)
        print(f"[TRAIN] Model params: {model.count_params()}")
        print(f"[TRAIN] MS-SSIM scales: {_ssim_scales_for(output_size)} (output {output_size}px)")
        print(f"[TRAIN] Batch size: {batch_size} (per GPU: {batch_size // strategy.num_replicas_in_sync}), LR: {lr:.2e}")
        print(f"[TRAIN] Mixed precision: enabled, Perceptual loss: {'enabled' if use_perceptual else 'disabled (high scale)'}")

        lr_data, hr_data = generate_training_data(input_size, scale)
        # Shuffle to mix real/synthetic
        perm = np.random.default_rng(1234).permutation(len(lr_data))
        lr_data, hr_data = lr_data[perm], hr_data[perm]
        split = int(len(lr_data) * 0.9)

        model.fit(
            lr_data[:split], hr_data[:split],
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
        
        # Use validation data (last 10% of shuffled data) for proper PSNR comparison
        val_lr = lr_data[split:]
        val_hr = hr_data[split:]
        # Use up to 10 validation samples
        n_val = min(10, len(val_lr))
        
        variances = []
        psnrs = []
        bicubic_psnrs = []
        
        for i in range(n_val):
            test_input = val_lr[i:i+1]
            hr_target = val_hr[i:i+1]
            
            interpreter.set_tensor(input_details[0]['index'], test_input.astype(np.float32))
            interpreter.invoke()
            output = interpreter.get_tensor(output_details[0]['index'])
            
            variance = float(np.var(output))
            variances.append(variance)
            
            # Bicubic baseline
            bicubic = tf.image.resize(test_input, (output_size, output_size), method="bicubic").numpy()
            
            # PSNR against actual HR target (not constant gray)
            model_psnr = tf.image.psnr(output, hr_target, max_val=1.0).numpy()
            bicubic_psnr = tf.image.psnr(bicubic, hr_target, max_val=1.0).numpy()
            # tf.image.psnr returns tensor with batch dimension, extract scalar
            psnrs.append(float(model_psnr.item()))
            bicubic_psnrs.append(float(bicubic_psnr.item()))
        
        mean_var = float(np.mean(variances))
        mean_model_psnr = float(np.mean(psnrs))
        mean_bicubic_psnr = float(np.mean(bicubic_psnrs))
        
        print(f"[VALIDATE] Output variance: {mean_var:.6f}")
        print(f"[VALIDATE] Model PSNR: {mean_model_psnr:.2f}dB, Bicubic PSNR: {mean_bicubic_psnr:.2f}dB")
        
        if mean_var < 0.001:
            raise RuntimeError(f"MODEL VALIDATION FAILED: Output variance {mean_var:.6f} too low (constant gray)")
        
        # Model must beat bicubic (any positive margin passes)
        if mean_model_psnr <= mean_bicubic_psnr + 1e-6:
            raise RuntimeError(
                f"MODEL VALIDATION FAILED: Model PSNR {mean_model_psnr:.2f}dB "
                f"not better than bicubic {mean_bicubic_psnr:.2f}dB"
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


def _collect_jobs():
    """Return list of (input_size, scale, epochs) matching CLI filters."""
    target = parse_specific_model(SPECIFIC_MODEL) if SPECIFIC_MODEL else None
    if SPECIFIC_MODEL is not None and target is None:
        return None  # invalid
    jobs = []
    for input_size, scale_configs in MODEL_CONFIGS:
        if INPUT_SIZE is not None and input_size != INPUT_SIZE:
            continue
        for scale, epochs in scale_configs:
            if target:
                t_in, t_out = target
                if input_size != t_in or input_size * scale != t_out:
                    continue
            jobs.append((input_size, scale, epochs))
    return jobs


def _run_jobs_in_subprocesses(jobs, script_path: str) -> int:
    """One OS process per model so process exit frees all VRAM (most reliable)."""
    failures = 0
    ok = 0
    for input_size, scale, epochs in jobs:
        out = input_size * scale
        cmd = [sys.executable, "-u", script_path, f"--model={input_size}_{out}"]
        if FORCE:
            cmd.append("--force")
        if NO_PERCEPTUAL:
            cmd.append("--no-perceptual")
        if OUTPUT_DIR:
            cmd.append(f"--output-dir={OUTPUT_DIR}")
        env = os.environ.copy()
        env["TRAIN_WORKER"] = "1"
        print(f"\n[TRAIN] Subprocess isolate {input_size}->{out} (scale {scale}x, {epochs} ep)")
        print(f"[TRAIN] cmd: {' '.join(cmd)}")
        rc = subprocess.run(cmd, env=env).returncode
        if rc != 0:
            print(f"[ERROR] Subprocess failed {input_size}->{out} exit={rc}")
            failures += 1
        else:
            ok += 1
    print(f"\n{'='*50}")
    print(f"[TRAIN] Subprocess matrix done: {ok} ok, {failures} failed, {len(jobs)} jobs")
    print(f"[TRAIN] Run `node scripts/generate-model-registry.js` to update the registry")
    return failures


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.abspath(__file__)
    model_dir = OUTPUT_DIR if OUTPUT_DIR else os.path.join(script_dir, "..", "assets", "models")
    os.makedirs(model_dir, exist_ok=True)

    jobs = _collect_jobs()
    if jobs is None:
        print("[ERROR] No model configuration matched the requested filters")
        raise SystemExit(1)
    if not jobs:
        print("[ERROR] No model configuration matched the requested filters")
        raise SystemExit(1)

    # Parent matrix run: isolate each model in a fresh process (default).
    # TRAIN_ISOLATE=false → in-process loop with release_gpu_memory between jobs.
    # TRAIN_WORKER=1 → we are already a child; train in-process.
    isolate = os.environ.get("TRAIN_ISOLATE", "true").lower() == "true"
    is_worker = os.environ.get("TRAIN_WORKER", "").lower() in ("1", "true", "yes")
    if isolate and not is_worker and len(jobs) > 1:
        failures = _run_jobs_in_subprocesses(jobs, script_path)
        if failures:
            raise SystemExit(1)
        return

    results = []
    failures = 0
    for input_size, scale, epochs in jobs:
        label = f"{input_size}->{input_size * scale}"
        try:
            model_name, size = train_and_export_model(model_dir, input_size, scale, epochs)
            results.append({
                "input_size": input_size,
                "scale": scale,
                "output_size": input_size * scale,
                "epochs": epochs,
                "file": model_name,
                "size_bytes": size,
            })
        except Exception as e:
            print(f"[ERROR] Failed to train {label}: {e}")
            failures += 1
        finally:
            release_gpu_memory(label)

    print(f"\n{'='*50}")
    print(f"[TRAIN] Generated {len(results)} models this run ({failures} failures)")
    print(f"[TRAIN] Run `node scripts/generate-model-registry.js` to update the registry")

    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
