"""Tiny ESPCN 2x model - minimal for fast training on CPU."""
import os
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model

SCALE = 2
LR = 32
HR = 64
BATCH = 32
MAX_EPOCHS = 12

def build_espcn():
    inp = layers.Input(shape=(None, None, 3))
    x = layers.Conv2D(16, 3, padding="same", activation="relu")(inp)
    x = layers.Conv2D(SCALE * SCALE * 3, 3, padding="same")(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, SCALE))(x)
    out = layers.Conv2D(3, 3, padding="same", activation="sigmoid")(x)
    return Model(inp, out)

def synth_data(n=1000):
    """Generate synthetic icon-like images with edges and shapes (deterministic).

    These stand in for real high-resolution app icons: flat coloured shapes
    (circles, rectangles) on a contrasting background, exercising real edges
    rather than random pixel noise so the upscaler learns meaningful detail.
    """
    rng = np.random.default_rng(42)
    hr = np.zeros((n, HR, HR, 3), dtype=np.float32)
    for i in range(n):
        # Background colour
        bg = rng.uniform(0.0, 0.3, size=3)
        hr[i] = bg
        # Foreground shape colour
        fg = rng.uniform(0.6, 1.0, size=3)
        cy, cx = rng.integers(HR // 4, 3 * HR // 4, size=2)
        r = rng.integers(HR // 5, HR // 3)
        yy, xx = np.mgrid[0:HR, 0:HR]
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 <= r * r
        if rng.random() < 0.5:
            hr[i, mask] = fg
        else:
            # Square / rectangle region
            half = r
            rect = (
                (np.abs(xx - cx) <= half)
                & (np.abs(yy - cy) <= half)
            )
            hr[i, rect] = fg
    lr = tf.image.resize(hr, (LR, LR), method="bicubic").numpy()
    return lr, hr

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = os.path.join(script_dir, "..", "assets", "models")
    os.makedirs(model_dir, exist_ok=True)
    model = build_espcn()
    model.compile(optimizer="adam", loss="mae")
    print(f"Model params: {model.count_params()}")

    lr, hr = synth_data()
    split = int(len(lr) * 0.9)
    model.fit(lr[:split], hr[:split], batch_size=BATCH, epochs=MAX_EPOCHS, verbose=2)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    tflite_model = converter.convert()

    out = os.path.join(model_dir, "espcn_2x.tflite")
    with open(out, "wb") as f:
        f.write(tflite_model)
    print(f"WROTE {out} ({len(tflite_model)} bytes)")

if __name__ == "__main__":
    main()