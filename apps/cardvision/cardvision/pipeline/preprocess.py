"""Stage 0 — ingest & preprocess: find the card in the photo, deskew it to
a flat canonical frame, and score the input quality honestly so later
stages never report more confidence than the source photo supports.
"""

from dataclasses import dataclass

import cv2
import numpy as np

# Standard trading-card aspect ratio (2.5in x 3.5in), scaled up for real
# working resolution — enough detail for ORB/AKAZE features and residual
# comparison without carrying huge arrays through the pipeline.
CANONICAL_WIDTH = 750
CANONICAL_HEIGHT = 1050


@dataclass
class QualityResult:
    tier: str  # low | medium | high
    sharpness: float
    resolution_px: tuple[int, int]
    brightness_mean: float
    brightness_std: float


def decode_image(data: bytes) -> np.ndarray:
    arr = np.frombuffer(data, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("could not decode image data")
    return img


def encode_image(img: np.ndarray) -> bytes:
    ok, buf = cv2.imencode(".jpg", img, [cv2.IMWRITE_JPEG_QUALITY, 92])
    if not ok:
        raise ValueError("could not encode image")
    return buf.tobytes()


def _find_card_contour(img: np.ndarray) -> np.ndarray | None:
    """Looks for the largest 4-point contour in the frame — the card's
    edge against whatever background it's photographed on. Returns the
    four corner points (unordered) or None if nothing plausible is found.
    """
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 50, 150)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=2)

    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None

    frame_area = img.shape[0] * img.shape[1]
    best = None
    best_area = 0.0
    for c in contours:
        area = cv2.contourArea(c)
        # A card fills a meaningful fraction of a reasonably-framed photo —
        # ignore tiny noise contours and anything suspiciously close to
        # the whole frame (background misdetected as the "card").
        if area < frame_area * 0.15 or area > frame_area * 0.98:
            continue
        peri = cv2.arcLength(c, True)
        approx = cv2.approxPolyDP(c, 0.02 * peri, True)
        if len(approx) == 4 and area > best_area:
            best = approx.reshape(4, 2).astype(np.float32)
            best_area = area

    return best


def _order_corners(pts: np.ndarray) -> np.ndarray:
    """Orders 4 points as top-left, top-right, bottom-right, bottom-left —
    required for a stable homography regardless of contour winding order.
    """
    s = pts.sum(axis=1)
    diff = np.diff(pts, axis=1).flatten()
    top_left = pts[np.argmin(s)]
    bottom_right = pts[np.argmax(s)]
    top_right = pts[np.argmin(diff)]
    bottom_left = pts[np.argmax(diff)]
    return np.array([top_left, top_right, bottom_right, bottom_left], dtype=np.float32)


def deskew(img: np.ndarray) -> tuple[np.ndarray, bool]:
    """Returns (canonical-frame image, found_card_boundary). Falls back to
    a plain resize of the full frame when no clean 4-point boundary is
    found — still usable, just flagged as unconfirmed framing via the
    returned bool, which preprocess() folds into the quality tier.
    """
    corners = _find_card_contour(img)
    if corners is None:
        resized = cv2.resize(img, (CANONICAL_WIDTH, CANONICAL_HEIGHT), interpolation=cv2.INTER_AREA)
        return resized, False

    ordered = _order_corners(corners)
    dst = np.array(
        [[0, 0], [CANONICAL_WIDTH - 1, 0], [CANONICAL_WIDTH - 1, CANONICAL_HEIGHT - 1], [0, CANONICAL_HEIGHT - 1]],
        dtype=np.float32,
    )
    matrix = cv2.getPerspectiveTransform(ordered, dst)
    warped = cv2.warpPerspective(img, matrix, (CANONICAL_WIDTH, CANONICAL_HEIGHT))

    # A portrait card photographed sideways still passes the 4-point check
    # — if width/height came out inverted relative to the canonical frame
    # (shouldn't happen given we always warp to CANONICAL_WIDTH x
    # CANONICAL_HEIGHT), that's handled by the fixed dst size above.
    return warped, True


def assess_quality(img: np.ndarray, boundary_found: bool) -> QualityResult:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

    # Sharpness via variance of the Laplacian — a well-known, cheap focus
    # proxy: a blurry image has little high-frequency content, so the
    # Laplacian's variance collapses toward zero.
    sharpness = float(cv2.Laplacian(gray, cv2.CV_64F).var())

    brightness_mean = float(gray.mean())
    brightness_std = float(gray.std())

    h, w = img.shape[:2]

    # Tiering is deliberately conservative — this directly gates how much
    # confidence later stages are allowed to report (CLAUDE.md-style
    # "closest honest tier", same reasoning as this project's Finished/
    # sold-history decisions elsewhere in the codebase).
    if not boundary_found or sharpness < 40 or brightness_std < 15:
        tier = "low"
    elif sharpness < 120 or min(h, w) < 600:
        tier = "medium"
    else:
        tier = "high"

    return QualityResult(
        tier=tier,
        sharpness=sharpness,
        resolution_px=(w, h),
        brightness_mean=brightness_mean,
        brightness_std=brightness_std,
    )


def preprocess(raw_bytes: bytes) -> tuple[bytes, QualityResult]:
    """Full Stage 0: decode -> deskew -> quality assessment -> re-encode.
    Returns the processed JPEG bytes and the quality result (tier is the
    weaker of front/back at the call site, see pipeline/run.py).
    """
    img = decode_image(raw_bytes)
    canonical, boundary_found = deskew(img)
    quality = assess_quality(canonical, boundary_found)
    return encode_image(canonical), quality
