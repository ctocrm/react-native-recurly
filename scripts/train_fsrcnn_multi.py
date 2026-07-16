"""Multi-resolution FSRCNN model training with perceptual + MS-SSIM loss."""
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
MODEL_CONFIGS = [
    # 16px input
    (16, [(4, 120), (8, 150), (12, 180), (16, 200), (24, 220), (32, 250)]),
    # 32px input
    (32, [(2, 80), (4, 120), (6, 140), (8, 160), (12, 180), (16, 200)]),
    # 48px input
    (48, [(2, 80), (3, 100), (4, 120), (5, 140), (8, 160), (12, 180)]),
    # 64px input
    (64, [(2, 80), (3, 100), (4, 120), (6, 140), (8, 160)]),
    # 96px input
    (96, [(2, 80), (3, 100), (4, 120), (5, 140)]),
    # 128px input
    (128, [(2, 80), (3, 100), (4, 120)]),
    # 192px input (1x passthrough omitted; depth_to_space scale=1 is invalid)
    (192, [(2, 80), (3, 100)]),
    # 256px input (1x passthrough omitted; depth_to_space scale=1 is invalid)
    (256, [(2, 80)]),
]

# Icon sources for real training data
ICON_SOURCES = [
    "https://cdn.jsdelivr.net/gh/simple-icons/simple-icons/icons/{}.svg",
    "https://raw.githubusercontent.com/tabler/tabler-icons/main/icons/outline/{}.svg",
]

TRAINING_BRANDS = [
    "netflix", "spotify", "github", "figma", "notion", "dropbox", "google",
    "microsoft", "apple", "amazon", "hulu", "disney", "youtube",
    "twitter", "instagram", "linkedin", "facebook", "slack", "discord",
    "zoom", "shopify", "stripe", "paypal", "airbnb", "uber", "lyft",
    "adobe", "canva", "openai", "claude", "medium",
]


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

    # VGG expects 0-255 images run through the model's preprocessing
    # (RGB->BGR + ImageNet mean subtraction) before feature extraction.
    y_true_255 = tf.keras.applications.vgg19.preprocess_input(y_true * 255.0)
    y_pred_255 = tf.keras.applications.vgg19.preprocess_input(y_pred * 255.0)

    true_features = VGG_FEATURES(y_true_255)
    pred_features = VGG_FEATURES(y_pred_255)


    loss = 0.0
    for tf_true, tf_pred in zip(true_features, pred_features):
        loss += tf.reduce_mean(tf.abs(tf_true - tf_pred))
    return loss / len(true_features)


# MS-SSIM default power factors (5 scales). Each additional scale halves the
# image, so the number of usable scales is bounded by the output resolution.
_MS_SSIM_POWER_FACTORS = [0.0448, 0.2856, 0.3001, 0.2363, 0.1333]
_MS_SSIM_FILTER_SIZE = 7


def _ssim_scales_for(output_size: int) -> int:
    """How many MS-SSIM scales fit a given output size.

    `tf.image.ssim_multiscale` downsamples the image by 2 for each extra scale,
    and the Gaussian window (filter_size) must still fit the smallest scale, so
    we need `output_size >= filter_size * 2**(n-1)` for `n` scales. Using the
    full 5 scales on a small (e.g. 64px) output shrinks it to 4px < 7px filter
    and crashes, so we clamp the scale count to what actually fits.
    """
    n = 1
    while n < len(_MS_SSIM_POWER_FACTORS) and output_size >= _MS_SSIM_FILTER_SIZE * (2 ** n):
        n += 1
    return n


@tf.custom_gradient
def _sanitize_grad(x):
    """Identity in the forward pass; zeroes NaN/Inf gradients on the backward.

    `tf.image.ssim_multiscale` yields NaN *gradients* for dissimilar images
    (fractional powers of negative contrast/structure terms) even when its
    forward value is finite. Those NaNs propagate into the weights on the very
    first step and can't be rescued by `clipnorm` (NaN norm -> NaN clip).
    Wrapping the SSIM input with this op replaces the non-finite gradient
    entries with 0, so a degenerate SSIM gradient can't poison training while
    the MAE + perceptual terms still provide a valid learning signal.
    """
    def grad(dy):
        return tf.where(tf.math.is_finite(dy), dy, tf.zeros_like(dy))

    return tf.identity(x), grad


