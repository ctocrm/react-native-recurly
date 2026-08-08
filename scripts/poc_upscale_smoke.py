#!/usr/bin/env python3
"""
POC visual gate for icon SR models (Ace Hardware = default reference).

Does NOT train. Runs existing .tflite models on a real crawl-sized LR icon and
writes side-by-side PNGs for human review:

  poc_out/
    01_lr.png
    02_bilinear.png
    03_model_raw.png              # model RGB as-is (white-composited domain)
    04_model_white_comp_in.png    # same path as app after white-composite input
    05_model_alpha_restored.png   # white-comp in + NN alpha restore (app path)
    report.txt

Usage:
  python scripts/poc_upscale_smoke.py
  python scripts/poc_upscale_smoke.py --model assets/models/fsrcnn_16x_192x.tflite
  python scripts/poc_upscale_smoke.py --input samples/ace_lr.png --out poc_out
  # Progressive 2x cascade (research strategy): 16→32→64→128→256
  python scripts/poc_upscale_smoke.py --cascade --out poc_out_cascade

Training data is unchanged (full brand set). Default judges one-shot 16→192.
--cascade chains 2x FSRCNN rungs for the progressive path.
"""

from __future__ import annotations

import argparse
import io
import os
import sys
import urllib.request
from pathlib import Path

import numpy as np

# Prefer tflite_runtime; fall back to full TF
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

# Crawl URLs from emulator logcat (Ace Hardware spider)
DEFAULT_URLS = [
    "https://www.acehardware.com/favicon.ico",
    "https://cdn-tp6.mozu.com/24645-37138/resources/images/icons/favicon.ico",
    "https://cdn-tp3.mozu.com/24645-37138/cms/37138/files/store-location-logo.svg",
]


def download(url: str, timeout: int = 15) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.read()
    except Exception as e:
        print(f"[POC] download failed {url}: {e}")
        return None


def load_rgba(path_or_bytes, size: int | None = None) -> np.ndarray:
    """Return float32 RGBA HxWx4 in 0..1."""
    if isinstance(path_or_bytes, (str, Path)):
        img = Image.open(path_or_bytes)
    else:
        img = Image.open(io.BytesIO(path_or_bytes))
    img = img.convert("RGBA")
    if size is not None:
        img = img.resize((size, size), Image.Resampling.BICUBIC)
    arr = np.asarray(img).astype(np.float32) / 255.0
    return arr


def white_composite(rgba: np.ndarray) -> np.ndarray:
    """Train-domain RGB: rgb * a + (1 - a)."""
    rgb = rgba[..., :3]
    a = rgba[..., 3:4]
    return rgb * a + (1.0 - a)


