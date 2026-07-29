#!/usr/bin/env python3
"""Re-export TFLite models with fixed input shapes.

The existing models were trained with dynamic input shapes (None, None, 3),
which TFLite converts to a default of 1x1. On-device inference fails because
react-native-fast-tflite doesn't call resize_tensor_input, so the model runs
on a 1x1 input and produces a tiny output that reads as black.

This script rebuilds each model with a fixed input shape matching its filename
(e.g., espcn_16x_64x.tflite -> input 16x16, output 64x64), loads the trained
weights from the existing TFLite model, and re-exports with the fixed shape.

Usage:
    .venv/bin/python scripts/reexport-models-fixed-shape.py [--dry-run]
"""

import os
import sys
import re
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers, Model

DRY_RUN = "--dry-run" in sys.argv

# Model configurations matching the training scripts
ESPCN_CONFIGS = {
    16: [4, 8, 12, 16, 24, 32],
    32: [2, 4, 6, 8, 12, 16],
    48: [2, 3, 4, 5, 8, 12],
    64: [2, 3, 4, 6, 8],
    96: [2, 3, 4, 5],
    128: [2, 3],
    192: [2, 3],
    256: [2],
}

FSRCNN_CONFIGS = {
    16: [4, 8, 12, 16, 24, 32],
    32: [2, 4, 6, 8, 12, 16],
    48: [2, 3, 4, 5, 8, 12],
    64: [2, 3, 4, 6, 8],
    96: [2, 3, 4, 5],
    128: [2, 3, 4],
    192: [2, 3],
    256: [2],
}


def build_espcn_fixed(scale: int, input_size: int):
    """Build ESPCN model with fixed input shape."""
    inp = layers.Input(shape=(input_size, input_size, 3))
    x = layers.Conv2D(16, 3, padding="same", activation="relu")(inp)
    x = layers.Conv2D(scale * scale * 3, 3, padding="same")(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, scale))(x)
    out = layers.Conv2D(3, 3, padding="same", activation="sigmoid")(x)
    return Model(inp, out)


def build_fsrcnn_fixed(scale: int, input_size: int, d: int = 32, s: int = 8, m: int = 3):
    """Build FSRCNN model with fixed input shape."""
    inp = layers.Input(shape=(input_size, input_size, 3))
    x = layers.Conv2D(d, 5, padding="same", activation="relu")(inp)
    x = layers.Conv2D(s, 1, padding="same", activation="relu")(x)
    for _ in range(m):
        x = layers.Conv2D(s, 3, padding="same", activation="relu")(x)
    x = layers.Conv2D(d, 1, padding="same", activation="relu")(x)
    x = layers.Conv2D(scale * scale * 3, 5, padding="same")(x)
    x = layers.Lambda(lambda t: tf.nn.depth_to_space(t, scale))(x)
    out = layers.Conv2D(3, 5, padding="same", activation="sigmoid")(x)
    return Model(inp, out)


def extract_weights_from_tflite(tflite_path: str):
    """Extract weight tensors from a TFLite model, dequantizing if needed.
    
    Returns a list of numpy arrays representing the model's weights,
    in the order they appear in the model (matching Keras layer order).
    """
    interp = tf.lite.Interpreter(model_path=tflite_path)
    interp.allocate_tensors()
    
    # Get all tensor details
    tensor_details = interp.get_tensor_details()
    
    # Identify input and output tensor indices
    input_indices = {t["index"] for t in interp.get_input_details()}
    output_indices = {t["index"] for t in interp.get_output_details()}
    
    # Extract weight tensors (constants that are not inputs/outputs)
    weights = []
    for detail in tensor_details:
        idx = detail["index"]
        if idx in input_indices or idx in output_indices:
            continue
        
        # Weight tensors are constants with data; intermediate activations
        # have null data until inference runs. Skip null tensors.
        try:
            tensor_data = interp.get_tensor(idx)
        except ValueError:
            continue
        
        if len(tensor_data.shape) < 1:
            continue
        
        # Dequantize if the tensor is quantized (int8 with scale/zero_point)
        quant = detail.get("quantization", (0.0, 0))
        scale, zero_point = quant
        
        if scale != 0.0 and tensor_data.dtype == np.int8:
            # Dequantize: float = (int8 - zero_point) * scale
            tensor_data = (tensor_data.astype(np.float32) - zero_point) * scale
        elif tensor_data.dtype != np.float32:
            # Convert to float32 if not already
            tensor_data = tensor_data.astype(np.float32)
        
        weights.append((idx, tensor_data))
    
    return weights


