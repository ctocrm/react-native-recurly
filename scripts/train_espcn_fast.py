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
    hr = np.random.rand(n, HR, HR, 3).astype(np.float32)
    hr = tf.image.resize(tf.image.resize(hr, (8, 8)), (HR, HR)).numpy()
    lr = tf.image.resize(hr, (LR, LR), method="bicubic").numpy()
    return lr, hr

def main():
    os.makedirs("/home/d/Desktop/jsmastery/assets/models", exist_ok=True)
    model = build_espcn()
    model.compile(optimizer="adam", loss="mae")
    print(f"Model params: {model.count_params()}")

    lr, hr = synth_data()
    split = int(len(lr) * 0.9)
    model.fit(lr[:split], hr[:split], batch_size=BATCH, epochs=MAX_EPOCHS, verbose=2)

    converter = tf.lite.TFLiteConverter.from_keras_model(model)
    tflite_model = converter.convert()

    out = "/home/d/Desktop/jsmastery/assets/models/espcn_2x.tflite"
    with open(out, "wb") as f:
        f.write(tflite_model)
    print(f"WROTE {out} ({len(tflite_model)} bytes)")

if __name__ == "__main__":
    main()