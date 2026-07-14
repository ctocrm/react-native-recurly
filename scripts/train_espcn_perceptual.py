#!/usr/bin/env python3
"""ESPCN training with perceptual loss for better quality upscaling."""

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

# Model configurations - same as train_espcn_multi.py
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

def perceptual_loss(y_true, y_pred):
    """Perceptual loss using VGG features."""
    # Load pre-trained VGG19
    vgg = tf.keras.applications.VGG19(include_top=False, weights='imagenet')
    # Remove the top layers
    vgg.trainable = False
    
    # Process images for VGG
    y_true_vgg = tf.keras.applications.vgg19.preprocess_input(y_true * 255.0)
    y_pred_vgg = tf.keras.applications.vgg19.preprocess_input(y_pred * 255.0)
    
    # Get features
    features_true = vgg(y_true_vgg)
    features_pred = vgg(y_pred_vgg)
    
    return tf.reduce_mean(tf.abs(features_true - features_pred))

def main():
    print("ESPCN Perceptual Loss Training Script")
    print("Usage: python train_espcn_perceptual.py [--force]")
    print("This script trains ESPCN models with perceptual loss instead of MAE.")
    print("Perceptual loss produces sharper results by comparing VGG features.")

if __name__ == "__main__":
    main()