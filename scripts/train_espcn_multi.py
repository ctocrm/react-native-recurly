"""Multi-resolution ESPCN: brand-safe residual SR (aligned with FSRCNN).

MAE + color preserve + stroke-mass + light edge; mild LR degradations.
App applies bilin lerp hybrid at inference. See AI_UPSCALING.md.
"""
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
USE_EDGE_LOSS = "--no-edge" not in sys.argv
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
    # 16px input — proven path; 32x needs extra epochs to beat bicubic
    (16, [(2, 80), (4, 120), (8, 300), (12, 350), (16, 400), (24, 450), (32, 550)]),
    # 32px input
    (32, [(2, 100), (4, 150), (6, 180), (8, 280), (12, 320), (16, 380)]),
    # 48px input
    (48, [(2, 120), (3, 140), (4, 180), (5, 220), (8, 280), (12, 320)]),
    # 64px input
    (64, [(2, 140), (3, 160), (4, 200), (6, 280), (8, 320)]),
    # 96px+ : large-in 2x/3x lose to strong bicubic unless more epochs
    (96, [(2, 250), (3, 250), (4, 280), (5, 300), (6, 320)]),
    (128, [(2, 300), (3, 300), (4, 350)]),
    (192, [(2, 350), (3, 350)]),
    (256, [(2, 400)]),
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

    # mixed_float16: cast to fp32 before VGG / preprocess (labels are fp32)
    y_true = tf.cast(y_true, tf.float32)
    y_pred = tf.cast(y_pred, tf.float32)

    # VGG expects 0-255 images run through preprocessing (RGB->BGR + ImageNet mean)
    y_true_255 = tf.keras.applications.vgg19.preprocess_input(y_true * 255.0)
    y_pred_255 = tf.keras.applications.vgg19.preprocess_input(y_pred * 255.0)

    true_features = VGG_FEATURES(y_true_255)
    pred_features = VGG_FEATURES(y_pred_255)

    loss = 0.0
    for tf_true, tf_pred in zip(true_features, pred_features):
        # Force fp32 — VGG under mixed policy can emit fp16 features; dividing by
        # float32 num_elements then raises: float16 != float32
        tf_true = tf.cast(tf_true, tf.float32)
        tf_pred = tf.cast(tf_pred, tf.float32)
        num_elements = tf.cast(tf.size(tf_true), tf.float32)
        loss += tf.reduce_sum(tf.abs(tf_true - tf_pred)) / num_elements
    return loss / float(len(true_features))


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


def sobel_edge_loss(y_true, y_pred):
    """Mild Sobel L1 — brand-safe (heavy edge thinned Ace / gray wash)."""
    y_true = tf.cast(y_true, tf.float32)
    y_pred = tf.cast(y_pred, tf.float32)
    t = tf.reduce_mean(y_true, axis=-1, keepdims=True)
    p = tf.reduce_mean(y_pred, axis=-1, keepdims=True)
    return tf.reduce_mean(tf.abs(tf.image.sobel_edges(t) - tf.image.sobel_edges(p)))


def color_preserve_loss(y_true, y_pred):
    y_true = tf.cast(y_true, tf.float32)
    y_pred = tf.cast(y_pred, tf.float32)
    mean_l1 = tf.reduce_mean(tf.abs(
        tf.reduce_mean(y_true, axis=[1, 2]) - tf.reduce_mean(y_pred, axis=[1, 2])
    ))
    tb = tf.nn.avg_pool2d(y_true, ksize=5, strides=1, padding="SAME")
    pb = tf.nn.avg_pool2d(y_pred, ksize=5, strides=1, padding="SAME")
    return mean_l1 + tf.reduce_mean(tf.abs(tb - pb))


