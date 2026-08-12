"""
Matrix-wide training levers (ESPCN + FSRCNN).

Loss / hybrid / brand-safe path are NOT here — only optimization knobs:
  batch floor, LR floor/scale, ReduceLR, best-checkpoint restore.

Keep both trainers calling these helpers so full matrix stays consistent.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

import keras


def get_optimal_batch_size(
    output_size: int,
    num_replicas: int,
    use_perceptual_loss: bool,
) -> int:
    """Per-GPU batch from HR size; never 1/GPU under MirroredStrategy."""
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
    if num_replicas > 1:
        base_per_gpu = max(base_per_gpu, 2)
    return base_per_gpu * num_replicas


def compute_lr(batch_size: int, input_size: int, scale: int) -> float:
    """
    Log-driven LR policy for full matrix:
      - linear scale with global batch (ref 32)
      - floor 1e-4 (was 5e-5 — starved 16->128 / 16->192)
      - hard one-shots scale>=8 get 1.5e-4 floor
      - large-in easy 2x/3x keep >=1e-4
      - cap 3e-4
    """
    base_lr = 1e-4
    lr = base_lr * (batch_size / 32.0)
    lr = max(lr, 1e-4)
    if scale >= 8:
        lr = max(lr, 1.5e-4)
    if input_size >= 96 and scale <= 3:
        lr = max(lr, 1e-4)
    lr = min(lr, 3e-4)
    return float(lr)


def make_train_callbacks(ckpt_path: str | Path, epochs: int) -> list[Any]:
    """ReduceLR + best-by-val_loss checkpoint (restore after fit)."""
    ckpt_path = str(ckpt_path)
    patience = max(20, min(40, epochs // 10))
    return [
        keras.callbacks.ReduceLROnPlateau(
            monitor="val_loss",
            factor=0.5,
            patience=patience,
            min_lr=1e-6,
            verbose=1,
        ),
        keras.callbacks.ModelCheckpoint(
            filepath=ckpt_path,
            monitor="val_loss",
            save_best_only=True,
            save_weights_only=False,
            verbose=0,
        ),
    ]


def load_best_if_exists(model: keras.Model, ckpt_path: str | Path) -> bool:
    """Load best checkpoint into model after fit. Returns True if loaded."""
    p = Path(ckpt_path)
    if not p.is_file():
        return False
    try:
        best = keras.models.load_model(p, compile=False)
        model.set_weights(best.get_weights())
        print(f"[TRAIN] Restored best checkpoint: {p}")
        return True
    except Exception as e:
        print(f"[TRAIN] WARN could not restore best ckpt {p}: {e}")
        return False
