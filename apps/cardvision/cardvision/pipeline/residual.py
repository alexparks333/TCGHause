"""Stage 2 — residual/surface comparison. Once Stage 1 has aligned two
scans into the same frame, the artwork itself should cancel out almost
entirely — what's left (after normalizing lighting) is the physical
surface: creases, whitening, print-dot pattern, corner wear. That residual
is the actual fingerprint signal, not the artwork match (two different raw
copies of the same printed card align just as well at Stage 1 — they only
diverge here).
"""

from dataclasses import dataclass

import cv2
import numpy as np
from skimage.metrics import structural_similarity as ssim


@dataclass
class ResidualResult:
    ssim_score: float  # 0-1, structural similarity of the aligned pair
    mean_abs_diff: float
    anomaly_region_count: int
    anomaly_total_area_px: int
    anomaly_area_fraction: float  # anomaly area / frame area
    # How much natural micro-texture exists in the reference scan's *flat*
    # regions specifically — away from bold artwork edges (printed
    # borders, text, logos), which are high-frequency in their own right
    # and would otherwise swamp a plain whole-frame sharpness measure with
    # signal that has nothing to do with physical wear. Separate from
    # whether a match was found: a pristine/glossy card can legitimately
    # have almost no surface wear to compare, and a clean
    # anomaly_area_fraction on a low-detail card means "there was nothing
    # to find," not "confirmed same object" — score.py uses this to tell
    # those two apart instead of reporting a false-confidence match.
    detail_score: float


def _normalize_illumination(gray: np.ndarray) -> np.ndarray:
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    return clahe.apply(gray)


def _flat_region_detail(norm_gray: np.ndarray) -> float:
    """Laplacian variance measured only in the 'flat' interior of the
    surface — away from bold artwork edges (borders, text, logos), which
    are legitimately high-frequency and would otherwise dominate a
    whole-frame sharpness measure with signal that has nothing to do with
    physical wear. A dilated Canny edge mask excludes those regions (plus a
    margin around them); what's left is where genuine surface micro-
    texture — or its absence, on a pristine card — actually shows up.
    """
    edges = cv2.Canny(norm_gray, 50, 150)
    edges = cv2.dilate(edges, np.ones((9, 9), np.uint8))
    flat_mask = edges == 0

    laplacian = cv2.Laplacian(norm_gray, cv2.CV_64F)
    flat_values = laplacian[flat_mask]
    if flat_values.size < 100:
        # Almost the entire frame is edges (e.g. a densely patterned
        # card) — fall back to the full frame rather than report a
        # variance computed from too few samples to mean much.
        flat_values = laplacian.ravel()
    return float(flat_values.var())


def compare(img_a: np.ndarray, aligned_b: np.ndarray) -> ResidualResult:
    gray_a = cv2.cvtColor(img_a, cv2.COLOR_BGR2GRAY)
    gray_b = cv2.cvtColor(aligned_b, cv2.COLOR_BGR2GRAY)

    norm_a = _normalize_illumination(gray_a)
    norm_b = _normalize_illumination(gray_b)

    score, diff = ssim(norm_a, norm_b, full=True)
    diff = (1 - diff) * 255  # invert: high value = more different, matches diff_map intuition
    diff = diff.astype(np.uint8)

    # A homography alignment is never pixel-perfect — a sub-pixel residual
    # offset shows up as a thin, bright "ringing" halo along every hard
    # edge in the artwork (text, printed borders, shape boundaries), which
    # has nothing to do with the physical surface. Blur the diff map before
    # thresholding so that ringing (a few pixels wide) gets smoothed below
    # the anomaly threshold while genuine surface marks (creases, whitening
    # — wider and lower-contrast, but still spatially coherent) survive.
    diff = cv2.GaussianBlur(diff, (5, 5), 0)

    mean_abs_diff = float(cv2.absdiff(norm_a, norm_b).mean())

    # Threshold the (blurred) difference map to find contiguous anomaly
    # regions — the actual candidate physical marks, as opposed to
    # registration ringing or uniform sensor noise, both of which get
    # suppressed above.
    _, thresholded = cv2.threshold(diff, 40, 255, cv2.THRESH_BINARY)
    thresholded = cv2.morphologyEx(thresholded, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    contours, _ = cv2.findContours(thresholded, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    min_region_area = 40  # ignore edge-ringing/sensor-noise-scale specks
    regions = [c for c in contours if cv2.contourArea(c) >= min_region_area]

    total_area = sum(cv2.contourArea(c) for c in regions)
    frame_area = gray_a.shape[0] * gray_a.shape[1]

    detail_score = _flat_region_detail(norm_a)

    return ResidualResult(
        ssim_score=float(score),
        mean_abs_diff=mean_abs_diff,
        anomaly_region_count=len(regions),
        anomaly_total_area_px=int(total_area),
        anomaly_area_fraction=float(total_area / frame_area),
        detail_score=detail_score,
    )
