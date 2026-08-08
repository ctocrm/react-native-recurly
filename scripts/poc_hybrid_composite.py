#!/usr/bin/env python3
"""
Hybrid bilin + one-shot composite POC (Ace).

User insight: bilinear is blurrier but fills letters; old one-shot is sharper
but thinner/pixelated. Strategy:
  - Keep sharp structure from the model
  - Keep fill from bilinear
  - Cut bilinear halo that sticks outside the sharp silhouette
  - Optionally cascade that hybrid hop-by-hop from 16px (×2 each time)

Variants:
  A) Frequency split: lowpass(bilin) + highpass(model)
  B) Silhouette mask: model body + bilin fill in holes; kill bilin outside mask
  C) Residual clamp: bilin + clamp(model - bilin) so residual can't carve fill

Usage:
  python scripts/poc_hybrid_composite.py
  python scripts/poc_hybrid_composite.py --out poc_out_hybrid
"""
from __future__ import annotations

import argparse
import io
import sys
import urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]

try:
    from tflite_runtime.interpreter import Interpreter
except ImportError:
    try:
        import tensorflow as tf

        Interpreter = tf.lite.Interpreter
    except ImportError:
        print("ERROR: need tflite_runtime or tensorflow", file=sys.stderr)
        sys.exit(1)

ACE_URLS = [
    "https://www.acehardware.com/favicon.ico",
    "https://cdn-tp6.mozu.com/24645-37138/resources/images/icons/favicon.ico",
]


def download(url: str) -> bytes | None:
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.read()
    except Exception as e:
        print(f"[HYB] download fail {url}: {e}")
        return None


def load_rgba(data, size: int | None = None) -> np.ndarray:
    img = Image.open(io.BytesIO(data) if isinstance(data, bytes) else data)
    img = img.convert("RGBA")
    if size is not None:
        img = img.resize((size, size), Image.Resampling.BICUBIC)
    return np.asarray(img).astype(np.float32) / 255.0


def white_composite(rgba: np.ndarray) -> np.ndarray:
    rgb, a = rgba[..., :3], rgba[..., 3:4]
    return rgb * a + (1.0 - a)


def to_u8(rgb: np.ndarray) -> np.ndarray:
    return (np.clip(rgb, 0, 1) * 255).astype(np.uint8)


def save_rgb(path: Path, rgb: np.ndarray) -> None:
    Image.fromarray(to_u8(rgb), mode="RGB").save(path)


def bilinear_rgb(rgb: np.ndarray, out: int) -> np.ndarray:
    im = Image.fromarray(to_u8(rgb), mode="RGB")
    im = im.resize((out, out), Image.Resampling.BILINEAR)
    return np.asarray(im).astype(np.float32) / 255.0


def run_tflite(model_path: Path, rgb: np.ndarray) -> np.ndarray:
    interp = Interpreter(model_path=str(model_path))
    interp.allocate_tensors()
    inp = interp.get_input_details()[0]
    out = interp.get_output_details()[0]
    x = rgb.astype(np.float32)
    if x.ndim == 3:
        x = x[None, ...]
    want = inp["shape"]
    if len(want) == 4 and want[1] > 0 and want[2] > 0:
        th, tw = int(want[1]), int(want[2])
        if x.shape[1] != th or x.shape[2] != tw:
            im = Image.fromarray(to_u8(x[0]), mode="RGB").resize(
                (tw, th), Image.Resampling.BICUBIC
            )
            x = (np.asarray(im).astype(np.float32) / 255.0)[None, ...]
    interp.set_tensor(inp["index"], x)
    interp.invoke()
    return np.clip(interp.get_tensor(out["index"])[0], 0.0, 1.0)


def gaussian_blur_rgb(rgb: np.ndarray, radius: float = 1.2) -> np.ndarray:
    im = Image.fromarray(to_u8(rgb), mode="RGB")
    im = im.filter(ImageFilter.GaussianBlur(radius=radius))
    return np.asarray(im).astype(np.float32) / 255.0


