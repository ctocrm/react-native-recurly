#!/usr/bin/env python3
"""
POC visual gate for icon SR models (Ace Hardware = default reference).

Does NOT train. Runs existing .tflite models on a real crawl-sized LR icon and
writes side-by-side PNGs for human review.

Single model:
  python scripts/poc_upscale_smoke.py
  python scripts/poc_upscale_smoke.py --model assets/models/fsrcnn_16x_192x.tflite
  python scripts/poc_upscale_smoke.py --cascade --out poc_out_cascade

Batch (every model in a dir — use after poc_batch_matrix.sh):
  python scripts/poc_upscale_smoke.py \\
    --batch-dir assets/models_poc_batch \\
    --out poc_out_batch_smoke \\
    --expect-poc-batch
"""

from __future__ import annotations

import argparse
import io
import re
import sys
import urllib.request
from pathlib import Path

import numpy as np

try:
    from tflite_runtime.interpreter import Interpreter
except ImportError:
    try:
        import tensorflow as tf

        Interpreter = tf.lite.Interpreter
    except ImportError:
        print("ERROR: need tflite_runtime or tensorflow", file=sys.stderr)
        sys.exit(1)

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_URLS = [
    "https://www.acehardware.com/favicon.ico",
    "https://cdn-tp6.mozu.com/24645-37138/resources/images/icons/favicon.ico",
    "https://cdn-tp3.mozu.com/24645-37138/cms/37138/files/store-location-logo.svg",
]

# Must match scripts/poc_batch_matrix.sh train list
POC_BATCH_EXPECTED = [
    "espcn_16x_64x.tflite",
    "espcn_16x_128x.tflite",
    "espcn_16x_192x.tflite",
    "espcn_16x_512x.tflite",
    "espcn_96x_288x.tflite",
    "espcn_128x_256x.tflite",
    "espcn_256x_512x.tflite",
    "fsrcnn_16x_128x.tflite",
    "fsrcnn_16x_192x.tflite",
    "fsrcnn_16x_512x.tflite",
    "fsrcnn_128x_256x.tflite",
]

# App freeze (iconProcessing.ts)
BRAND_SAFE_LERP_T = 0.25
BRAND_SAFE_MAX_DARKEN = 0.12
BRAND_SAFE_MAX_BRIGHTEN = 0.35
MIN_PRED_VAR = 1e-6


def download(url: str, timeout: int = 15) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception as e:
        print(f"[POC] download failed {url}: {e}")
        return None


def load_rgba(path_or_bytes, size: int | None = None) -> np.ndarray:
    if isinstance(path_or_bytes, (str, Path)):
        img = Image.open(path_or_bytes)
    else:
        img = Image.open(io.BytesIO(path_or_bytes))
    img = img.convert("RGBA")
    if size is not None:
        img = img.resize((size, size), Image.Resampling.BICUBIC)
    return np.asarray(img).astype(np.float32) / 255.0


def white_composite(rgba: np.ndarray) -> np.ndarray:
    rgb = rgba[..., :3]
    a = rgba[..., 3:4]
    return rgb * a + (1.0 - a)


