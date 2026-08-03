"""Background job processor — polls the jobs table (Postgres-backed queue,
no Redis/Celery, mirroring apps/api/cmd/worker's own pattern) and runs the
two async pipeline operations: process_scan (feature extraction +
listing-context identity resolution) and compute_match (pairwise
comparison, the delivery-vs-listing "rental car" case).

Run from apps/cardvision/: `uv run python cmd/worker.py`.
"""

import asyncio
import sys
import traceback
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from cardvision.db import queries  # noqa: E402
from cardvision.db.pool import close_pool, init_pool  # noqa: E402
from cardvision.pipeline.run import CompareInputs, compare_scans, extract_scan_features  # noqa: E402
from cardvision.pipeline.score import ALGORITHM_VERSION, DECISION_LIKELY_MATCH, DECISION_MATCH  # noqa: E402
from cardvision.storage import client as storage  # noqa: E402

POLL_INTERVAL_SECONDS = 1.0
IDENTITY_MATCH_DECISIONS = (DECISION_MATCH, DECISION_LIKELY_MATCH)


async def run_forever() -> None:
    pool = await init_pool()
    print(f"cardvision worker started, polling every {POLL_INTERVAL_SECONDS}s")
    try:
        while True:
            async with pool.acquire() as conn:
                job = await queries.claim_next_job(conn)
            if job is None:
                await asyncio.sleep(POLL_INTERVAL_SECONDS)
                continue
            await _run_job(pool, job)
    finally:
        await close_pool()


async def _run_job(pool, job: dict) -> None:
    job_id = str(job["id"])
    job_type = job["job_type"]
    payload = job["payload"]
    if isinstance(payload, str):
        import json
        payload = json.loads(payload)

    print(f"[job {job_id}] running {job_type} {payload}")
    try:
        if job_type == "process_scan":
            async with pool.acquire() as conn:
                await _handle_process_scan(conn, payload["scan_id"])
            async with pool.acquire() as conn:
                await queries.complete_job(conn, job_id)
        elif job_type == "compute_match":
            async with pool.acquire() as conn:
                match_id = await _handle_compute_match(conn, payload["scan_id_a"], payload["scan_id_b"])
            async with pool.acquire() as conn:
                await queries.complete_job(conn, job_id, result={"match_result_id": match_id})
        else:
            async with pool.acquire() as conn:
                await queries.complete_job(conn, job_id, error=f"unknown job_type {job_type!r}")
        print(f"[job {job_id}] done")
    except Exception as e:  # noqa: BLE001 — a bad job must never crash the poll loop
        traceback.print_exc()
        async with pool.acquire() as conn:
            if job_type == "process_scan" and "scan_id" in payload:
                await queries.mark_scan_failed(conn, payload["scan_id"])
            await queries.complete_job(conn, job_id, error=str(e))
        print(f"[job {job_id}] failed: {e}")


def _fetch_processed_images(scan: dict) -> tuple[bytes, bytes]:
    front = storage.get_image(storage.url_to_key(scan["processed_front_url"]))
    back = storage.get_image(storage.url_to_key(scan["processed_back_url"]))
    return front, back


async def _handle_process_scan(conn, scan_id: str) -> None:
    scan = await queries.get_scan(conn, scan_id)
    if scan is None:
        raise ValueError(f"scan {scan_id} not found")

    processed_front, processed_back = _fetch_processed_images(scan)
    extracted = extract_scan_features(processed_front, processed_back)
    await queries.update_scan_features(
        conn, scan_id,
        feature_front=extracted.features_front,
        feature_back=extracted.features_back,
    )

    # Identity resolution (Stage 4) only runs for fresh "listing" scans —
    # delivery/resubmission scans get linked via an explicit POST /match
    # against the specific listing scan instead (the simpler, primary
    # rental-car case), not by searching the whole candidate pool.
    if scan["capture_context"] != "listing" or scan["physical_card_id"] is not None:
        return

    candidates = await queries.list_candidate_cards_for_matching(conn, exclude_scan_id=scan_id)
    this_inputs = CompareInputs(
        processed_front=processed_front,
        processed_back=processed_back,
        features_front=extracted.features_front,
        features_back=extracted.features_back,
        quality_tier=scan["quality_tier"],
    )

    best_candidate = None
    best_result = None
    for candidate in candidates:
        cand_front, cand_back = _fetch_processed_images(candidate)
        cand_inputs = CompareInputs(
            processed_front=cand_front,
            processed_back=cand_back,
            features_front=candidate["feature_front"],
            features_back=candidate["feature_back"],
            quality_tier=candidate["quality_tier"],
        )
        result = compare_scans(this_inputs, cand_inputs)
        if result.decision in IDENTITY_MATCH_DECISIONS and (
            best_result is None or result.match_score > best_result.match_score
        ):
            best_candidate, best_result = candidate, result

    async with conn.transaction():
        if best_candidate is not None:
            physical_card_id = str(best_candidate["physical_card_id"])
            await queries.link_scan_to_card(conn, scan_id, physical_card_id)
            await queries.insert_card_event(
                conn, physical_card_id=physical_card_id, scan_id=scan_id, event_type="resold"
            )
            await queries.insert_match_result(
                conn,
                scan_id_a=str(candidate_scan_id(best_candidate)),
                scan_id_b=scan_id,
                match_score=best_result.match_score,
                decision=best_result.decision,
                alignment_quality=_extract_alignment_quality(best_result.detail),
                detail=best_result.detail,
                algorithm_version=ALGORITHM_VERSION,
            )
        else:
            new_card = await queries.create_physical_card(conn, game=None, set_name=None, card_number=None)
            await queries.link_scan_to_card(conn, scan_id, str(new_card["id"]))
            await queries.insert_card_event(
                conn, physical_card_id=str(new_card["id"]), scan_id=scan_id, event_type="listed"
            )


