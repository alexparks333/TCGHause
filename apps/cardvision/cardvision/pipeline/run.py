"""Orchestrates the pipeline stages for the two operations the rest of the
app actually calls: processing a freshly-uploaded scan (Stage 0 + feature
extraction), and comparing two already-processed scans (Stages 1-3, run
once for the front photo pair and once for the back photo pair, then
combined).
"""

from dataclasses import dataclass

from cardvision.pipeline import align, preprocess, residual, score
from cardvision.pipeline.preprocess import QualityResult


@dataclass
class PreprocessedScan:
    """Stage 0 only — fast enough (sub-second per image) to run
    synchronously inside the POST /scans request handler, so the response
    can return a real quality_tier immediately rather than a placeholder.
    """
    processed_front: bytes
    processed_back: bytes
    quality_tier: str
    quality_detail: dict


def preprocess_scan(front_bytes: bytes, back_bytes: bytes) -> PreprocessedScan:
    processed_front, quality_front = preprocess.preprocess(front_bytes)
    processed_back, quality_back = preprocess.preprocess(back_bytes)
    tier = score.weakest_tier(quality_front.tier, quality_back.tier)
    return PreprocessedScan(
        processed_front=processed_front,
        processed_back=processed_back,
        quality_tier=tier,
        quality_detail={
            "front": _quality_to_dict(quality_front),
            "back": _quality_to_dict(quality_back),
        },
    )


@dataclass
class ExtractedFeatures:
    """Stage 1's extraction half (no comparison yet) — this is the part
    that runs async via the process_scan job, operating on the already-
    preprocessed images fetched back from storage.
    """
    features_front: bytes
    features_back: bytes


def extract_scan_features(processed_front_bytes: bytes, processed_back_bytes: bytes) -> ExtractedFeatures:
    front_img = preprocess.decode_image(processed_front_bytes)
    back_img = preprocess.decode_image(processed_back_bytes)
    features_front = align.serialize_features(align.extract_features(front_img))
    features_back = align.serialize_features(align.extract_features(back_img))
    return ExtractedFeatures(features_front=features_front, features_back=features_back)


def _quality_to_dict(q: QualityResult) -> dict:
    return {
        "tier": q.tier,
        "sharpness": q.sharpness,
        "resolution_px": list(q.resolution_px),
        "brightness_mean": q.brightness_mean,
        "brightness_std": q.brightness_std,
    }


@dataclass
class CompareInputs:
    processed_front: bytes
    processed_back: bytes
    features_front: bytes
    features_back: bytes
    quality_tier: str


def compare_scans(scan_a: CompareInputs, scan_b: CompareInputs) -> score.ScoreResult:
    """Runs Stages 1-3 once for the front pair and once for the back pair,
    then combines them — the overall decision is only as good as its
    weaker side, since a mismatch on either face is disqualifying.
    """
    front_result = _compare_side(
        scan_a.processed_front, scan_a.features_front,
        scan_b.processed_front, scan_b.features_front,
        scan_a.quality_tier, scan_b.quality_tier,
    )
    back_result = _compare_side(
        scan_a.processed_back, scan_a.features_back,
        scan_b.processed_back, scan_b.features_back,
        scan_a.quality_tier, scan_b.quality_tier,
    )

    combined_score = min(front_result.match_score, back_result.match_score)
    combined_tier = score.weakest_tier(front_result.confidence_tier, back_result.confidence_tier)

    # Decision follows the weaker of the two sides' decisions, ranked from
    # most to least confident — a strong front match doesn't excuse a
    # mismatched back. insufficient_detail sits right next to inconclusive:
    # both mean "no confident claim either way," just for different
    # reasons (ambiguous evidence vs. no real evidence to begin with).
    rank = [score.DECISION_MISMATCH, score.DECISION_LIKELY_MISMATCH, score.DECISION_INSUFFICIENT_DETAIL,
            score.DECISION_INCONCLUSIVE, score.DECISION_LIKELY_MATCH, score.DECISION_MATCH]
    decision = min([front_result.decision, back_result.decision], key=lambda d: rank.index(d))

    return score.ScoreResult(
        match_score=round(combined_score, 4),
        decision=decision,
        confidence_tier=combined_tier,
        detail={"front": front_result.detail, "back": back_result.detail},
    )


def _compare_side(
    img_a_bytes: bytes, features_a_bytes: bytes,
    img_b_bytes: bytes, features_b_bytes: bytes,
    tier_a: str, tier_b: str,
) -> score.ScoreResult:
    img_a = preprocess.decode_image(img_a_bytes)
    img_b = preprocess.decode_image(img_b_bytes)
    features_a = align.deserialize_features(features_a_bytes)
    features_b = align.deserialize_features(features_b_bytes)

    alignment_result = align.align(img_a, features_a, img_b, features_b)
    residual_result = residual.compare(img_a, alignment_result.aligned_b) if alignment_result.success else None

    return score.score(alignment_result, residual_result, tier_a, tier_b)