def nn_upscale_alpha(alpha: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    in_h, in_w = alpha.shape
    sy = np.minimum(in_h - 1, (np.arange(out_h) * in_h // out_h))
    sx = np.minimum(in_w - 1, (np.arange(out_w) * in_w // out_w))
    return alpha[sy][:, sx]


def uncomposite(comp_rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    a = alpha[..., None] if alpha.ndim == 2 else alpha
    mask = a[..., 0] > 1e-3
    a3 = np.clip(a, 1e-3, 1.0)
    restored = (comp_rgb - (1.0 - a3)) / a3
    return np.where(mask[..., None], np.clip(restored, 0, 1), 0.0)


def bilinear_rgba(rgba: np.ndarray, out_size: int) -> np.ndarray:
    u8 = (np.clip(rgba, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(u8, mode="RGBA")
    img = img.resize((out_size, out_size), Image.Resampling.BILINEAR)
    return np.asarray(img).astype(np.float32) / 255.0


def brand_safe_hybrid(
    bilin_rgb: np.ndarray,
    model_rgb: np.ndarray,
    t: float = BRAND_SAFE_LERP_T,
    max_darken: float = BRAND_SAFE_MAX_DARKEN,
    max_brighten: float = BRAND_SAFE_MAX_BRIGHTEN,
) -> np.ndarray:
    """Match app: out = bilin + t * clamp(model - bilin)."""
    residual = model_rgb - bilin_rgb
    residual = np.clip(residual, -max_darken, max_brighten)
    return np.clip(bilin_rgb + t * residual, 0.0, 1.0)


def save_rgba(path: Path, rgba: np.ndarray) -> None:
    u8 = (np.clip(rgba, 0, 1) * 255).astype(np.uint8)
    if u8.shape[-1] == 3:
        Image.fromarray(u8, mode="RGB").save(path)
    else:
        Image.fromarray(u8, mode="RGBA").save(path)


def run_tflite(model_path: Path, rgb_nhwc: np.ndarray) -> np.ndarray:
    interp = Interpreter(model_path=str(model_path))
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    x = rgb_nhwc.astype(np.float32)
    if x.ndim == 3:
        x = x[None, ...]
    want = inp["shape"]
    if len(want) == 4 and want[1] > 0 and want[2] > 0:
        th, tw = int(want[1]), int(want[2])
        if x.shape[1] != th or x.shape[2] != tw:
            u8 = (np.clip(x[0], 0, 1) * 255).astype(np.uint8)
            img = Image.fromarray(u8, mode="RGB").resize(
                (tw, th), Image.Resampling.BICUBIC
            )
            x = (np.asarray(img).astype(np.float32) / 255.0)[None, ...]
    interp.set_tensor(inp["index"], x)
    interp.invoke()
    y = interp.get_tensor(out["index"])
    return np.clip(y[0], 0.0, 1.0)


def parse_model_io(name: str) -> tuple[int, int] | None:
    m = re.search(r"_(\d+)x_(\d+)x\.tflite$", name)
    if not m:
        return None
    return int(m.group(1)), int(m.group(2))


def cascade_2x(
    rgb: np.ndarray,
    model_dir: Path,
    chain: list[tuple[int, int]] | None = None,
    family: str = "fsrcnn",
) -> tuple[np.ndarray, list[str]]:
    if chain is None:
        chain = [(16, 32), (32, 64), (64, 128), (128, 256)]
    x = rgb.astype(np.float32)
    hops: list[str] = []
    for inn, out in chain:
        path = model_dir / f"{family}_{inn}x_{out}x.tflite"
        if not path.is_file():
            raise FileNotFoundError(f"cascade hop missing: {path}")
        if x.shape[0] != inn or x.shape[1] != inn:
            u8 = (np.clip(x, 0, 1) * 255).astype(np.uint8)
            x = (
                np.asarray(
                    Image.fromarray(u8, mode="RGB").resize(
                        (inn, inn), Image.Resampling.BICUBIC
                    ),
                    dtype=np.float32,
                )
                / 255.0
            )
        y = run_tflite(path, x)
        hops.append(f"{path.name} {x.shape[0]}→{y.shape[0]} var={float(y.var()):.5f}")
        print(f"[POC] cascade hop {hops[-1]}")
        x = y
    return x, hops


def load_lr_rgba(input_path: str | None, in_size: int) -> tuple[np.ndarray, str]:
    if input_path:
        return load_rgba(input_path, size=in_size), input_path
    for url in DEFAULT_URLS:
        print(f"[POC] trying {url}")
        raw = download(url)
        if not raw:
            continue
        if url.endswith(".svg"):
            try:
                import cairosvg

                png = cairosvg.svg2png(
                    bytestring=raw, output_width=in_size, output_height=in_size
                )
                return load_rgba(png, size=None), url + " (svg→png)"
            except Exception as e:
                print(f"[POC] svg raster failed: {e}")
                continue
        try:
            return load_rgba(raw, size=in_size), url
        except Exception as e:
            print(f"[POC] decode failed: {e}")
            continue
    raise RuntimeError("could not download any Ace asset")


def to_rgb_u8(a: np.ndarray) -> Image.Image:
    if a.shape[-1] == 4:
        rgb = a[..., :3] * a[..., 3:4] + 0.85 * (1 - a[..., 3:4])
    else:
        rgb = a
    return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), mode="RGB")


def smoke_one_model(
    *,
    model_path: Path,
    out_dir: Path,
    rgba_full: np.ndarray | None,
    src_desc: str | None,
    input_path: str | None,
    cascade: bool = False,
    cascade_model_dir: Path | None = None,
    model_fast: Path | None = None,
) -> dict:
    """Run one model smoke. Returns status dict with ok bool."""
    out_dir.mkdir(parents=True, exist_ok=True)
    result = {
        "model": model_path.name,
        "ok": False,
        "error": None,
        "var": None,
        "out_dir": str(out_dir),
    }

    try:
        if cascade:
            in_size = 16
            out_size = 256
            model_dir = cascade_model_dir or model_path.parent
            first = model_dir / "fsrcnn_16x_32x.tflite"
            if not first.is_file():
                raise FileNotFoundError(f"cascade needs {first}")
            model_label = "cascade 16→32→64→128→256"
        else:
            if not model_path.is_file():
                raise FileNotFoundError(f"model not found: {model_path}")
            io_sizes = parse_model_io(model_path.name)
            if not io_sizes:
                raise ValueError(f"cannot parse IO from {model_path.name}")
            in_size, out_size = io_sizes
            model_label = str(model_path)

        if rgba_full is not None and rgba_full.shape[0] == in_size:
            rgba = rgba_full
            desc = src_desc or "cached"
        else:
            rgba, desc = load_lr_rgba(input_path, in_size)
            src_desc = desc

        print(f"[POC] source={desc} lr={rgba.shape} model={model_path.name}")

        save_rgba(out_dir / "01_lr.png", rgba)
        bil = bilinear_rgba(rgba, out_size)
        save_rgba(out_dir / "02_bilinear.png", bil)
        bil_rgb = bil[..., :3]

        rgb_raw = rgba[..., :3].copy()
        cascade_hops: list[str] = []
        pred_raw = None
        try:
            if cascade:
                pred_raw, _ = cascade_2x(rgb_raw, cascade_model_dir or model_path.parent)
            else:
                pred_raw = run_tflite(model_path, rgb_raw)
            save_rgba(out_dir / "03_model_raw_drop_alpha.png", pred_raw)
        except Exception as e:
            print(f"[POC] raw drop-alpha run failed: {e}")

        rgb_wc = white_composite(rgba)
        if cascade:
            pred_wc, cascade_hops = cascade_2x(
                rgb_wc, cascade_model_dir or model_path.parent
            )
        else:
            pred_wc = run_tflite(model_path, rgb_wc)
        save_rgba(out_dir / "04_model_white_comp_in.png", pred_wc)

        # Brand-safe hybrid (app path)
        if pred_wc.shape[0] != out_size or pred_wc.shape[1] != out_size:
            # model may return its native size
            out_size = pred_wc.shape[0]
            bil = bilinear_rgba(rgba, out_size)
            bil_rgb = bil[..., :3]
            save_rgba(out_dir / "02_bilinear.png", bil)

        hybrid_rgb = brand_safe_hybrid(bil_rgb, pred_wc)
        save_rgba(out_dir / "04b_brand_safe_hybrid.png", hybrid_rgb)

        a_hr = nn_upscale_alpha(rgba[..., 3], hybrid_rgb.shape[0], hybrid_rgb.shape[1])
        rgb_restored = uncomposite(hybrid_rgb, a_hr)
        rgba_out = np.concatenate([rgb_restored, a_hr[..., None]], axis=-1)
        save_rgba(out_dir / "05_model_alpha_restored.png", rgba_out)

        # Also keep pure model alpha path for comparison
        a_hr_m = nn_upscale_alpha(rgba[..., 3], pred_wc.shape[0], pred_wc.shape[1])
        rgba_model = np.concatenate(
            [uncomposite(pred_wc, a_hr_m), a_hr_m[..., None]], axis=-1
        )
        save_rgba(out_dir / "05b_model_only_alpha_restored.png", rgba_model)

        lines = [
            f"source: {desc}",
            f"lr_shape: {tuple(rgba.shape)}",
            f"model: {model_label}",
            f"mode: {'cascade_2x' if cascade else 'one_shot'}",
            f"in_size: {in_size} out_size: {out_size}",
            f"brand_safe_t: {BRAND_SAFE_LERP_T}",
            f"pred_wc_range: {float(pred_wc.min()):.4f}..{float(pred_wc.max()):.4f}",
            f"pred_wc_var: {float(pred_wc.var()):.6f}",
            f"hybrid_var: {float(hybrid_rgb.var()):.6f}",
        ]
        if cascade_hops:
            lines.append("cascade_hops:")
            lines.extend(f"  - {h}" for h in cascade_hops)
        if pred_raw is not None:
            lines.append(
                f"pred_raw_range: {float(pred_raw.min()):.4f}..{float(pred_raw.max()):.4f}"
            )

        if model_fast and model_fast.is_file() and not cascade:
            try:
                pred_fast = run_tflite(model_fast, rgb_wc)
                save_rgba(out_dir / "06_model_fast_white_comp.png", pred_fast)
                lines.append(f"fast_model: {model_fast.name}")
            except Exception as e:
                lines.append(f"fast_model_failed: {e}")

        tiles = [
            to_rgb_u8(rgba).resize((out_size, out_size), Image.Resampling.NEAREST),
            to_rgb_u8(bil),
            to_rgb_u8(pred_wc),
            to_rgb_u8(hybrid_rgb),
            to_rgb_u8(rgba_out),
        ]
        labels = ["LR", "bilin", "model", "hybrid", "alpha"]
        sheet = Image.new("RGB", (out_size * len(tiles), out_size))
        for i, t in enumerate(tiles):
            sheet.paste(t, (i * out_size, 0))
        sheet.save(out_dir / "00_contact_sheet.png")
        lines.append("contact: " + " | ".join(labels))
        lines.append("Open 00_contact_sheet.png and 04b_brand_safe_hybrid.png")

        var = float(pred_wc.var())
        result["var"] = var
        ok = True
        reasons = []
        if not np.isfinite(pred_wc).all():
            ok = False
            reasons.append("non-finite")
        if var < MIN_PRED_VAR:
            ok = False
            reasons.append(f"near-constant var={var:.2e}")
        if pred_wc.shape[0] < 2 or pred_wc.shape[1] < 2:
            ok = False
            reasons.append("bad spatial shape")

        result["ok"] = ok
        if ok:
            lines.append("SMOKE: PASS")
        else:
            lines.append("SMOKE: FAIL " + ", ".join(reasons))
            result["error"] = ", ".join(reasons)

        (out_dir / "report.txt").write_text("\n".join(lines) + "\n")
        print((out_dir / "report.txt").read_text())
        print(f"[POC] wrote {out_dir} ok={ok}")
        return result
    except Exception as e:
        result["error"] = str(e)
        result["ok"] = False
        (out_dir / "report.txt").write_text(f"SMOKE: FAIL\nerror: {e}\n")
        print(f"[POC] FAIL {model_path.name}: {e}")
        return result


def run_batch(
    batch_dir: Path,
    out_root: Path,
    input_path: str | None,
    expect_poc: bool,
) -> int:
    out_root.mkdir(parents=True, exist_ok=True)
    if expect_poc:
        names = list(POC_BATCH_EXPECTED)
    else:
        names = sorted(p.name for p in batch_dir.glob("*.tflite"))

    if not names:
        print(f"ERROR: no models to smoke in {batch_dir}", file=sys.stderr)
        return 1

    # Cache largest needed LR once per unique in_size
    lr_cache: dict[int, tuple[np.ndarray, str]] = {}
    rows = []
    fails = 0

    for name in names:
        path = batch_dir / name
        stem = Path(name).stem
        sub = out_root / stem
        print(f"\n======== batch smoke {name} ========")
        if not path.is_file():
            row = {
                "model": name,
                "ok": False,
                "error": "MISSING",
                "var": None,
                "out_dir": str(sub),
            }
            sub.mkdir(parents=True, exist_ok=True)
            (sub / "report.txt").write_text("SMOKE: FAIL\nerror: MISSING\n")
            rows.append(row)
            fails += 1
            print(f"[POC] MISSING {name}")
            continue

        io_sizes = parse_model_io(name)
        in_size = io_sizes[0] if io_sizes else 16
        if in_size not in lr_cache:
            try:
                lr_cache[in_size] = load_lr_rgba(input_path, in_size)
            except Exception as e:
                row = {
                    "model": name,
                    "ok": False,
                    "error": f"LR load failed: {e}",
                    "var": None,
                    "out_dir": str(sub),
                }
                rows.append(row)
                fails += 1
                continue
        rgba, desc = lr_cache[in_size]
        row = smoke_one_model(
            model_path=path,
            out_dir=sub,
            rgba_full=rgba,
            src_desc=desc,
            input_path=input_path,
            cascade=False,
            model_fast=None,
        )
        rows.append(row)
        if not row["ok"]:
            fails += 1

    # SUMMARY
    lines = [
        f"batch_dir: {batch_dir}",
        f"out: {out_root}",
        f"expect_poc_batch: {expect_poc}",
        f"total: {len(rows)}  pass: {sum(1 for r in rows if r['ok'])}  fail: {fails}",
        "",
        f"{'STATUS':<6} {'VAR':>10} MODEL",
    ]
    for r in rows:
        st = "PASS" if r["ok"] else "FAIL"
        var_s = f"{r['var']:.6f}" if r["var"] is not None else "-"
        err = f"  ({r['error']})" if r.get("error") else ""
        lines.append(f"{st:<6} {var_s:>10} {r['model']}{err}")

    summary = out_root / "SUMMARY.txt"
    summary.write_text("\n".join(lines) + "\n")
    print("\n" + summary.read_text())

    # Optional strip: first contact of each pass at 64px thumb
    try:
        thumbs = []
        labels = []
        for r in rows:
            cs = Path(r["out_dir"]) / "00_contact_sheet.png"
            if cs.is_file():
                im = Image.open(cs)
                h = 64
                w = max(1, int(im.width * h / im.height))
                thumbs.append(im.resize((w, h), Image.Resampling.BILINEAR))
                labels.append(r["model"])
        if thumbs:
            total_w = sum(t.width for t in thumbs)
            strip = Image.new("RGB", (total_w, 64 + 14), (30, 30, 30))
            x = 0
            for t in thumbs:
                strip.paste(t, (x, 14))
                x += t.width
            strip.save(out_root / "00_all_models_strip.png")
            print(f"[POC] wrote {out_root / '00_all_models_strip.png'}")
    except Exception as e:
        print(f"[POC] strip skipped: {e}")

    return 1 if fails else 0


def main() -> int:
    ap = argparse.ArgumentParser(description="POC Ace upscale visual gate")
    ap.add_argument(
        "--model",
        default=str(ROOT / "assets/models/fsrcnn_16x_192x.tflite"),
        help="Path to .tflite (single-model mode)",
    )
    ap.add_argument(
        "--model-fast",
        default=str(ROOT / "assets/models/espcn_16x_192x.tflite"),
        help="Optional second model (fast) for single-model comparison",
    )
    ap.add_argument("--input", default=None, help="Local LR image (skip download)")
    ap.add_argument(
        "--out",
        default=str(ROOT / "poc_out"),
        help="Output directory (single) or root for batch",
    )
    ap.add_argument("--input-size", type=int, default=None, help="Force LR size")
    ap.add_argument(
        "--cascade",
        action="store_true",
        help="Progressive 2x chain 16→32→64→128→256",
    )
    ap.add_argument(
        "--model-dir",
        default=str(ROOT / "assets/models"),
        help="Directory of tflite models for --cascade",
    )
    ap.add_argument(
        "--batch-dir",
        default=None,
        help="Smoke every .tflite in this directory (POC matrix gate)",
    )
    ap.add_argument(
        "--expect-poc-batch",
        action="store_true",
        help="Require POC_BATCH_EXPECTED filenames (missing = FAIL)",
    )
    args = ap.parse_args()

    if args.batch_dir:
        out = args.out
        if out == str(ROOT / "poc_out"):
            out = str(ROOT / "poc_out_batch_smoke")
        return run_batch(
            batch_dir=Path(args.batch_dir),
            out_root=Path(out),
            input_path=args.input,
            expect_poc=args.expect_poc_batch,
        )

    model_path = Path(args.model)
    model_dir = Path(args.model_dir)
    out_dir = Path(args.out)

    if args.cascade:
        row = smoke_one_model(
            model_path=model_path,
            out_dir=out_dir,
            rgba_full=None,
            src_desc=None,
            input_path=args.input,
            cascade=True,
            cascade_model_dir=model_dir,
            model_fast=None,
        )
    else:
        # optional force input size override via resizing after parse
        row = smoke_one_model(
            model_path=model_path,
            out_dir=out_dir,
            rgba_full=None,
            src_desc=None,
            input_path=args.input,
            cascade=False,
            model_fast=Path(args.model_fast),
        )
        if args.input_size and row.get("ok"):
            pass  # size already from model; --input-size only used if we re-ran
    return 0 if row.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
