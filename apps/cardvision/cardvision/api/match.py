from fastapi import APIRouter, HTTPException

from cardvision.db import queries
from cardvision.db.pool import get_pool
from cardvision.models import JobResponse, MatchRequest, MatchResultResponse

router = APIRouter()


@router.post("/match", response_model=JobResponse)
async def create_match(body: MatchRequest):
    pool = get_pool()
    async with pool.acquire() as conn:
        scan_a = await queries.get_scan(conn, body.scan_id_a)
        scan_b = await queries.get_scan(conn, body.scan_id_b)
        if scan_a is None or scan_b is None:
            raise HTTPException(404, "one or both scans not found")
        if scan_a["status"] != "processed" or scan_b["status"] != "processed":
            raise HTTPException(
                409, "both scans must be fully processed (feature-extracted) before matching"
            )

        job_id = await queries.enqueue_job(
            conn,
            job_type="compute_match",
            payload={"scan_id_a": body.scan_id_a, "scan_id_b": body.scan_id_b},
        )
        row = await queries.get_job(conn, job_id)

    return JobResponse.from_row(row)


@router.get("/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await queries.get_job(conn, job_id)
    if row is None:
        raise HTTPException(404, "job not found")
    return JobResponse.from_row(row)


@router.get("/match/{match_id}", response_model=MatchResultResponse)
async def get_match(match_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await queries.get_match_result(conn, match_id)
    if row is None:
        raise HTTPException(404, "match result not found")
    return MatchResultResponse.from_row(row)