def stroke_mass_loss(y_true, y_pred):
    """Anti-thin: keep low-pass luma / ink mass (brand stroke weight)."""
    y_true = tf.cast(y_true, tf.float32)
    y_pred = tf.cast(y_pred, tf.float32)
    lt = 0.299 * y_true[..., 0:1] + 0.587 * y_true[..., 1:2] + 0.114 * y_true[..., 2:3]
    lp = 0.299 * y_pred[..., 0:1] + 0.587 * y_pred[..., 1:2] + 0.114 * y_pred[..., 2:3]
    lt_b = tf.nn.avg_pool2d(lt, ksize=7, strides=1, padding="SAME")
    lp_b = tf.nn.avg_pool2d(lp, ksize=7, strides=1, padding="SAME")
    mass_l1 = tf.reduce_mean(tf.abs(lt_b - lp_b))
    area = tf.abs(tf.reduce_mean(1.0 - lt_b) - tf.reduce_mean(1.0 - lp_b))
    return mass_l1 + 0.5 * area


def make_combined_loss(
    output_size: int,
    use_perceptual: bool = True,
    use_edge: bool = True,
    edge_weight: float = 0.08,
    color_weight: float = 0.25,
    mass_weight: float = 0.20,
):
    """Brand-safe: MAE + color + stroke-mass + light edge (+ optional VGG).

    Aligned with train_fsrcnn_multi.py / app bilin-lerp hybrid. See AI_UPSCALING.md.
    """
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
        y_true = tf.cast(y_true, tf.float32)
        y_pred = tf.cast(y_pred, tf.float32)
        y_true = tf.clip_by_value(y_true, 0.0, 1.0)
        y_pred = tf.clip_by_value(y_pred, 0.0, 1.0)
        mae = tf.reduce_mean(tf.abs(y_true - y_pred))
        ssim = ssim_term(y_true, y_pred)
        loss = (
            mae
            + 0.10 * ssim
            + color_weight * color_preserve_loss(y_true, y_pred)
            + mass_weight * stroke_mass_loss(y_true, y_pred)
        )
        if use_edge and USE_EDGE_LOSS:
            loss = loss + edge_weight * sobel_edge_loss(y_true, y_pred)
        if use_perceptual:
            loss = loss + 0.02 * perceptual_loss(y_true, y_pred)
        return loss

    return combined_loss


# ---- Model Architecture ----

def build_espcn(scale: int, input_size: int = 16):
    """Build ESPCN for a fixed input shape.

    Capacity scales with BOTH upscale factor and input size.
    Large-input 2x/3x used to keep the 16-ch toy net (same as 16→32) and lost
    to strong bicubic (~28–31 dB). Bump channels + residual mapping for input≥96.
    """
    # Base capacity by upscale factor
    if scale <= 4:
        channels, mapping_layers = 16, 0
    elif scale <= 8:
        channels, mapping_layers = 32, 0
    elif scale <= 12:
        channels, mapping_layers = 64, 2
    else:  # 16x+
        channels, mapping_layers = 80, 2

    # Large LR inputs: bicubic is already excellent — need more capacity
    if input_size >= 256:
        channels = max(channels, 64)
        mapping_layers = max(mapping_layers, 2)
    elif input_size >= 128:
        channels = max(channels, 48)
        mapping_layers = max(mapping_layers, 2)
    elif input_size >= 96:
        channels = max(channels, 32)
        mapping_layers = max(mapping_layers, 1)

    out_h = input_size * scale
    out_w = input_size * scale
    inp = layers.Input(shape=(input_size, input_size, 3))
    x = layers.Conv2D(channels, 3, padding="same", activation="relu")(inp)

    for _ in range(mapping_layers):
        residual = x
        x = layers.Conv2D(channels, 3, padding="same", activation="relu")(x)
        x = layers.Add()([x, residual])

    # Correct residual: zero-init sub-pixel conv → residual; add bilinear base.
    x = layers.Conv2D(
        scale * scale * 3,
        3,
        padding="same",
        dtype="float32",
        kernel_initializer="zeros",
        bias_initializer="zeros",
        name="subpixel_residual",
    )(x)
    residual = layers.Lambda(
        lambda t: tf.nn.depth_to_space(t, scale),
        output_shape=lambda s: (s[0], s[1] * scale, s[2] * scale, 3),
        name="depth_to_space",
    )(x)
    base = layers.Lambda(
        lambda t: tf.image.resize(t, [out_h, out_w], method="bilinear"),
        output_shape=lambda s: (s[0], out_h, out_w, 3),
        name="bilinear_up",
    )(inp)
    out = layers.Add(dtype="float32", name="residual_add")([base, residual])
    out = layers.Lambda(
        lambda t: tf.clip_by_value(t, 0.0, 1.0),
        output_shape=lambda s: s,
        name="clip01",
        dtype="float32",
    )(out)
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


