#!/usr/bin/env python3
"""Fail if full-matrix trainers drift from frozen POC policy. Exit 1 on any FAIL."""
from __future__ import annotations

import ast
import re
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parent
fails: list[str] = []
oks: list[str] = []


def ok(msg: str) -> None:
    oks.append(msg)
    print(f"  OK  {msg}")


def bad(msg: str) -> None:
    fails.append(msg)
    print(f" FAIL {msg}")


def read(name: str) -> str:
    p = SCRIPTS / name
    if not p.is_file():
        bad(f"missing {p}")
        return ""
    return p.read_text()


def main() -> int:
    print("=== audit_full_matrix_policy: full-matrix == POC recipe ===\n")
    tl = read("train_levers.py")
    if tl:
        for sym in (
            "get_optimal_batch_size",
            "compute_lr",
            "make_train_callbacks",
            "load_best_if_exists",
        ):
            (ok if f"def {sym}" in tl else bad)(f"train_levers.{sym}")
        (ok if "1e-4" in tl else bad)("train_levers LR 1e-4")
        (ok if "1.5e-4" in tl else bad)("train_levers hard-scale 1.5e-4")
        (ok if "ReduceLROnPlateau" in tl else bad)("train_levers ReduceLR")

    es = ""
    for name in ("train_espcn_multi.py", "train_fsrcnn_multi.py"):
        print(f"\n--- {name} ---")
        t = read(name)
        if name.startswith("train_espcn"):
            es = t
        if not t:
            continue
        try:
            ast.parse(t)
            ok(f"{name} syntax")
        except SyntaxError as e:
            bad(f"{name} syntax: {e}")
        (ok if "from train_levers import" in t else bad)(f"{name} imports train_levers")
        for sym in (
            "compute_lr",
            "get_optimal_batch_size",
            "make_train_callbacks",
            "load_best_if_exists",
        ):
            (ok if sym in t else bad)(f"{name} uses {sym}")
        (ok if "edge_weight: float = 0.08" in t else bad)(f"{name} edge 0.08")
        (ok if "color_weight" in t else bad)(f"{name} color")
        (ok if "stroke_mass" in t or "mass_weight" in t else bad)(f"{name} stroke_mass")
        (ok if 'assets", "models"' in t or "assets/models" in t else bad)(
            f"{name} default assets/models"
        )
        (ok if "VALIDATION FAILED" in t or "not better than bicubic" in t else bad)(
            f"{name} PSNR gate"
        )
        (ok if "--force" in t or "FORCE" in t else bad)(f"{name} force")
        (ok if "(8, 450)" in t else bad)(f"{name} 8x epochs 450")
        (ok if "callbacks=callbacks" in t else bad)(f"{name} fit callbacks")

    print("\n--- ESPCN capacity ---")
    if es and "elif scale < 8:" in es and "64, 2" in es:
        ok("ESPCN scale>=8 → 64ch/2map")
    else:
        bad("ESPCN capacity not POC")

    print("\n--- train.sh ---")
    sh = read("train.sh")
    (ok if "train_espcn_multi.py" in sh and "train_fsrcnn_multi.py" in sh else bad)(
        "train.sh both multi"
    )
    (ok if "generate-model-registry" in sh else bad)("train.sh registry")
    (ok if "--force" in sh else bad)("train.sh force")

    print("\n--- matrix ---")
    m = re.search(r"MODEL_CONFIGS = (\[[\s\S]*?\n\])\n", es)
    if m:
        cfg = ast.literal_eval(m.group(1))
        n = sum(len(sc) for _, sc in cfg)
        (ok if n == 35 else bad)(f"cells={n} (want 35×2=70)")
    else:
        bad("MODEL_CONFIGS parse")

    if es and "_sys.path.insert" in es:
        ok("scripts path for train_levers")
    else:
        bad("path insert for train_levers")

    # Param signature: 8x must not be tiny 32ch net
    if es:
        # rough: build_espcn scale 8 should hit 64,2 branch
        if "includes 8x" in es or ("scale < 8" in es and "64, 2" in es):
            ok("8x capacity comment/branch present")
        else:
            bad("8x capacity branch unclear")

    print(f"\n=== SUMMARY OK={len(oks)} FAIL={len(fails)} ===")
    for f in fails:
        print(f"  - {f}")
    return 1 if fails else 0


if __name__ == "__main__":
    raise SystemExit(main())
