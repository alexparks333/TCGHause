create extension if not exists pgcrypto;

-- The identity of a physical card as this system knows it — not tied to
-- any catalog entry, since a raw card has no universal registry. game/
-- set_name/card_number are best-effort declared metadata, not the
-- identity itself.
create table physical_cards (
    id            uuid primary key default gen_random_uuid(),
    created_at    timestamptz not null default now(),
    game          text,
    set_name      text,
    card_number   text,
    status        text not null default 'active'  -- active | archived
);

-- One row per photograph-of-a-card event. physical_card_id starts null
-- and is resolved (linked to an existing card, or a new one created) once
-- Stage 4 (provenance) runs — see cardvision/pipeline/.
create table scans (
    id                    uuid primary key default gen_random_uuid(),
    physical_card_id      uuid references physical_cards(id),
    captured_at           timestamptz not null default now(),
    capture_context       text not null,  -- listing | delivery | resubmission | manual
    uploader_ref          text not null,  -- opaque external user id — no FK across systems
    external_listing_ref  text,           -- opaque external listing id, nullable
    image_front_url       text not null,
    image_back_url        text not null,
    processed_front_url   text,
    processed_back_url    text,
    quality_tier          text,           -- low | medium | high
    quality_detail        jsonb,          -- sharpness/resolution/lighting metrics, for audit
    feature_front         bytea,          -- serialized ORB/AKAZE descriptors
    feature_back          bytea,
    status                text not null default 'pending'  -- pending | processed | failed
);

create index scans_physical_card_id_idx on scans (physical_card_id);
create index scans_external_listing_ref_idx on scans (external_listing_ref);

create table match_results (
    id                uuid primary key default gen_random_uuid(),
    scan_id_a         uuid not null references scans(id),
    scan_id_b         uuid not null references scans(id),
    match_score       real not null,
    decision          text not null,  -- match | likely_match | inconclusive | likely_mismatch | mismatch
    alignment_quality real,
    detail            jsonb,          -- inlier count, residual stats, per-stage breakdown
    algorithm_version text not null,
    computed_at       timestamptz not null default now()
);

create index match_results_scan_id_a_idx on match_results (scan_id_a);
create index match_results_scan_id_b_idx on match_results (scan_id_b);

create table physical_card_events (
    id                uuid primary key default gen_random_uuid(),
    physical_card_id  uuid not null references physical_cards(id),
    scan_id           uuid references scans(id),
    event_type        text not null,  -- listed | delivered | resold | dispute_opened
    created_at        timestamptz not null default now()
);

create index physical_card_events_physical_card_id_idx on physical_card_events (physical_card_id);

create table jobs (
    id           uuid primary key default gen_random_uuid(),
    job_type     text not null,  -- process_scan | compute_match
    payload      jsonb not null,
    result       jsonb,          -- e.g. {"match_result_id": "..."} once a compute_match job finishes
    status       text not null default 'queued',  -- queued | running | done | failed
    error        text,
    created_at   timestamptz not null default now(),
    completed_at timestamptz
);

create index jobs_status_idx on jobs (status);
