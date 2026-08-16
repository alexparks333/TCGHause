-- Idempotent Stripe webhook processing (design doc v2 §5.2) — no webhook
-- handler existed before this; every event is first upserted here with
-- ON CONFLICT DO NOTHING, and 0 rows affected means it was already
-- processed, so the handler returns 200 without re-running side effects.
-- Standard Stripe-recommended dedup pattern.
create table stripe_events (
    id           text primary key,
    type         text not null,
    processed_at timestamptz not null default now()
);
