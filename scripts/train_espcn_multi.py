"""Multi-resolution ESPCN model training with optimized epochs per scale ratio."""
import os
import sys
import json
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model
import urllib.request
from io import BytesIO

FORCE = "--force" in sys.argv

# Model configurations: input_size -> list of (scale, epochs) tuples
# Scale = output_size / input_size
# Epochs optimized based on scale complexity
MODEL_CONFIGS = [
    # 16px input
    (16, [(4, 64), (8, 80), (12, 100), (16, 120), (24, 130), (32, 150)]),
    # 32px input
    (32, [(2, 35), (4, 60), (6, 70), (8, 80), (12, 100), (16, 120)]),
    # 48px input
    (48, [(2, 40), (3, 60), (4, 70), (5, 80), (8, 100), (12, 120)]),
    # 64px input
    (64, [(2, 40), (3, 60), (4, 70), (6, 80), (8, 100)]),
    # 96px input
    (96, [(1, 30), (2, 50), (3, 60), (4, 70), (5, 80)]),
    # 128px input
    (128, [(1, 25), (2, 40), (3, 50), (4, 60)]),
    # 192px input
    (192, [(1, 25), (2, 40), (3, 60)]),
    # 256px input
    (256, [(1, 25), (2, 40)]),
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
    "microsoft", "apple", "amazon", "netflix", "hulu", "disney", "youtube",
    "twitter", "instagram", "linkedin", "facebook", "slack", "discord",
    "zoom", "shopify", "stripe", "paypal", "airbnb", "uber", "lyft",
]


def calculate_epochs(scale_ratio: int) -> int:
    """Calculate optimal epochs based on scale ratio."""
    if scale_ratio <= 2:
        return 35
    elif scale_ratio <= 4:
        return 60
    elif scale_ratio <= 6:
        return 75
    elif scale_ratio <= 8:
        return 85
    else:
        return 100


def build_espcn(scale: int):
    """Build ESPCN model for a specific scale factor."""
    inp = layers.Input(shape=(None, None, 3))
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
    
    real_count = 0
    for i in range(n):
        if real_count < n // 2:  # Try to get half real, half synthetic
            brand = TRAINING_BRANDS[i % len(TRAINING_BRANDS)]
            svg = fetch_svg_icon(brand)
            if svg:
                rasterized = rasterize_svg_to_png(svg, target_size)
                if rasterized is not None:
                    # Ensure RGB (drop alpha if present)
                    if rasterized.shape[-1] == 4:
                        # Composite over white background
                        alpha = rasterized[..., 3:4]
                        rgb = rasterized[..., :3] * alpha + (1 - alpha)
                        hr_images[i] = rgb
                    else:
                        hr_images[i] = rasterized[..., :3]
                    real_count += 1
                    print(f"[TRAIN] Got real icon: {brand}")
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
        real_count += 1  # Count synthetic too
    
    print(f"[TRAIN] Generated {real_count} images for size {target_size}")
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
    
    print(f"\n{'='*50}")
    print(f"[TRAIN] Training {input_size}->{output_size} (scale {scale}x, {epochs} epochs)")
    
    model = build_espcn(scale)
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

    # Skip if model already exists and not forced
    if not FORCE and os.path.exists(out_path):
        size = os.path.getsize(out_path)
        print(f"[SKIP] {model_name} exists ({size} bytes), use --force to retrain")
        return model_name, size
    with open(out_path, "wb") as f:
        f.write(tflite_model)
    print(f"[TRAIN] WROTE {out_path} ({len(tflite_model)} bytes)")
    
    return model_name, len(tflite_model)


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = os.path.join(script_dir, "..", "assets", "models")
    os.makedirs(model_dir, exist_ok=True)
    
    # Load or initialize model registry
    registry_path = os.path.join(model_dir, "model_registry.json")
    
    results = []
    
    for input_size, scale_configs in MODEL_CONFIGS:
        for scale, epochs in scale_configs:
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
    
    # Save registry
    registry = {
        "models": results,
        "total_size_bytes": sum(r["size_bytes"] for r in results)
    }
    
    with open(registry_path, "w") as f:
        json.dump(registry, f, indent=2)
    
    print(f"\n{'='*50}")
    print(f"[TRAIN] Generated {len(results)} models, total ~{registry['total_size_bytes'] // 1024}KB")
    print(f"[TRAIN] Registry saved to {registry_path}")


if __name__ == "__main__":
    main()