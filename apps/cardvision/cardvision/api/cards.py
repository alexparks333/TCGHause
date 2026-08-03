from fastapi import APIRouter, HTTPException

from cardvision.db import queries
from cardvision.db.pool import get_pool
from cardvision.models import CardEventResponse, CardHistoryResponse

router = APIRouter()


@router.get("/cards/{physical_card_id}/history", response_model=CardHistoryResponse)
async def get_card_history(physical_card_id: str):
    pool = get_pool()
    async with pool.acquire() as conn:
        history = await queries.get_card_history(conn, physical_card_id)
    if history is None:
        raise HTTPException(404, "physical card not found")

    card = history["card"]
    return CardHistoryResponse(
        physical_card_id=str(card["id"]),
        game=card.get("game"),
        set_name=card.get("set_name"),
        card_number=card.get("card_number"),
        status=card["status"],
        events=[
            CardEventResponse(
                id=str(e["id"]),
                scan_id=str(e["scan_id"]) if e.get("scan_id") else None,
                event_type=e["event_type"],
                created_at=e["created_at"],
                capture_context=e.get("capture_context"),
                uploader_ref=e.get("uploader_ref"),
                external_listing_ref=e.get("external_listing_ref"),
            )
            for e in history["events"]
        ],
    )