def make_combined_loss(output_size: int, use_perceptual: bool = True):

    """Build a combined MAE + (MS-)SSIM + perceptual loss for a fixed output size.

    The SSIM term adapts to the output resolution: multiscale SSIM when the
    image is large enough, single-scale SSIM otherwise. This keeps the loss
    numerically valid for every model in the matrix (smallest output is 64px).
    """
    n_scales = _ssim_scales_for(output_size)

    def _finite(value):
        """Replace any NaN/Inf entries with 0 before reducing.

        `tf.image.ssim`/`ssim_multiscale` can emit NaN/Inf on flat patches
        (near-zero local variance) or from fractional powers of negative
        contrast terms. Our synthetic icons have large constant backgrounds, so
        this happens on the very first batch and poisons the whole loss into
        NaN. Neutralising the non-finite entries keeps the loss well-defined.
        """
        return tf.where(tf.math.is_finite(value), value, tf.zeros_like(value))

    if n_scales <= 1:
        def ssim_term(y_true, y_pred):
            filter_size = min(_MS_SSIM_FILTER_SIZE, output_size)
            # _sanitize_grad zeroes any NaN/Inf gradient the SSIM op sends back
            # into y_pred (see its docstring); _finite guards the forward value.
            s = tf.image.ssim(
                y_true, _sanitize_grad(y_pred), max_val=1.0, filter_size=filter_size
            )
            return 1.0 - tf.reduce_mean(_finite(s))
    else:
        pf = _MS_SSIM_POWER_FACTORS[:n_scales]
        total = sum(pf)
        pf = [p / total for p in pf]  # renormalise the subset to sum to 1

        def ssim_term(y_true, y_pred):
            # _sanitize_grad zeroes any NaN/Inf gradient MS-SSIM sends back into
            # y_pred (see its docstring); _finite guards the forward value.
            s = tf.image.ssim_multiscale(
                y_true,
                _sanitize_grad(y_pred),
                max_val=1.0,
                filter_size=_MS_SSIM_FILTER_SIZE,
                power_factors=pf,
            )
            return 1.0 - tf.reduce_mean(_finite(s))


    def combined_loss(y_true, y_pred):
        # SSIM/MAE assume values in [0, 1]; clamp so out-of-range predictions
        # (or targets) can't drive the metrics into undefined territory.
        y_true = tf.clip_by_value(y_true, 0.0, 1.0)
        y_pred = tf.clip_by_value(y_pred, 0.0, 1.0)
        mae = tf.reduce_mean(tf.abs(y_true - y_pred))
        ssim = ssim_term(y_true, y_pred)
        if use_perceptual:
            perceptual = perceptual_loss(y_true, y_pred)
            return mae + 0.15 * ssim + 0.05 * perceptual
        return mae + 0.15 * ssim

    return combined_loss




def build_fsrcnn(scale: int, d: int = 32, s: int = 8, m: int = 3):
    """Build FSRCNN model for a specific scale factor."""
    inp = layers.Input(shape=(None, None, 3))

    # Feature extraction
    x = layers.Conv2D(d, 5, padding="same", activation="relu")(inp)

    # Shrinking
    x = layers.Conv2D(s, 1, padding="same", activation="relu")(x)

    # Mapping layers
    for _ in range(m):
        x = layers.Conv2D(s, 3, padding="same", activation="relu")(x)

    # Expanding
    x = layers.Conv2D(d, 1, padding="same", activation="relu")(x)

    # Sub-pixel convolution
    x = layers.Conv2D(scale * scale * 3, 5, padding="same")(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, scale))(x)

    out = layers.Conv2D(3, 5, padding="same", activation="sigmoid")(x)
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
    """Rasterize SVG to PNG at specified size using cairosvg if available."""
    try:
        import cairosvg
        png_data = cairosvg.svg2png(
            bytestring=svg_bytes, output_width=size, output_height=size
        )
        from PIL import Image
        img = Image.open(BytesIO(png_data))
        arr = np.array(img.convert("RGBA"))
        return arr.astype(np.float32) / 255.0
    except Exception:
        return None