def map_weights_to_keras(tflite_weights, keras_model):
    """Map TFLite weight tensors to Keras model layers.
    
    TFLite stores Conv2D kernels as [out_channels, kh, kw, in_channels].
    Keras expects [kh, kw, in_channels, out_channels].
    We transpose the kernels and match by shape.
    """
    # Get all Conv2D layers from the Keras model
    conv_layers = [l for l in keras_model.layers if isinstance(l, layers.Conv2D)]
    
    # Extract weight arrays from TFLite (skip indices, just get data)
    weight_arrays = [data for _, data in tflite_weights]
    
    # Build a lookup: transposed_shape -> (original_data, original_shape)
    # TFLite kernel: [out_ch, kh, kw, in_ch] -> Keras kernel: [kh, kw, in_ch, out_ch]
    kernel_lookup = {}
    bias_lookup = {}
    
    for w in weight_arrays:
        if len(w.shape) == 4:
            # This is a kernel: transpose from [out_ch, kh, kw, in_ch] to [kh, kw, in_ch, out_ch]
            transposed = np.transpose(w, (1, 2, 3, 0))
            key = tuple(transposed.shape)
            kernel_lookup[key] = transposed
        elif len(w.shape) == 1:
            # This is a bias
            key = tuple(w.shape)
            bias_lookup[key] = w
    
    for layer in conv_layers:
        kernel_shape = tuple(layer.kernel.shape.as_list())
        bias_shape = tuple(layer.bias.shape.as_list())
        
        kernel = kernel_lookup.get(kernel_shape)
        bias = bias_lookup.get(bias_shape)
        
        if kernel is not None and bias is not None:
            # Ensure kernel is float32
            if kernel.dtype != np.float32:
                kernel = kernel.astype(np.float32)
            if bias.dtype != np.float32:
                bias = bias.astype(np.float32)
            layer.set_weights([kernel, bias])
            print(f"    Mapped {layer.name}: kernel{kernel_shape}, bias{bias_shape}")
        else:
            print(f"    WARNING: Could not find weights for {layer.name} (kernel{kernel_shape}, bias{bias_shape})")
            if kernel is None:
                print(f"      Available kernels: {list(kernel_lookup.keys())}")
            if bias is None:
                print(f"      Available biases: {list(bias_lookup.keys())}")