def candidate_scan_id(candidate: dict) -> str:
    return str(candidate["id"])


async def _handle_compute_match(conn, scan_id_a: str, scan_id_b: str) -> str:
    scan_a = await queries.get_scan(conn, scan_id_a)
    scan_b = await queries.get_scan(conn, scan_id_b)
    if scan_a is None or scan_b is None:
        raise ValueError("one or both scans not found")
    if scan_a["status"] != "processed" or scan_b["status"] != "processed":
        raise ValueError("both scans must be processed before matching")

    front_a, back_a = _fetch_processed_images(scan_a)
    front_b, back_b = _fetch_processed_images(scan_b)

    inputs_a = CompareInputs(
        processed_front=front_a, processed_back=back_a,
        features_front=scan_a["feature_front"], features_back=scan_a["feature_back"],
        quality_tier=scan_a["quality_tier"],
    )
    inputs_b = CompareInputs(
        processed_front=front_b, processed_back=back_b,
        features_front=scan_b["feature_front"], features_back=scan_b["feature_back"],
        quality_tier=scan_b["quality_tier"],
    )

    result = compare_scans(inputs_a, inputs_b)

    async with conn.transaction():
        match_row = await queries.insert_match_result(
            conn,
            scan_id_a=scan_id_a,
            scan_id_b=scan_id_b,
            match_score=result.match_score,
            decision=result.decision,
            alignment_quality=_extract_alignment_quality(result.detail),
            detail=result.detail,
            algorithm_version=ALGORITHM_VERSION,
        )

        if result.decision in IDENTITY_MATCH_DECISIONS:
            await _link_matched_scans(conn, scan_a, scan_b)

    return str(match_row["id"])


def _extract_alignment_quality(detail: dict) -> float | None:
    sides = [detail.get("front", {}), detail.get("back", {})]
    qualities = [s["alignment_quality"] for s in sides if "alignment_quality" in s]
    return min(qualities) if qualities else None


async def _link_matched_scans(conn, scan_a: dict, scan_b: dict) -> None:
    card_a, card_b = scan_a["physical_card_id"], scan_b["physical_card_id"]
    if card_a and not card_b:
        await _link_and_log(conn, scan_b, str(card_a))
    elif card_b and not card_a:
        await _link_and_log(conn, scan_a, str(card_b))
    elif not card_a and not card_b:
        new_card = await queries.create_physical_card(conn, game=None, set_name=None, card_number=None)
        await _link_and_log(conn, scan_a, str(new_card["id"]))
        await _link_and_log(conn, scan_b, str(new_card["id"]))
    # if both already have (differing) physical_card_ids, leave as-is — an
    # ambiguous case the match_results row itself documents for review,
    # rather than silently overwriting either card's identity.


async def _link_and_log(conn, scan: dict, physical_card_id: str) -> None:
    scan_id = str(scan["id"])
    await queries.link_scan_to_card(conn, scan_id, physical_card_id)
    event_type = "delivered" if scan["capture_context"] == "delivery" else "resold"
    await queries.insert_card_event(conn, physical_card_id=physical_card_id, scan_id=scan_id, event_type=event_type)


if __name__ == "__main__":
    asyncio.run(run_forever())