def augment_icon(hr: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Apply light augmentation to a training icon."""
    # Random horizontal flip
    if rng.random() < 0.5:
        hr = np.flip(hr, axis=1).copy()
    # Random 90-degree rotation
    k = rng.integers(0, 4)
    if k:
        hr = np.rot90(hr, k=k, axes=(0, 1)).copy()
    # Random brightness/contrast jitter
    hr = hr * rng.uniform(0.9, 1.1)
    hr = np.clip(hr, 0.0, 1.0)
    return hr


def generate_real_icon_data(n: int, target_size: int) -> np.ndarray:
    """Generate training data from real icons (fallback to synthetic)."""
    rng = np.random.default_rng(42)
    hr_images = np.zeros((n, target_size, target_size, 3), dtype=np.float32)

    real_count = 0
    for i in range(n):
        if real_count < n // 2:
            brand = TRAINING_BRANDS[i % len(TRAINING_BRANDS)]
            svg = fetch_svg_icon(brand)
            if svg:
                rasterized = rasterize_svg_to_png(svg, target_size)
                if rasterized is not None:
                    if rasterized.shape[-1] == 4:
                        alpha = rasterized[..., 3:4]
                        rgb = rasterized[..., :3] * alpha + (1 - alpha)
                        hr_images[i] = augment_icon(rgb, rng)
                    else:
                        hr_images[i] = augment_icon(rasterized[..., :3], rng)
                    real_count += 1
                    print(f"[TRAIN] Got real icon: {brand}")
                    continue

        # Synthetic fallback
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
        real_count += 1

    print(f"[TRAIN] Generated {real_count} images for size {target_size}")
    return hr_images


def generate_training_data(input_size: int, scale: int, n: int = 1000):
    """Generate training data for a specific input/output size."""
    output_size = input_size * scale
    hr = generate_real_icon_data(n, output_size)
    lr = tf.image.resize(hr, (input_size, input_size), method="bicubic").numpy()
    return lr, hr


def train_and_export_model(model_dir: str, input_size: int, scale: int, epochs: int):
    """Train and export a single FSRCNN model."""
    output_size = input_size * scale
    model_name = f"fsrcnn_{input_size}x_{output_size}x.tflite"
    out_path = os.path.join(model_dir, model_name)

    if not FORCE and os.path.exists(out_path):
        size = os.path.getsize(out_path)
        print(f"[SKIP] {model_name} exists ({size} bytes), use --force to retrain")
        return model_name, size

    print(f"\n{'='*50}")
    print(f"[TRAIN] Training {input_size}->{output_size} (scale {scale}x, {epochs} epochs)")

    model = build_fsrcnn(scale)
    # A lower learning rate + gradient clipping keeps the combined loss (which
    # includes a large-magnitude VGG perceptual term) from diverging to NaN.
    optimizer = keras.optimizers.Adam(learning_rate=1e-4, clipnorm=1.0)
    use_perceptual = not NO_PERCEPTUAL
    if not use_perceptual:
        print("[TRAIN] Perceptual loss disabled (--no-perceptual) — using MAE + MS-SSIM only")
    model.compile(optimizer=optimizer, loss=make_combined_loss(output_size, use_perceptual=use_perceptual))
    print(f"[TRAIN] Model params: {model.count_params()}")
    print(f"[TRAIN] MS-SSIM scales: {_ssim_scales_for(output_size)} (output {output_size}px)")



    lr, hr = generate_training_data(input_size, scale)
    # Shuffle lr/hr together (preserving pairing) so the tail-based
    # validation_split below mixes real and synthetic samples instead of
    # validating on a synthetic-only tail (real icons are generated first).
    perm = np.random.default_rng(1234).permutation(len(lr))
    lr, hr = lr[perm], hr[perm]
    split = int(len(lr) * 0.9)

    model.fit(

        lr[:split],
        hr[:split],
        batch_size=16,
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
                model_name, size = train_and_export_model(
                    model_dir, input_size, scale, epochs
                )
                results.append({
                    "input_size": input_size,
                    "scale": scale,
                    "output_size": input_size * scale,
                    "epochs": epochs,
                    "file": model_name,
                    "size_bytes": size,
                })
            except Exception as e:
                print(f"[ERROR] Failed to train {input_size}->{input_size*scale}: {e}")
                failures += 1

    if matched_configs == 0:
        print("[ERROR] No model configuration matched the requested filters")
        failures += 1

    # Merge with existing registry instead of overwriting
    existing = {"models": [], "total_size_bytes": 0}
    if os.path.exists(registry_path):
        try:
            with open(registry_path, "r") as f:
                existing = json.load(f)
        except Exception:
            pass

    # Merge: new entries override existing ones with the same file name
    merged_models = [m for m in existing.get("models", []) if m["file"] not in {r["file"] for r in results}]
    merged_models.extend(results)
    total_bytes = sum(m["size_bytes"] for m in merged_models)

    registry = {
        "models": merged_models,
        "total_size_bytes": total_bytes,
    }

    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2)

    print(f"\n{'='*50}")
    print(f"[TRAIN] Generated {len(results)} models this run")
    print(f"[TRAIN] Registry now has {len(merged_models)} models, total ~{total_bytes // 1024}KB")
    print(f"[TRAIN] Registry saved to {registry_path}")

    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    main()