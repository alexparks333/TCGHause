"""Stage 3 — combine alignment + residual signals into one match_score and
decision. Deliberately keeps the confidence basis attached to the result
rather than collapsing everything into a bare number: the API response
always carries both the decision and *why*, qualified by how good the
source photos actually were (Stage 0's quality_tier) — never presenting a
low-quality-photo result with false precision.
"""

from dataclasses import dataclass

from cardvision.pipeline.align import AlignmentResult
from cardvision.pipeline.residual import ResidualResult

ALGORITHM_VERSION = "cardvision-pipeline-v1"

DECISION_MATCH = "match"
DECISION_LIKELY_MATCH = "likely_match"
DECISION_INCONCLUSIVE = "inconclusive"
DECISION_LIKELY_MISMATCH = "likely_mismatch"
DECISION_MISMATCH = "mismatch"
# Distinct from DECISION_INCONCLUSIVE on purpose: "inconclusive" means the
# comparison produced ambiguous evidence; this means the card itself has so
# little physical texture (a pristine/glossy/near-flawless surface — a
# PSA 10 raw or graded card is the canonical case) that a clean comparison
# doesn't prove anything either way. A near-featureless card and a
# genuinely-verified match can look identical downstream, so this has to be
# caught before scoring ever reports "match" — the whole point is never
# handing back a guessed match dressed up as a confirmed one.
DECISION_INSUFFICIENT_DETAIL = "insufficient_detail"

_QUALITY_RANK = {"low": 0, "medium": 1, "high": 2}

# Anomaly area fraction (of the aligned frame) beyond which the surface is
# treated as maximally different — calibrated against real card photos as
# this pipeline sees more of them; see the process_scan/compute_match
# verification notes for how this number was picked.
_ANOMALY_FRACTION_CEILING = 0.02

# Laplacian-variance floor below which the reference scan's surface is
# treated as too smooth/featureless to fingerprint reliably — a reasoned
# placeholder (same honesty caveat as _ANOMALY_FRACTION_CEILING above),
# needs calibration against real photos of pristine vs. worn cards rather
# than the synthetic test images this was first tuned against.
_DETAIL_FLOOR = 25.0


@dataclass
class ScoreResult:
    match_score: float
    decision: str
    confidence_tier: str  # low | medium | high — weaker of the two input scans' quality
    detail: dict


def weakest_tier(tier_a: str, tier_b: str) -> str:
    return tier_a if _QUALITY_RANK.get(tier_a, 0) <= _QUALITY_RANK.get(tier_b, 0) else tier_b


def score(alignment: AlignmentResult, residual: ResidualResult | None, quality_tier_a: str, quality_tier_b: str) -> ScoreResult:
    tier = weakest_tier(quality_tier_a, quality_tier_b)

    if not alignment.success or residual is None:
        # Couldn't even align the two images into a common frame — either
        # capture conditions were too different to compare, or (a real,
        # useful signal) these may not be the same printed card at all.
        return ScoreResult(
            match_score=0.0,
            decision=DECISION_INCONCLUSIVE if not alignment.success and alignment.match_count > 0 else DECISION_MISMATCH,
            confidence_tier=tier,
            detail={
                "reason": "alignment_failed",
                "inlier_count": alignment.inlier_count,
                "match_count": alignment.match_count,
            },
        )

    # match_score blends three signals. Alignment quality and residual SSIM
    # are both dominated by the *artwork*, which is identical across every
    # copy of the same printed card by construction — neither can tell two
    # authentic copies apart, they only rule out "not even the same
    # printing." anomaly_area_fraction (how much of the aligned frame
    # differs beyond registration noise — see residual.py) is what
    # actually carries the fingerprint signal, since it's the one measure
    # driven by physical surface differences rather than shared artwork,
    # so it gets the majority of the weight.
    surface_score = max(0.0, 1.0 - residual.anomaly_area_fraction / _ANOMALY_FRACTION_CEILING)
    raw_score = alignment.quality * 0.20 + residual.ssim_score * 0.20 + surface_score * 0.60

    # A low-quality capture can't support a confident decision even if the
    # raw numbers look good — cap the reportable score rather than let a
    # blurry photo produce a falsely precise "match".
    if tier == "low":
        raw_score = min(raw_score, 0.75)

    if raw_score >= 0.85:
        decision = DECISION_MATCH
    elif raw_score >= 0.65:
        decision = DECISION_LIKELY_MATCH
    elif raw_score >= 0.45:
        decision = DECISION_INCONCLUSIVE
    elif raw_score >= 0.25:
        decision = DECISION_LIKELY_MISMATCH
    else:
        decision = DECISION_MISMATCH

    # inconclusive/low-tier results never get promoted to a hard match/
    # mismatch label regardless of the raw number — the tier caps the
    # vocabulary of the decision itself, not just the score.
    if tier == "low" and decision in (DECISION_MATCH, DECISION_MISMATCH):
        decision = DECISION_LIKELY_MATCH if decision == DECISION_MATCH else DECISION_LIKELY_MISMATCH

    # A clean-looking comparison on a near-featureless surface isn't
    # evidence of a match — it's the absence of evidence either way. Only
    # gates match-leaning outcomes: if real differences were found despite
    # low detail (a likely_mismatch/mismatch), that's still meaningful —
    # you don't need much surface texture to notice a new scratch.
    insufficient_detail = residual.detail_score < _DETAIL_FLOOR
    if insufficient_detail and decision in (DECISION_MATCH, DECISION_LIKELY_MATCH):
        decision = DECISION_INSUFFICIENT_DETAIL

    return ScoreResult(
        match_score=round(raw_score, 4),
        decision=decision,
        confidence_tier=tier,
        detail={
            "alignment_quality": alignment.quality,
            "inlier_count": alignment.inlier_count,
            "match_count": alignment.match_count,
            "reprojection_error": alignment.reprojection_error,
            "ssim_score": residual.ssim_score,
            "mean_abs_diff": residual.mean_abs_diff,
            "anomaly_region_count": residual.anomaly_region_count,
            "anomaly_area_fraction": residual.anomaly_area_fraction,
            "detail_score": residual.detail_score,
            "insufficient_detail": insufficient_detail,
        },
    )