def nn_upscale_alpha(alpha: np.ndarray, out_h: int, out_w: int) -> np.ndarray:
    in_h, in_w = alpha.shape
    sy = np.minimum(in_h - 1, (np.arange(out_h) * in_h // out_h))
    sx = np.minimum(in_w - 1, (np.arange(out_w) * in_w // out_w))
    return alpha[sy][:, sx]


def uncomposite(comp_rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Invert white composite where alpha > 0."""
    a = alpha[..., None] if alpha.ndim == 2 else alpha
    out = np.zeros_like(comp_rgb)
    mask = a[..., 0] > 1e-3
    # broadcast
    a3 = np.clip(a, 1e-3, 1.0)
    restored = (comp_rgb - (1.0 - a3)) / a3
    out = np.where(mask[..., None], np.clip(restored, 0, 1), 0.0)
    return out


def bilinear_rgba(rgba: np.ndarray, out_size: int) -> np.ndarray:
    u8 = (np.clip(rgba, 0, 1) * 255).astype(np.uint8)
    img = Image.fromarray(u8, mode="RGBA")
    img = img.resize((out_size, out_size), Image.Resampling.BILINEAR)
    return np.asarray(img).astype(np.float32) / 255.0


def save_rgba(path: Path, rgba: np.ndarray) -> None:
    u8 = (np.clip(rgba, 0, 1) * 255).astype(np.uint8)
    if u8.shape[-1] == 3:
        Image.fromarray(u8, mode="RGB").save(path)
    else:
        Image.fromarray(u8, mode="RGBA").save(path)


def run_tflite(model_path: Path, rgb_nhwc: np.ndarray) -> np.ndarray:
    """rgb_nhwc: HxWx3 float32 0..1 → out HxWx3 float32."""
    interp = Interpreter(model_path=str(model_path))
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    x = rgb_nhwc.astype(np.float32)
    if x.ndim == 3:
        x = x[None, ...]
    # Resize spatially if model fixed size differs
    want = inp["shape"]
    # want like [1,H,W,3]
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
    # fsrcnn_16x_192x.tflite
    import re

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
    """Progressive 2x SR: 16→32→64→128→256 (waifu2x / LapSRN practice).

    Returns final RGB and list of hop descriptions.
    """
    if chain is None:
        chain = [(16, 32), (32, 64), (64, 128), (128, 256)]
    x = rgb.astype(np.float32)
    hops: list[str] = []
    for inn, out in chain:
        path = model_dir / f"{family}_{inn}x_{out}x.tflite"
        if not path.is_file():
            raise FileNotFoundError(f"cascade hop missing: {path}")
        # Ensure spatial size matches hop input
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


def main() -> int:
    ap = argparse.ArgumentParser(description="POC Ace upscale visual gate")
    ap.add_argument(
        "--model",
        default=str(ROOT / "assets/models/fsrcnn_16x_192x.tflite"),
        help="Path to .tflite (default sharp 16→192 one-shot)",
    )
    ap.add_argument(
        "--model-fast",
        default=str(ROOT / "assets/models/espcn_16x_192x.tflite"),
        help="Optional second model (fast) for comparison",
    )
    ap.add_argument("--input", default=None, help="Local LR image (skip download)")
    ap.add_argument(
        "--out",
        default=str(ROOT / "poc_out"),
        help="Output directory for PNGs + report",
    )
    ap.add_argument("--input-size", type=int, default=None, help="Force LR size")
    ap.add_argument(
        "--cascade",
        action="store_true",
        help="Use progressive 2x chain 16→32→64→128→256 instead of one-shot",
    )
    ap.add_argument(
        "--model-dir",
        default=str(ROOT / "assets/models"),
        help="Directory of tflite models for --cascade",
    )
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    model_path = Path(args.model)
    model_dir = Path(args.model_dir)
    if args.cascade:
        in_size = args.input_size or 16
        out_size = 256
        model_path = model_dir / "fsrcnn_16x_32x.tflite"  # first hop must exist
        if not model_path.is_file():
            print(
                f"ERROR: cascade needs 2x rungs in {model_dir} "
                f"(missing {model_path.name})",
                file=sys.stderr,
            )
            return 1
    else:
        if not model_path.is_file():
            print(f"ERROR: model not found: {model_path}", file=sys.stderr)
            return 1
        io_sizes = parse_model_io(model_path.name)
        in_size = args.input_size or (io_sizes[0] if io_sizes else 16)
        out_size = io_sizes[1] if io_sizes else in_size * 12

    # --- Load LR ---
    if args.input:
        rgba = load_rgba(args.input, size=in_size)
        src_desc = args.input
    else:
        raw = None
        src_desc = None
        for url in DEFAULT_URLS:
            print(f"[POC] trying {url}")
            raw = download(url)
            if not raw:
                continue
            # skip svg for LR path unless we can rasterize
            if url.endswith(".svg"):
                try:
                    import cairosvg

                    png = cairosvg.svg2png(
                        bytestring=raw, output_width=in_size, output_height=in_size
                    )
                    rgba = load_rgba(png, size=None)
                    src_desc = url + " (svg→png)"
                    break
                except Exception as e:
                    print(f"[POC] svg raster failed: {e}")
                    continue
            try:
                rgba = load_rgba(raw, size=in_size)
                src_desc = url
                break
            except Exception as e:
                print(f"[POC] decode failed: {e}")
                continue
        else:
            print("ERROR: could not download any Ace asset", file=sys.stderr)
            return 1

    print(f"[POC] source={src_desc} lr={rgba.shape} model={model_path.name}")

    # Save LR
    save_rgba(out_dir / "01_lr.png", rgba)

    # Bilinear baseline (RGBA)
    bil = bilinear_rgba(rgba, out_size)
    save_rgba(out_dir / "02_bilinear.png", bil)

    # Raw RGB drop-alpha (OLD broken-ish domain)
    rgb_raw = rgba[..., :3].copy()
    cascade_hops: list[str] = []
    try:
        if args.cascade:
            pred_raw, _ = cascade_2x(rgb_raw, model_dir)
        else:
            pred_raw = run_tflite(model_path, rgb_raw)
        save_rgba(out_dir / "03_model_raw_drop_alpha.png", pred_raw)
    except Exception as e:
        print(f"[POC] raw drop-alpha run failed: {e}")
        pred_raw = None

    # White-composite input (TRAIN / fixed app domain)
    rgb_wc = white_composite(rgba)
    if args.cascade:
        pred_wc, cascade_hops = cascade_2x(rgb_wc, model_dir)
        model_label = "cascade 16→32→64→128→256"
    else:
        pred_wc = run_tflite(model_path, rgb_wc)
        model_label = str(model_path)
    save_rgba(out_dir / "04_model_white_comp_in.png", pred_wc)

    # Alpha restore (full app path)
    a_hr = nn_upscale_alpha(rgba[..., 3], pred_wc.shape[0], pred_wc.shape[1])
    rgb_restored = uncomposite(pred_wc, a_hr)
    rgba_out = np.concatenate([rgb_restored, a_hr[..., None]], axis=-1)
    save_rgba(out_dir / "05_model_alpha_restored.png", rgba_out)

    # Optional fast model
    fast_path = Path(args.model_fast)
    lines = [
        f"source: {src_desc}",
        f"lr_shape: {tuple(rgba.shape)}",
        f"model: {model_label}",
        f"mode: {'cascade_2x' if args.cascade else 'one_shot'}",
        f"in_size: {in_size} out_size: {out_size}",
        f"lr_rgb_range_raw: {float(rgb_raw.min()):.4f}..{float(rgb_raw.max()):.4f}",
        f"lr_rgb_range_white_comp: {float(rgb_wc.min()):.4f}..{float(rgb_wc.max()):.4f}",
        f"alpha_range: {float(rgba[..., 3].min()):.4f}..{float(rgba[..., 3].max()):.4f}",
        f"pred_wc_range: {float(pred_wc.min()):.4f}..{float(pred_wc.max()):.4f}",
        f"pred_wc_var: {float(pred_wc.var()):.6f}",
    ]
    if cascade_hops:
        lines.append("cascade_hops:")
        lines.extend(f"  - {h}" for h in cascade_hops)
    if pred_raw is not None:
        lines.append(
            f"pred_raw_range: {float(pred_raw.min()):.4f}..{float(pred_raw.max()):.4f}"
        )

    if fast_path.is_file():
        try:
            pred_fast = run_tflite(fast_path, rgb_wc)
            save_rgba(out_dir / "06_model_fast_white_comp.png", pred_fast)
            lines.append(f"fast_model: {fast_path.name}")
            lines.append(
                f"pred_fast_range: {float(pred_fast.min()):.4f}..{float(pred_fast.max()):.4f}"
            )
        except Exception as e:
            lines.append(f"fast_model_failed: {e}")

    # Contact sheet: LR | bilinear | sharp WC | alpha restored
    def to_rgb_u8(a: np.ndarray) -> Image.Image:
        if a.shape[-1] == 4:
            # composite on checker-ish gray for visibility
            rgb = a[..., :3] * a[..., 3:4] + 0.85 * (1 - a[..., 3:4])
        else:
            rgb = a
        return Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8), mode="RGB")

    tiles = [
        to_rgb_u8(rgba).resize((out_size, out_size), Image.Resampling.NEAREST),
        to_rgb_u8(bil),
        to_rgb_u8(pred_wc),
        to_rgb_u8(rgba_out),
    ]
    sheet = Image.new("RGB", (out_size * len(tiles), out_size))
    for i, t in enumerate(tiles):
        sheet.paste(t, (i * out_size, 0))
    sheet.save(out_dir / "00_contact_sheet.png")
    lines.append(
        "contact_sheet: LR(nearest) | bilinear | model_wc | alpha_restored"
        + (" [CASCADE]" if args.cascade else " [ONE-SHOT]")
    )
    lines.append("Open 00_contact_sheet.png and 05_model_alpha_restored.png for review.")

    report = out_dir / "report.txt"
    report.write_text("\n".join(lines) + "\n")
    print(report.read_text())
    print(f"[POC] wrote {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())