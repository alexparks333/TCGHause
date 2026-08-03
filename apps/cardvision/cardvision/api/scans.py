from fastapi import APIRouter, Form, HTTPException, UploadFile

from cardvision.db import queries
from cardvision.db.pool import get_pool
from cardvision.models import ScanResponse
from cardvision.pipeline.run import preprocess_scan
from cardvision.storage import client as storage

router = APIRouter()

_VALID_CAPTURE_CONTEXTS = {"listing", "delivery", "resubmission", "manual"}


@router.post("/scans", response_model=ScanResponse)
async def create_scan(
    front: UploadFile,
    back: UploadFile,
    capture_context: str = Form(...),
    uploader_ref: str = Form(...),
    external_listing_ref: str | None = Form(None),
):
    if capture_context not in _VALID_CAPTURE_CONTEXTS:
        raise HTTPException(422, f"capture_context must be one of {sorted(_VALID_CAPTURE_CONTEXTS)}")

    front_bytes = await front.read()
    back_bytes = await back.read()
    if not front_bytes or not back_bytes:
        raise HTTPException(422, "both front and back images are required")

    try:
        preprocessed = preprocess_scan(front_bytes, back_bytes)
    except ValueError as e:
        raise HTTPException(422, f"could not process uploaded images: {e}")

    _, original_front_url = storage.put_image(front_bytes, prefix="scans/original")
    _, original_back_url = storage.put_image(back_bytes, prefix="scans/original")
    _, processed_front_url = storage.put_image(preprocessed.processed_front, prefix="scans/processed")
    _, processed_back_url = storage.put_image(preprocessed.processed_back, prefix="scans/processed")

    pool = get_pool()
    async with pool.acquire() as conn:
        row = await queries.insert_scan(
            conn,
            capture_context=capture_context,
            uploader_ref=uploader_ref,
            external_listing_ref=external_listing_ref,
            image_front_url=original_front_url,
            image_back_url=original_back_url,
            processed_front_url=processed_front_url,
            processed_back_url=processed_back_url,
            quality_tier=preprocessed.quality_tier,
            quality_detail=preprocessed.quality_detail,
        )
        await queries.enqueue_job(
            conn, job_type="process_scan", payload={"scan_id": str(row["id"])}
        )

    return ScanResponse.from_row(row)


@router.get("/scans/{scan_id}", response_model=ScanResponse)
async def get_scan(scan_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        row = await queries.get_scan(conn, scan_id)
    if row is None:
        raise HTTPException(404, "scan not found")
    return ScanResponse.from_row(row)