def reexport_model(tflite_path: str, family: str, input_size: int, scale: int, output_dir: str):
    """Re-export a single model with fixed input shape."""
    output_size = input_size * scale
    model_name = f"{family}_{input_size}x_{output_size}x.tflite"
    out_path = os.path.join(output_dir, model_name)
    
    print(f"\n[REEXPORT] {model_name}")
    print(f"  Source: {tflite_path}")
    print(f"  Input: {input_size}x{input_size}, Output: {output_size}x{output_size}, Scale: {scale}x")
    
    # Build Keras model with fixed input shape
    if family == "espcn":
        keras_model = build_espcn_fixed(scale, input_size)
    else:
        keras_model = build_fsrcnn_fixed(scale, input_size)
    
    print(f"  Keras model built: {keras_model.count_params()} params")
    
    # Extract weights from existing TFLite model
    print(f"  Extracting weights from TFLite...")
    tflite_weights = extract_weights_from_tflite(tflite_path)
    print(f"  Found {len(tflite_weights)} weight tensors")
    
    # Map weights to Keras model
    print(f"  Mapping weights to Keras model...")
    map_weights_to_keras(tflite_weights, keras_model)
    
    # Verify the model produces correct output
    print(f"  Verifying model output...")
    test_input = np.random.rand(1, input_size, input_size, 3).astype(np.float32)
    test_output = keras_model.predict(test_input, verbose=0)
    expected_shape = (1, output_size, output_size, 3)
    print(f"  Output shape: {test_output.shape} (expected {expected_shape})")
    print(f"  Output range: [{test_output.min():.4f}, {test_output.max():.4f}]")
    
    if test_output.shape != expected_shape:
        print(f"  ERROR: Output shape mismatch!")
        return False
    
    # Convert to TFLite with fixed input shape
    if not DRY_RUN:
        print(f"  Converting to TFLite...")
        converter = tf.lite.TFLiteConverter.from_keras_model(keras_model)
        converter.optimizations = [tf.lite.Optimize.DEFAULT]
        tflite_model = converter.convert()
        
        with open(out_path, "wb") as f:
            f.write(tflite_model)
        print(f"  WROTE {out_path} ({len(tflite_model)} bytes)")
        
        # Verify the exported model
        interp = tf.lite.Interpreter(model_path=out_path)
        interp.allocate_tensors()
        inp = interp.get_input_details()
        out = interp.get_output_details()
        print(f"  Verified: input={inp[0]['shape']}, output={out[0]['shape']}")
    else:
        print(f"  [DRY RUN] Would write {out_path}")
    
    return True


def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    model_dir = os.path.join(script_dir, "..", "assets", "models")
    
    if not os.path.exists(model_dir):
        print(f"[ERROR] Model directory not found: {model_dir}")
        sys.exit(1)
    
    print("=" * 60)
    print("Re-export TFLite models with fixed input shapes")
    print("=" * 60)
    if DRY_RUN:
        print("[DRY RUN MODE - no files will be written]")
    
    success_count = 0
    fail_count = 0
    skip_count = 0
    
    # Process ESPCN models
    print("\n" + "=" * 60)
    print("ESPCN Models")
    print("=" * 60)
    for input_size, scales in ESPCN_CONFIGS.items():
        for scale in scales:
            output_size = input_size * scale
            model_name = f"espcn_{input_size}x_{output_size}x.tflite"
            tflite_path = os.path.join(model_dir, model_name)
            
            if not os.path.exists(tflite_path):
                print(f"[SKIP] {model_name} not found")
                skip_count += 1
                continue
            
            try:
                if reexport_model(tflite_path, "espcn", input_size, scale, model_dir):
                    success_count += 1
                else:
                    fail_count += 1
            except Exception as e:
                print(f"[ERROR] Failed to reexport {model_name}: {e}")
                fail_count += 1
    
    # Process FSRCNN models
    print("\n" + "=" * 60)
    print("FSRCNN Models")
    print("=" * 60)
    for input_size, scales in FSRCNN_CONFIGS.items():
        for scale in scales:
            output_size = input_size * scale
            model_name = f"fsrcnn_{input_size}x_{output_size}x.tflite"
            tflite_path = os.path.join(model_dir, model_name)
            
            if not os.path.exists(tflite_path):
                print(f"[SKIP] {model_name} not found")
                skip_count += 1
                continue
            
            try:
                if reexport_model(tflite_path, "fsrcnn", input_size, scale, model_dir):
                    success_count += 1
                else:
                    fail_count += 1
            except Exception as e:
                print(f"[ERROR] Failed to reexport {model_name}: {e}")
                fail_count += 1
    
    print("\n" + "=" * 60)
    print(f"Summary: {success_count} succeeded, {fail_count} failed, {skip_count} skipped")
    print("=" * 60)
    
    if fail_count > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()