def hybrid_freq_split(bilin: np.ndarray, model: np.ndarray, blur_r: float = 1.5) -> np.ndarray:
    """A: low frequencies from bilin (fill), high from model (edges)."""
    low_b = gaussian_blur_rgb(bilin, blur_r)
    low_m = gaussian_blur_rgb(model, blur_r)
    high_m = model - low_m
    return np.clip(low_b + high_m, 0.0, 1.0)


def _luma(rgb: np.ndarray) -> np.ndarray:
    return 0.299 * rgb[..., 0] + 0.587 * rgb[..., 1] + 0.114 * rgb[..., 2]


def hybrid_silhouette_mask(
    bilin: np.ndarray,
    model: np.ndarray,
    bg_ref: float | None = None,
    soft: float = 0.12,
    dilate_px: int = 2,
) -> np.ndarray:
    """B: sharp model on top; bilin fill in holes; kill bilin halo outside silhouette.

    User: layer one-shot on bilin, remove bilin blur that sticks out of one-shot.
    """
    lum = _luma(bilin)
    thr = np.quantile(lum, 0.8)
    if bg_ref is None:
        bg = bilin[lum >= thr].mean(axis=0) if (lum >= thr).any() else np.ones(3)
    else:
        bg = np.full(3, float(bg_ref), dtype=np.float32)
    bg = bg.astype(np.float32)

    def ink_mask(rgb: np.ndarray) -> np.ndarray:
        dist = np.linalg.norm(rgb - bg.reshape(1, 1, 3), axis=-1)
        return np.clip((dist - soft * 0.35) / max(soft, 1e-6), 0.0, 1.0)

    m_model = ink_mask(model)
    m_bilin = ink_mask(bilin)
    m_img = Image.fromarray((m_model * 255).astype(np.uint8), mode="L")
    if dilate_px > 0:
        k = dilate_px * 2 + 1
        m_dil = np.asarray(m_img.filter(ImageFilter.MaxFilter(k))).astype(np.float32) / 255.0
    else:
        m_dil = m_model

    # Inside dilated silhouette: prefer model; use bilin where model is hollow
    # (bilin has ink, model weak) — restores letter fill without taking outer halo.
    w_m = m_model[..., None]
    holes = (np.clip(m_bilin - m_model, 0.0, 1.0) * m_dil)[..., None]
    body = model * w_m + bilin * holes + bilin * np.clip(1.0 - w_m - holes, 0, 1)
    # Outside silhouette: flat background (drops bilin halo that stuck out)
    bg_flat = bg.reshape(1, 1, 3)
    out = body * m_dil[..., None] + bg_flat * (1.0 - m_dil[..., None])
    return np.clip(out, 0.0, 1.0)


def hybrid_residual_clamp(
    bilin: np.ndarray,
    model: np.ndarray,
    max_darken: float = 0.12,
    max_brighten: float = 0.35,
    alpha: float = 1.0,
) -> np.ndarray:
    """C: bilin + α * clamped residual.

    Brand-safe: keep α low and max_darken tiny so stroke weight stays bilin-like.
    """
    r = model - bilin
    r = np.clip(r, -max_darken, max_brighten)
    return np.clip(bilin + float(alpha) * r, 0.0, 1.0)


def edge_strength_map(rgb: np.ndarray, blur_r: float = 0.8) -> np.ndarray:
    """Soft edge mask 0..1 from luminance gradient (protect letter interiors)."""
    lum = _luma(rgb).astype(np.float32)
    # Sobel-ish via finite differences
    gy = np.zeros_like(lum)
    gx = np.zeros_like(lum)
    gy[1:, :] = np.abs(lum[1:, :] - lum[:-1, :])
    gx[:, 1:] = np.abs(lum[:, 1:] - lum[:, :-1])
    g = gx + gy
    g = g / (np.percentile(g, 95) + 1e-6)
    g = np.clip(g, 0.0, 1.0)
    # slight blur so mask isn't 1px noisy
    im = Image.fromarray((g * 255).astype(np.uint8), mode="L")
    im = im.filter(ImageFilter.GaussianBlur(radius=blur_r))
    return np.asarray(im).astype(np.float32) / 255.0


