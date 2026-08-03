"""Hand-written SQL, one function per real operation — no ORM. Mirrors
apps/api/internal/*/*.go's own style (a Go struct + explicit SELECT/INSERT
per function), same shape in Python via asyncpg.
"""

import json
from typing import Any

import asyncpg


# ---- scans ----------------------------------------------------------------

async def insert_scan(
    conn: asyncpg.Connection,
    *,
    capture_context: str,
    uploader_ref: str,
    external_listing_ref: str | None,
    image_front_url: str,
    image_back_url: str,
    processed_front_url: str,
    processed_back_url: str,
    quality_tier: str,
    quality_detail: dict[str, Any],
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        insert into scans (
            capture_context, uploader_ref, external_listing_ref,
            image_front_url, image_back_url,
            processed_front_url, processed_back_url,
            quality_tier, quality_detail
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        returning *
        """,
        capture_context, uploader_ref, external_listing_ref,
        image_front_url, image_back_url,
        processed_front_url, processed_back_url,
        quality_tier, json.dumps(quality_detail),
    )
    return dict(row)


async def get_scan(conn: asyncpg.Connection, scan_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow("select * from scans where id = $1", scan_id)
    return dict(row) if row else None


async def update_scan_features(
    conn: asyncpg.Connection,
    scan_id: str,
    *,
    feature_front: bytes,
    feature_back: bytes,
    status: str = "processed",
) -> None:
    await conn.execute(
        """
        update scans
        set feature_front = $2, feature_back = $3, status = $4
        where id = $1
        """,
        scan_id, feature_front, feature_back, status,
    )


async def mark_scan_failed(conn: asyncpg.Connection, scan_id: str) -> None:
    await conn.execute("update scans set status = 'failed' where id = $1", scan_id)


# ---- match_results ----------------------------------------------------------

async def insert_match_result(
    conn: asyncpg.Connection,
    *,
    scan_id_a: str,
    scan_id_b: str,
    match_score: float,
    decision: str,
    alignment_quality: float | None,
    detail: dict[str, Any],
    algorithm_version: str,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        insert into match_results (
            scan_id_a, scan_id_b, match_score, decision,
            alignment_quality, detail, algorithm_version
        )
        values ($1, $2, $3, $4, $5, $6, $7)
        returning *
        """,
        scan_id_a, scan_id_b, match_score, decision,
        alignment_quality, json.dumps(detail), algorithm_version,
    )
    return dict(row)


async def get_match_result(conn: asyncpg.Connection, match_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow("select * from match_results where id = $1", match_id)
    return dict(row) if row else None


# ---- physical_cards / provenance -------------------------------------------

async def create_physical_card(
    conn: asyncpg.Connection,
    *,
    game: str | None,
    set_name: str | None,
    card_number: str | None,
) -> dict[str, Any]:
    row = await conn.fetchrow(
        """
        insert into physical_cards (game, set_name, card_number)
        values ($1, $2, $3)
        returning *
        """,
        game, set_name, card_number,
    )
    return dict(row)


async def link_scan_to_card(conn: asyncpg.Connection, scan_id: str, physical_card_id: str) -> None:
    await conn.execute(
        "update scans set physical_card_id = $2 where id = $1", scan_id, physical_card_id
    )


async def insert_card_event(
    conn: asyncpg.Connection,
    *,
    physical_card_id: str,
    scan_id: str | None,
    event_type: str,
) -> None:
    await conn.execute(
        """
        insert into physical_card_events (physical_card_id, scan_id, event_type)
        values ($1, $2, $3)
        """,
        physical_card_id, scan_id, event_type,
    )


async def get_card_history(conn: asyncpg.Connection, physical_card_id: str) -> dict[str, Any] | None:
    card = await conn.fetchrow("select * from physical_cards where id = $1", physical_card_id)
    if card is None:
        return None
    events = await conn.fetch(
        """
        select e.*, s.capture_context, s.uploader_ref, s.external_listing_ref
        from physical_card_events e
        left join scans s on s.id = e.scan_id
        where e.physical_card_id = $1
        order by e.created_at asc
        """,
        physical_card_id,
    )
    return {"card": dict(card), "events": [dict(e) for e in events]}


async def list_candidate_cards_for_matching(
    conn: asyncpg.Connection, *, exclude_scan_id: str, limit: int = 200
) -> list[dict[str, Any]]:
    """The identity-resolution candidate pool: the most recent processed
    scan for every existing physical_card, newest cards first. A simple
    recency-bounded scan rather than a real similarity index — fine at
    this scale (CLAUDE.md's own "don't build ahead of real need" pattern),
    revisit with a proper vector index if the card catalog ever grows
    large enough for a linear scan to matter.
    """
    rows = await conn.fetch(
        """
        select distinct on (physical_card_id) *
        from scans
        where physical_card_id is not null
          and status = 'processed'
          and id != $1
        order by physical_card_id, captured_at desc
        limit $2
        """,
        exclude_scan_id, limit,
    )
    return [dict(r) for r in rows]


# ---- jobs -------------------------------------------------------------------

async def enqueue_job(conn: asyncpg.Connection, *, job_type: str, payload: dict[str, Any]) -> str:
    row = await conn.fetchrow(
        "insert into jobs (job_type, payload) values ($1, $2) returning id",
        job_type, json.dumps(payload),
    )
    return str(row["id"])


async def claim_next_job(conn: asyncpg.Connection) -> dict[str, Any] | None:
    row = await conn.fetchrow(
        """
        update jobs set status = 'running'
        where id = (
            select id from jobs
            where status = 'queued'
            order by created_at asc
            for update skip locked
            limit 1
        )
        returning *
        """
    )
    return dict(row) if row else None


async def get_job(conn: asyncpg.Connection, job_id: str) -> dict[str, Any] | None:
    row = await conn.fetchrow("select * from jobs where id = $1", job_id)
    return dict(row) if row else None


async def complete_job(
    conn: asyncpg.Connection, job_id: str, *, error: str | None = None, result: dict[str, Any] | None = None
) -> None:
    await conn.execute(
        """
        update jobs set status = $2, error = $3, result = $4, completed_at = now()
        where id = $1
        """,
        job_id, "failed" if error else "done", error, json.dumps(result) if result is not None else None,
    )
