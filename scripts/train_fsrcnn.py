#!/usr/bin/env python3
"""FSRCNN (Fast Super-Resolution CNN) training for edge-friendly upscaling.

Single-scale reference trainer. For the full multi-resolution matrix used by
the app, see `train_fsrcnn_multi.py` (this file is kept as a minimal,
self-contained example/experiment trainer).
"""

import os
import sys
import json
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model

FORCE = "--force" in sys.argv

# FSRCNN configurations: input_size -> list of (scale, epochs)
MODEL_CONFIGS = [
    (16, [(4, 150)]),
    (32, [(4, 150)]),
    (48, [(4, 150)]),
    (64, [(4, 150)]),
]


def build_fsrcnn(scale: int, d: int = 56, s: int = 12, m: int = 4):
    """
    Build FSRCNN model.

    Args:
        scale: Upscaling factor
        d: Number of filters in feature extraction / expanding layers
        s: Number of filters in shrinking + mapping layers
        m: Number of mapping layers
    """
    # Feature extraction
    inp = layers.Input(shape=(None, None, 3))
    x = layers.Conv2D(d, 5, padding='same')(inp)
    x = layers.Activation('relu')(x)

    # Shrinking
    x = layers.Conv2D(s, 1, padding='same')(x)
    x = layers.Activation('relu')(x)

    # Mapping (m layers, each with s filters)
    for _ in range(m):
        x = layers.Conv2D(s, 3, padding='same')(x)
        x = layers.Activation('relu')(x)

    # Expanding
    x = layers.Conv2D(d, 1, padding='same')(x)
    x = layers.Activation('relu')(x)

    # Deconvolution (sub-pixel convolution)
    x = layers.Conv2D(scale * scale * 3, 5, padding='same')(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, scale))(x)

    out = layers.Conv2D(3, 5, padding='same', activation='sigmoid')(x)

    return Model(inp, out)


# Cache a single frozen VGG19 instance so the perceptual loss doesn't rebuild
# (and re-download weights for) the network on every call.
_VGG = None


def _get_vgg():
    global _VGG
    if _VGG is None:
        vgg = tf.keras.applications.VGG19(
            include_top=False, weights='imagenet', input_shape=(None, None, 3)
        )
        vgg.trainable = False
        _VGG = vgg
    return _VGG


def perceptual_loss(y_true, y_pred):
    """Perceptual loss using VGG features (reuses one frozen VGG19)."""
    vgg = _get_vgg()

    y_true_vgg = tf.keras.applications.vgg19.preprocess_input(y_true * 255.0)
    y_pred_vgg = tf.keras.applications.vgg19.preprocess_input(y_pred * 255.0)

    features_true = vgg(y_true_vgg)
    features_pred = vgg(y_pred_vgg)

    return tf.reduce_mean(tf.abs(features_true - features_pred))


def combined_loss(y_true, y_pred):
    """MAE + a small perceptual term for sharper edges."""
    mae = tf.reduce_mean(tf.abs(y_true - y_pred))
    return mae + 0.05 * perceptual_loss(y_true, y_pred)


def generate_training_data(input_size: int, scale: int, n: int = 400):
    """Generate simple synthetic HR/LR training pairs."""
    rng = np.random.default_rng(42)
    output_size = input_size * scale
    hr = np.zeros((n, output_size, output_size, 3), dtype=np.float32)
    for i in range(n):
        hr[i] = rng.uniform(0.0, 0.3, size=3)
        fg = rng.uniform(0.6, 1.0, size=3)
        cy, cx = rng.integers(output_size // 4, 3 * output_size // 4, size=2)
        r = rng.integers(output_size // 5, output_size // 3)
        yy, xx = np.mgrid[0:output_size, 0:output_size]
        if rng.random() < 0.5:
            mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
        else:
            mask = (np.abs(xx - cx) <= r) & (np.abs(yy - cy) <= r)
        hr[i][mask] = fg
    lr = tf.image.resize(hr, (input_size, input_size), method="bicubic").numpy()
    return lr, hr


def train_and_export_model(model_dir: str, input_size: int, scale: int, epochs: int):
    """Train and export a single FSRCNN model."""
    output_size = input_size * scale
    # Use a `fsrcnn_ref_` prefix so these reference/experiment exports cannot
    # collide with the production `fsrcnn_<in>x_<out>x.tflite` outputs (from
    # train_fsrcnn_multi.py) nor match the model-map bundling regex.
    model_name = f"fsrcnn_ref_{input_size}x_{output_size}x.tflite"
    out_path = os.path.join(model_dir, model_name)


    if not FORCE and os.path.exists(out_path):
        size = os.path.getsize(out_path)
        print(f"[SKIP] {model_name} exists ({size} bytes), use --force to retrain")
        return model_name, size

    print(f"\n{'='*50}")
    print(f"[TRAIN] Training {input_size}->{output_size} (scale {scale}x, {epochs} epochs)")

    model = build_fsrcnn(scale)
    optimizer = keras.optimizers.Adam(learning_rate=1e-4, clipnorm=1.0)
    model.compile(optimizer=optimizer, loss=combined_loss)
    print(f"[TRAIN] Model params: {model.count_params()}")

    lr, hr = generate_training_data(input_size, scale)
    perm = np.random.default_rng(1234).permutation(len(lr))
    lr, hr = lr[perm], hr[perm]

    model.fit(lr, hr, batch_size=16, epochs=epochs, verbose=2, validation_split=0.1)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    converter.optimizations = [tf.lite.Optimize.DEFAULT]
    tflite_model = converter.convert()

    with open(out_path, "wb") as f:
        f.write(tflite_model)
    print(f"[TRAIN] WROTE {out_path} ({len(tflite_model)} bytes)")

    return model_name, len(tflite_model)


def main():
    print("FSRCNN Training Script")
    print("Usage: python train_fsrcnn.py [--force]")

    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = os.path.join(script_dir, "..", "assets", "models")
    os.makedirs(model_dir, exist_ok=True)

    results = []
    for input_size, scale_configs in MODEL_CONFIGS:
        for scale, epochs in scale_configs:
            try:
                model_name, size = train_and_export_model(
                    model_dir, input_size, scale, epochs
                )
                results.append({
                    "input_size": input_size,
                    "scale": scale,
                    "output_size": input_size * scale,
                    "file": model_name,
                    "size_bytes": size,
                })
            except Exception as e:
                print(f"[ERROR] Failed to train {input_size}->{input_size*scale}: {e}")

    print(f"\n{'='*50}")
    print(f"[TRAIN] Generated {len(results)} models")


if __name__ == "__main__":
    main()
