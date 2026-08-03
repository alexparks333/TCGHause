from datetime import datetime

from pydantic import BaseModel


class MatchRequest(BaseModel):
    scan_id_a: str
    scan_id_b: str


class JobResponse(BaseModel):
    id: str
    job_type: str
    status: str
    error: str | None
    result: dict | None
    created_at: datetime
    completed_at: datetime | None

    @classmethod
    def from_row(cls, row: dict) -> "JobResponse":
        return cls(
            id=str(row["id"]),
            job_type=row["job_type"],
            status=row["status"],
            error=row.get("error"),
            result=_parse_json_field(row.get("result")),
            created_at=row["created_at"],
            completed_at=row.get("completed_at"),
        )


class ScanResponse(BaseModel):
    id: str
    physical_card_id: str | None
    captured_at: datetime
    capture_context: str
    uploader_ref: str
    external_listing_ref: str | None
    image_front_url: str
    image_back_url: str
    processed_front_url: str | None
    processed_back_url: str | None
    quality_tier: str | None
    quality_detail: dict | None
    status: str

    @classmethod
    def from_row(cls, row: dict) -> "ScanResponse":
        return cls(
            id=str(row["id"]),
            physical_card_id=str(row["physical_card_id"]) if row.get("physical_card_id") else None,
            captured_at=row["captured_at"],
            capture_context=row["capture_context"],
            uploader_ref=row["uploader_ref"],
            external_listing_ref=row.get("external_listing_ref"),
            image_front_url=row["image_front_url"],
            image_back_url=row["image_back_url"],
            processed_front_url=row.get("processed_front_url"),
            processed_back_url=row.get("processed_back_url"),
            quality_tier=row.get("quality_tier"),
            quality_detail=_parse_json_field(row.get("quality_detail")),
            status=row["status"],
        )


class MatchResultResponse(BaseModel):
    id: str
    scan_id_a: str
    scan_id_b: str
    match_score: float
    decision: str
    alignment_quality: float | None
    detail: dict | None
    algorithm_version: str
    computed_at: datetime

    @classmethod
    def from_row(cls, row: dict) -> "MatchResultResponse":
        return cls(
            id=str(row["id"]),
            scan_id_a=str(row["scan_id_a"]),
            scan_id_b=str(row["scan_id_b"]),
            match_score=row["match_score"],
            decision=row["decision"],
            alignment_quality=row.get("alignment_quality"),
            detail=_parse_json_field(row.get("detail")),
            algorithm_version=row["algorithm_version"],
            computed_at=row["computed_at"],
        )


class CardEventResponse(BaseModel):
    id: str
    scan_id: str | None
    event_type: str
    created_at: datetime
    capture_context: str | None
    uploader_ref: str | None
    external_listing_ref: str | None


class CardHistoryResponse(BaseModel):
    physical_card_id: str
    game: str | None
    set_name: str | None
    card_number: str | None
    status: str
    events: list[CardEventResponse]


def _parse_json_field(value):
    if value is None:
        return None
    if isinstance(value, (dict, list)):
        return value
    import json
    return json.loads(value)
