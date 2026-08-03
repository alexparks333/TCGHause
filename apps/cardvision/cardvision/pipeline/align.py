"""Stage 1 — feature extraction & alignment. ORB (patent-free, unlike
SURF) finds keypoints on each processed image; when comparing two scans,
we match keypoints and solve a RANSAC homography to precisely align scan B
onto scan A's frame — correcting whatever rotation/scale/perspective
drift exists between two separate capture sessions, so Stage 2's residual
comparison is looking at genuinely corresponding pixels.
"""

import pickle
from dataclasses import dataclass

import cv2
import numpy as np

_orb = cv2.ORB_create(nfeatures=2000)


@dataclass
class Features:
    keypoints: list[tuple]  # serializable (x, y, size, angle, response, octave, class_id)
    descriptors: np.ndarray | None


@dataclass
class AlignmentResult:
    success: bool
    aligned_b: np.ndarray | None  # scan B warped onto scan A's frame
    inlier_count: int
    match_count: int
    reprojection_error: float
    quality: float  # 0-1, folds inlier ratio + reprojection error together


def extract_features(img: np.ndarray) -> Features:
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    kps, desc = _orb.detectAndCompute(gray, None)
    serializable = [(kp.pt[0], kp.pt[1], kp.size, kp.angle, kp.response, kp.octave, kp.class_id) for kp in kps]
    return Features(keypoints=serializable, descriptors=desc)


def serialize_features(features: Features) -> bytes:
    return pickle.dumps(features)


def deserialize_features(data: bytes) -> Features:
    return pickle.loads(data)


def _to_keypoints(raw: list[tuple]) -> list[cv2.KeyPoint]:
    return [cv2.KeyPoint(x=x, y=y, size=size, angle=angle, response=response, octave=octave, class_id=class_id)
            for (x, y, size, angle, response, octave, class_id) in raw]


def align(img_a: np.ndarray, features_a: Features, img_b: np.ndarray, features_b: Features) -> AlignmentResult:
    if features_a.descriptors is None or features_b.descriptors is None:
        return AlignmentResult(False, None, 0, 0, float("inf"), 0.0)
    if len(features_a.descriptors) < 10 or len(features_b.descriptors) < 10:
        return AlignmentResult(False, None, 0, 0, float("inf"), 0.0)

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING)
    raw_matches = matcher.knnMatch(features_b.descriptors, features_a.descriptors, k=2)

    # Lowe's ratio test — keep a match only when it's a clearly better fit
    # than the next-best candidate, filtering out ambiguous matches before
    # they ever reach RANSAC.
    good = []
    for pair in raw_matches:
        if len(pair) != 2:
            continue
        m, n = pair
        if m.distance < 0.75 * n.distance:
            good.append(m)

    if len(good) < 10:
        return AlignmentResult(False, None, 0, len(good), float("inf"), 0.0)

    kps_a = _to_keypoints(features_a.keypoints)
    kps_b = _to_keypoints(features_b.keypoints)

    pts_b = np.float32([kps_b[m.queryIdx].pt for m in good]).reshape(-1, 1, 2)
    pts_a = np.float32([kps_a[m.trainIdx].pt for m in good]).reshape(-1, 1, 2)

    homography, mask = cv2.findHomography(pts_b, pts_a, cv2.RANSAC, 5.0)
    if homography is None:
        return AlignmentResult(False, None, 0, len(good), float("inf"), 0.0)

    inlier_count = int(mask.sum()) if mask is not None else 0
    inlier_ratio = inlier_count / len(good)

    # Reprojection error over the inliers only — how well the homography
    # actually explains the matches it claims support it.
    if inlier_count > 0:
        inlier_mask = mask.ravel().astype(bool)
        projected = cv2.perspectiveTransform(pts_b[inlier_mask], homography)
        errors = np.linalg.norm(projected - pts_a[inlier_mask], axis=2)
        reprojection_error = float(errors.mean())
    else:
        reprojection_error = float("inf")

    h, w = img_a.shape[:2]
    aligned_b = cv2.warpPerspective(img_b, homography, (w, h))

    # Fold inlier ratio + reprojection error into one 0-1 quality score.
    # Both need to be good — a homography with high inlier ratio but huge
    # reprojection error (e.g. a degenerate near-planar solution) shouldn't
    # score well, and vice versa.
    error_score = max(0.0, 1.0 - reprojection_error / 15.0)
    quality = max(0.0, min(1.0, inlier_ratio * 0.6 + error_score * 0.4))

    success = inlier_count >= 15 and reprojection_error < 10.0
    return AlignmentResult(success, aligned_b, inlier_count, len(good), reprojection_error, quality)