def hybrid_edge_only(
    bilin: np.ndarray,
    model: np.ndarray,
    alpha: float = 0.4,
    max_darken: float = 0.04,
    max_brighten: float = 0.2,
) -> np.ndarray:
    """Residual only near edges — interiors stay pure bilin (brand mass)."""
    r = np.clip(model - bilin, -max_darken, max_brighten)
    e = edge_strength_map(bilin)[..., None]
    return np.clip(bilin + float(alpha) * r * e, 0.0, 1.0)


def hybrid_lerp(bilin: np.ndarray, other: np.ndarray, t: float) -> np.ndarray:
    """Global brand lock: mostly bilin, a little hybrid/model."""
    t = float(t)
    return np.clip((1.0 - t) * bilin + t * other, 0.0, 1.0)


def hybrid_combo(bilin: np.ndarray, model: np.ndarray) -> np.ndarray:
    """A then light B halo kill — often best of both."""
    freq = hybrid_freq_split(bilin, model, blur_r=1.4)
    # Use model+freq ink mask to trim bilin-like halo from freq result
    return hybrid_silhouette_mask(freq, model, soft=0.10, dilate_px=1)


def stats(name: str, rgb: np.ndarray) -> str:
    mean = rgb.mean(axis=(0, 1))
    dark = float((rgb.mean(-1) < 0.2).mean())
    return (
        f"{name}: meanRGB=({mean[0]:.3f},{mean[1]:.3f},{mean[2]:.3f}) "
        f"dark%={dark*100:.1f} var={rgb.var():.4f}"
    )


def label_sheet(
    tiles: list[tuple[str, np.ndarray]], out_path: Path, tile: int = 192
) -> None:
    pad, lh = 8, 36
    n = len(tiles)
    w = tile * n + pad * (n + 1)
    h = tile + lh + pad * 2
    sheet = Image.new("RGB", (w, h), (28, 28, 28))
    draw = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype(
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13
        )
    except Exception:
        font = ImageFont.load_default()
    for i, (lab, rgb) in enumerate(tiles):
        im = Image.fromarray(to_u8(rgb), mode="RGB")
        if im.size != (tile, tile):
            im = im.resize((tile, tile), Image.Resampling.BILINEAR)
        x = pad + i * (tile + pad)
        sheet.paste(im, (x, pad + lh))
        draw.text((x + 4, pad + 8), lab, fill=(255, 220, 80), font=font)
    sheet.save(out_path)
    print(f"[HYB] wrote {out_path}")