def _degrade_to_lr(hr_batch: np.ndarray, input_size: int, rng: np.random.Generator) -> np.ndarray:
    """Mild LR (brand-safe): mostly clean bicubic; rare light JPEG. Matches FSRCNN."""
    from PIL import Image
    from io import BytesIO

    n = hr_batch.shape[0]
    lr = np.zeros((n, input_size, input_size, 3), dtype=np.float32)
    for i in range(n):
        img = hr_batch[i]
        method = "bicubic" if rng.random() < 0.80 else str(rng.choice(["area", "bilinear"]))
        small = tf.image.resize(img, (input_size, input_size), method=method).numpy()
        if rng.random() < 0.20:
            q = int(rng.integers(75, 95))
            pil = Image.fromarray(np.clip(small * 255.0, 0, 255).astype(np.uint8), mode="RGB")
            buf = BytesIO()
            pil.save(buf, format="JPEG", quality=q)
            buf.seek(0)
            small = np.asarray(Image.open(buf).convert("RGB"), dtype=np.float32) / 255.0
        lr[i] = np.clip(small, 0.0, 1.0).astype(np.float32)
    return lr


def generate_training_data(input_size: int, scale: int, n: int = 1000):
    """Generate training data for a specific input/output size."""
    output_size = input_size * scale
    hr = generate_real_icon_data(n, output_size)
    n_solid = max(60, n // 10)
    solids = np.zeros((n_solid, output_size, output_size, 3), dtype=np.float32)
    rng = np.random.default_rng(99)
    for i in range(n_solid):
        mode = i % 4
        if mode == 0:
            c = (1.0, 0.1, 0.1)
        elif mode == 1:
            c = (0.1, 1.0, 0.1)
        elif mode == 2:
            c = (0.1, 0.1, 1.0)
        else:
            c = tuple(float(x) for x in rng.uniform(0.15, 0.95, size=3))
        solids[i, ..., 0], solids[i, ..., 1], solids[i, ..., 2] = c
    hr = np.concatenate([hr, solids], axis=0)
    lr = _degrade_to_lr(hr, input_size, np.random.default_rng(7))
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
        # float32 only — mixed_float16 caused fp16/fp32 mismatches in SSIM/VGG/loss
        # under MirroredStrategy (known-good VPS run was float32).
        tf.keras.mixed_precision.set_global_policy("float32")

        model = build_espcn(scale, input_size)

        # Pre-create VGG inside scope so it's replicated across GPUs
        global VGG_FEATURES
        # Perceptual: always for out<256; also large-in low-scale (2x/3x) where
        # bicubic is strongest — those cells failed without VGG. High-scale
        # extreme outs (16→512 etc.) stay MAE+SSIM to save VRAM.
        if NO_PERCEPTUAL:
            use_perceptual = False
        elif output_size < 256:
            use_perceptual = True
        elif scale <= 3 and output_size <= 576:
            # large-in 2x/3x including 192→576 (failed without VGG)
            use_perceptual = True
        else:
            use_perceptual = False
        if use_perceptual and VGG_FEATURES is None:
            VGG_FEATURES = build_vgg_feature_extractor()
            VGG_FEATURES.trainable = False

        def get_optimal_batch_size(output_size, num_replicas, use_perceptual_loss):
            """Calculate optimal batch size based on GPU memory and output size."""
            # RTX 4000 Ada ~20GB: base batch per GPU (VGG uses HR output_size)
            if output_size >= 512:
                base_per_gpu = 1
            elif output_size >= 384:
                base_per_gpu = 1 if use_perceptual_loss else 2
            elif output_size >= 256:
                base_per_gpu = 1 if use_perceptual_loss else 4
            elif output_size >= 192:
                base_per_gpu = 2 if use_perceptual_loss else 4
            elif output_size >= 128:
                base_per_gpu = 4 if use_perceptual_loss else 8
            elif output_size >= 64:
                base_per_gpu = 16
            else:
                base_per_gpu = 32
            return base_per_gpu * num_replicas

        batch_size = get_optimal_batch_size(output_size, strategy.num_replicas_in_sync, use_perceptual)

        # Linear LR scaling with global batch, but never starve small-batch
        # large-image jobs (was 6e-6 → underfit vs ~30dB bicubic).
        base_lr = 1e-4
        lr = max(base_lr * (batch_size / 32.0), 5e-5)
        if input_size >= 96 and scale <= 3:
            lr = max(lr, 1e-4)

        optimizer = keras.optimizers.Adam(learning_rate=lr, clipnorm=1.0)
        model.compile(
            optimizer=optimizer,
            loss=make_combined_loss(output_size, use_perceptual=use_perceptual, use_edge=USE_EDGE_LOSS),
            jit_compile=False,
        )
        print(f"[TRAIN] Model params: {model.count_params()}")
        print(f"[TRAIN] MS-SSIM scales: {_ssim_scales_for(output_size)} (output {output_size}px)")
        print(f"[TRAIN] Batch size: {batch_size} (per GPU: {batch_size // strategy.num_replicas_in_sync}), LR: {lr:.2e}")
        print(f"[TRAIN] Mixed precision: disabled (float32), Perceptual: {'on' if use_perceptual else 'off'}, "
              f"Edge: {'on' if USE_EDGE_LOSS else 'off'} (w=0.08), ColorPreserve+StrokeMass: on")

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

    # Color-preservation gate (NOT Ace-specific): solid R/G/B patches.
    def _color_patches(size: int) -> list[tuple[str, np.ndarray, int]]:
        hi, lo = 1.0, 0.1
        specs = [("R", 0, (hi, lo, lo)), ("G", 1, (lo, hi, lo)), ("B", 2, (lo, lo, hi))]
        out = []
        for name, dom, rgb in specs:
            p = np.zeros((1, size, size, 3), dtype=np.float32)
            p[..., 0], p[..., 1], p[..., 2] = rgb
            out.append((name, p, dom))
        return out

    def _assert_color_ok(label: str, mean_rgb: np.ndarray, dom: int, name: str) -> None:
        if (
            mean_rgb[dom] < 0.55
            or mean_rgb[dom] < mean_rgb[(dom + 1) % 3] + 0.2
            or mean_rgb[dom] < mean_rgb[(dom + 2) % 3] + 0.2
        ):
            raise RuntimeError(
                f"MODEL VALIDATION FAILED: {label} lost {name} color "
                f"(mean RGB={mean_rgb.tolist()}) — general hue collapse, not Ace-specific"
            )

    for name, patch, dom in _color_patches(input_size):
        pred = np.asarray(model.predict(patch, verbose=0), dtype=np.float32)[0]
        m = pred.mean(axis=(0, 1))
        print(
            f"[VALIDATE] Keras {name}-square mean RGB=({m[0]:.3f},{m[1]:.3f},{m[2]:.3f})"
        )
        _assert_color_ok("Keras", m, dom, name)

    keras_path = out_path.replace(".tflite", ".keras")
    model.save(keras_path)
    print(f"[TRAIN] Saved Keras checkpoint {keras_path}")

    # Float TFLite only. Optimize.DEFAULT destroyed color on icon SR (POC).
    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    tflite_model = converter.convert()

    # VALIDATION before write — never leave a losing .tflite in assets/models
    print(f"[VALIDATE] Testing model output variance vs bicubic baseline...")
    try:
        interpreter = tf.lite.Interpreter(model_content=tflite_model)
        interpreter.allocate_tensors()
        input_details = interpreter.get_input_details()
        output_details = interpreter.get_output_details()

        val_lr = lr_data[split:]
        val_hr = hr_data[split:]
        # PSNR gate ignores near-perfect bicubic cases (solids ~140dB poison the mean).
        variances = []
        psnrs = []
        bicubic_psnrs = []
        n_skipped_easy = 0

        for i in range(len(val_hr)):
            test_input = val_lr[i:i+1]
            hr_target = val_hr[i:i+1]
            bicubic = tf.image.resize(test_input, (output_size, output_size), method="bicubic").numpy()
            bicubic_psnr = float(
                np.asarray(tf.image.psnr(bicubic, hr_target, max_val=1.0).numpy()).reshape(-1)[0]
            )
            if bicubic_psnr >= 40.0:
                n_skipped_easy += 1
                continue

            interpreter.set_tensor(input_details[0]['index'], test_input.astype(np.float32))
            interpreter.invoke()
            output = interpreter.get_tensor(output_details[0]['index'])

            variance = float(np.var(output))
            variances.append(variance)
            model_psnr = float(
                np.asarray(tf.image.psnr(output, hr_target, max_val=1.0).numpy()).reshape(-1)[0]
            )
            psnrs.append(model_psnr)
            bicubic_psnrs.append(bicubic_psnr)

        if len(psnrs) < 5:
            raise RuntimeError(
                f"MODEL VALIDATION FAILED: only {len(psnrs)} hard val samples "
                f"(need >=5); check training data"
            )

        mean_var = float(np.mean(variances))
        mean_model_psnr = float(np.mean(psnrs))
        mean_bicubic_psnr = float(np.mean(bicubic_psnrs))
        win_rate = float(np.mean([m > b for m, b in zip(psnrs, bicubic_psnrs)]))

        print(
            f"[VALIDATE] PSNR on {len(psnrs)} hard val samples "
            f"(skipped {n_skipped_easy} easy/solid where bicubic>=40dB)"
        )
        print(f"[VALIDATE] Output variance: {mean_var:.6f}")
        print(
            f"[VALIDATE] Model PSNR: {mean_model_psnr:.2f}dB, Bicubic PSNR: {mean_bicubic_psnr:.2f}dB "
            f"(delta {mean_model_psnr - mean_bicubic_psnr:+.2f}dB, win_rate {win_rate:.0%})"
        )

        if mean_var < 0.001:
            raise RuntimeError(f"MODEL VALIDATION FAILED: Output variance {mean_var:.6f} too low (constant gray)")

        if mean_model_psnr <= mean_bicubic_psnr + 1e-6:
            raise RuntimeError(
                f"MODEL VALIDATION FAILED: Model PSNR {mean_model_psnr:.2f}dB "
                f"not better than bicubic {mean_bicubic_psnr:.2f}dB "
                f"(hard samples only, bicubic<40dB)"
            )

        print(f"[VALIDATE] PASSED - Model beats bicubic baseline by {mean_model_psnr - mean_bicubic_psnr:.2f}dB + RGB color OK")
    except Exception as e:
        if "MODEL VALIDATION FAILED" in str(e):
            if os.path.exists(out_path):
                os.remove(out_path)
                print(f"[VALIDATE] Removed failed artifact {out_path}")
            raise
        print(f"[VALIDATE] Warning: Could not validate model: {e}")

    with open(out_path, "wb") as f:
        f.write(tflite_model)
    print(f"[TRAIN] WROTE {out_path} ({len(tflite_model)} bytes)")

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
