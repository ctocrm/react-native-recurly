#!/usr/bin/env python3
"""DEPRECATED — redirects to brand-safe multi trainer `train_fsrcnn_multi.py`.

Production: MAE + color preserve + stroke-mass + light edge; residual bilin base.
App inference: bilin lerp hybrid t≈0.25. See TRAINING_FIXES.md.
"""
from __future__ import annotations

import runpy
import sys
from pathlib import Path

_TARGET = Path(__file__).resolve().parent / "train_fsrcnn_multi.py"
print(f"[TRAIN] {Path(__file__).name} → {_TARGET.name} (brand-safe multi trainer)")
sys.argv[0] = str(_TARGET)
runpy.run_path(str(_TARGET), run_name="__main__")