def cascade_hybrid(
    rgb16: np.ndarray,
    model_dir: Path,
    chain: list[tuple[int, int]],
    mode: str = "combo",
    family: str = "fsrcnn",
) -> tuple[np.ndarray, list[str]]:
    """Each hop: bilin 2x + model 2x → hybrid → next."""
    x = rgb16.astype(np.float32)
    logs: list[str] = []
    for inn, out in chain:
        path = model_dir / f"{family}_{inn}x_{out}x.tflite"
        if not path.is_file():
            raise FileNotFoundError(path)
        if x.shape[0] != inn:
            x = bilinear_rgb(x, inn)
        bil = bilinear_rgb(x, out)
        mod = run_tflite(path, x)
        if mode == "freq":
            y = hybrid_freq_split(bil, mod)
        elif mode == "mask":
            y = hybrid_silhouette_mask(bil, mod)
        elif mode == "clamp":
            y = hybrid_residual_clamp(bil, mod)
        else:
            y = hybrid_combo(bil, mod)
        logs.append(stats(f"hop {inn}→{out} [{mode}]", y))
        print(f"[HYB] {logs[-1]}")
        x = y
    return x, logs


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "poc_out_hybrid"))
    ap.add_argument(
        "--model",
        default=str(ROOT / "assets/models/fsrcnn_16x_192x.tflite"),
        help="One-shot model for single-hop hybrid",
    )
    ap.add_argument(
        "--cascade-dir",
        default="",
        help="Dir of 2x models for hybrid cascade (e.g. assets/models_cascade_v2)",
    )
    ap.add_argument("--input-size", type=int, default=16)
    ap.add_argument("--out-size", type=int, default=192)
    args = ap.parse_args()
    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    raw = None
    src = None
    for url in ACE_URLS:
        raw = download(url)
        if raw:
            src = url
            break
    if not raw:
        print("ERROR: no Ace favicon", file=sys.stderr)
        return 1

    rgba = load_rgba(raw, size=args.input_size)
    lr = white_composite(rgba)
    print(f"[HYB] source={src} lr={lr.shape}")

    bilin = bilinear_rgb(lr, args.out_size)
    model_path = Path(args.model)
    if not model_path.is_file():
        print(f"ERROR: missing {model_path}", file=sys.stderr)
        return 1
    model = run_tflite(model_path, lr)
    # model may be 192; match sizes
    if model.shape[0] != args.out_size:
        model = bilinear_rgb(model, args.out_size)

    h_freq = hybrid_freq_split(bilin, model)
    h_mask = hybrid_silhouette_mask(bilin, model)
    h_clamp = hybrid_residual_clamp(bilin, model)
    h_combo = hybrid_combo(bilin, model)

    save_rgb(out_dir / "01_lr_nearest.png", bilinear_rgb(lr, args.out_size))  # stretch for sheet
    # true nearest for display
    nearest = np.asarray(
        Image.fromarray(to_u8(lr), mode="RGB").resize(
            (args.out_size, args.out_size), Image.Resampling.NEAREST
        )
    ).astype(np.float32) / 255.0
    save_rgb(out_dir / "01_lr_nearest.png", nearest)
    save_rgb(out_dir / "02_bilinear.png", bilin)
    save_rgb(out_dir / "03_oneshot.png", model)
    save_rgb(out_dir / "04_hybrid_freq.png", h_freq)
    save_rgb(out_dir / "05_hybrid_mask.png", h_mask)
    save_rgb(out_dir / "06_hybrid_clamp.png", h_clamp)
    save_rgb(out_dir / "07_hybrid_combo.png", h_combo)

    lines = [
        f"source: {src}",
        stats("bilinear", bilin),
        stats("oneshot", model),
        stats("hybrid_freq", h_freq),
        stats("hybrid_mask", h_mask),
        stats("hybrid_clamp", h_clamp),
        stats("hybrid_combo", h_combo),
    ]

    label_sheet(
        [
            ("LR nearest", nearest),
            ("Bilinear", bilin),
            ("Old one-shot", model),
            ("Hyb A freq", h_freq),
            ("Hyb B mask", h_mask),
            ("Hyb C clamp", h_clamp),
            ("Hyb A+B combo", h_combo),
        ],
        out_dir / "00_contact_single_hop.png",
        tile=args.out_size,
    )

    # --- Brand-safe grid: bilin owns mass; model only a little snap ---
    # User: clamp best but letters thinner / lost branding vs bilin.
    b_clamp_full = hybrid_residual_clamp(bilin, model, max_darken=0.12, max_brighten=0.35, alpha=1.0)
    b_a35_d03 = hybrid_residual_clamp(bilin, model, max_darken=0.03, max_brighten=0.20, alpha=0.35)
    b_a25_d02 = hybrid_residual_clamp(bilin, model, max_darken=0.02, max_brighten=0.18, alpha=0.25)
    b_a45_d05 = hybrid_residual_clamp(bilin, model, max_darken=0.05, max_brighten=0.22, alpha=0.45)
    b_edge = hybrid_edge_only(bilin, model, alpha=0.40, max_darken=0.04, max_brighten=0.20)
    b_edge_soft = hybrid_edge_only(bilin, model, alpha=0.28, max_darken=0.025, max_brighten=0.15)
    b_lerp30 = hybrid_lerp(bilin, b_clamp_full, 0.30)
    b_lerp20 = hybrid_lerp(bilin, b_clamp_full, 0.20)
    b_lerp40 = hybrid_lerp(bilin, b_clamp_full, 0.40)

    brand_tiles = [
        ("Bilinear (brand ref)", bilin),
        ("Clamp α1 (thin?)", b_clamp_full),
        ("Clamp α0.35 d0.03", b_a35_d03),
        ("Clamp α0.25 d0.02", b_a25_d02),
        ("Clamp α0.45 d0.05", b_a45_d05),
        ("Edge-only α0.40", b_edge),
        ("Edge-only α0.28", b_edge_soft),
        ("Lerp 70/30 bilin", b_lerp30),
        ("Lerp 80/20 bilin", b_lerp20),
        ("Lerp 60/40 bilin", b_lerp40),
    ]
    for lab, arr in brand_tiles:
        slug = lab.lower().replace(" ", "_").replace("(", "").replace(")", "").replace("?", "").replace("/", "_")
        save_rgb(out_dir / f"brand_{slug}.png", arr)
        lines.append(stats(lab, arr))

    label_sheet(brand_tiles, out_dir / "00_contact_brand_safe.png", tile=args.out_size)
    # Compact "pick me" sheet: bilin | thin clamp | best candidates
    label_sheet(
        [
            ("Bilinear REF", bilin),
            ("Old clamp α1", b_clamp_full),
            ("α0.35 d0.03", b_a35_d03),
            ("α0.25 d0.02", b_a25_d02),
            ("Edge α0.28", b_edge_soft),
            ("Lerp 80/20", b_lerp20),
            ("Lerp 70/30", b_lerp30),
        ],
        out_dir / "00_contact_brand_picks.png",
        tile=args.out_size,
    )

    # Optional hybrid cascade from 16 with 2x models
    cdir = Path(args.cascade_dir) if args.cascade_dir else None
    if cdir and cdir.is_dir():
        chain = []
        for inn, out in [(16, 32), (32, 64), (64, 128), (128, 256)]:
            if (cdir / f"fsrcnn_{inn}x_{out}x.tflite").is_file():
                chain.append((inn, out))
            else:
                break
        if len(chain) >= 2:
            print(f"[HYB] cascade hybrid chain {chain}")
            for mode in ("clamp", "freq", "combo", "mask"):
                try:
                    y, logs = cascade_hybrid(lr, cdir, chain, mode=mode)
                    save_rgb(out_dir / f"cascade_hybrid_{mode}.png", y)
                    lines.append(f"--- cascade {mode} ---")
                    lines.extend(logs)
                    lines.append(stats(f"cascade_{mode}_final", y))
                except Exception as e:
                    lines.append(f"cascade {mode} failed: {e}")
                    print(f"[HYB] cascade {mode} failed: {e}")

            # comparison sheet at final size
            finals = [("Bilinear 16→final", bilinear_rgb(lr, chain[-1][1]))]
            for mode in ("clamp", "freq", "combo", "mask"):
                p = out_dir / f"cascade_hybrid_{mode}.png"
                if p.is_file():
                    finals.append(
                        (
                            f"Casc hyb {mode}",
                            np.asarray(Image.open(p).convert("RGB")).astype(np.float32)
                            / 255.0,
                        )
                    )
            # raw model cascade (no hybrid) for contrast if models exist
            try:
                x = lr.copy()
                for inn, out in chain:
                    x = run_tflite(cdir / f"fsrcnn_{inn}x_{out}x.tflite", x)
                save_rgb(out_dir / "cascade_model_only.png", x)
                finals.insert(1, ("Casc model-only", x))
                lines.append(stats("cascade_model_only", x))
            except Exception as e:
                lines.append(f"model-only cascade failed: {e}")

            label_sheet(finals, out_dir / "00_contact_cascade_hybrid.png", tile=min(256, chain[-1][1]))

    report = out_dir / "report.txt"
    report.write_text("\n".join(lines) + "\n")
    print(report.read_text())
    print(f"[HYB] done → {out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())