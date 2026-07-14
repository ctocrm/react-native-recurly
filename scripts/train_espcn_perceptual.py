#!/usr/bin/env python3
"""ESPCN training with perceptual loss for better quality upscaling.

Reference/experiment trainer. Outputs are written with an `espcn_perceptual_*`
prefix so they do NOT collide with (or get auto-bundled alongside) the
production ESPCN matrix produced by `train_espcn_multi.py`.
"""

import os
import sys
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model

FORCE = "--force" in sys.argv

# Model configurations - same shape as train_espcn_multi.py
MODEL_CONFIGS = [
    (16, [(4, 200)]),
    (32, [(4, 200)]),
    (48, [(4, 200)]),
    (64, [(4, 200)]),
]


def build_espcn(scale: int):
    """Build ESPCN model for a specific scale factor."""
    inp = layers.Input(shape=(None, None, 3))
    x = layers.Conv2D(64, 3, padding="same", activation="relu")(inp)
    x = layers.Conv2D(64, 3, padding="same", activation="relu")(x)
    x = layers.Conv2D(scale * scale * 3, 3, padding="same")(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, scale))(x)
    out = layers.Conv2D(3, 3, padding="same", activation="sigmoid")(x)
    return Model(inp, out)


# Cache a single frozen VGG19 instance so perceptual_loss doesn't rebuild (and
# re-download weights for) the network on every call.
_VGG = None


def _get_vgg():
    global _VGG
    if _VGG is None:
        vgg = tf.keras.applications.VGG19(include_top=False, weights="imagenet")
        vgg.trainable = False
        _VGG = vgg
    return _VGG


def perceptual_loss(y_true, y_pred):
    """Perceptual loss using VGG features (reuses one frozen VGG19)."""
    vgg = _get_vgg()

    # Process images for VGG (0-255 + RGB->BGR / ImageNet mean subtraction)
    y_true_vgg = tf.keras.applications.vgg19.preprocess_input(y_true * 255.0)
    y_pred_vgg = tf.keras.applications.vgg19.preprocess_input(y_pred * 255.0)

    # Compare features
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
    """Train a perceptual-loss ESPCN and export it to TFLite."""
    output_size = input_size * scale
    model_name = f"espcn_perceptual_{input_size}x_{output_size}x.tflite"
    out_path = os.path.join(model_dir, model_name)

    if not FORCE and os.path.exists(out_path):
        size = os.path.getsize(out_path)
        print(f"[SKIP] {model_name} exists ({size} bytes), use --force to retrain")
        return model_name, size

    print(f"\n{'='*50}")
    print(f"[TRAIN] Training {input_size}->{output_size} (scale {scale}x, {epochs} epochs)")

    model = build_espcn(scale)
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
    print("ESPCN Perceptual Loss Training Script")
    print("Usage: python train_espcn_perceptual.py [--force]")

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
                results.append((model_name, size))
            except Exception as e:
                print(f"[ERROR] Failed to train {input_size}->{input_size*scale}: {e}")

    print(f"\n{'='*50}")
    print(f"[TRAIN] Generated {len(results)} perceptual ESPCN models")


if __name__ == "__main__":
    main()
