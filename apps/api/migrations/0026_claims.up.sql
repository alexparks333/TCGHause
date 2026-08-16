-- Claims/dispute flow (design doc v2 §9): direct negotiation -> structured
-- claim -> auto-adjudication or human review -> decision -> one appeal.
-- reason_code and liable_party encode §9.3's liability matrix directly, so
-- "who pays" is auditable rather than an ad hoc judgment call each time.
create table claims (
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references orders(id),
    opened_by uuid not null references users(id),
    reason_code text not null check (reason_code in (
        'not_as_described', 'not_received_no_tracking', 'not_received_tracking_delivered',
        'payment_fraud', 'buyers_remorse', 'transit_damage'
    )),
    state text not null default 'opened' check (state in (
        'opened', 'negotiating', 'escalated', 'auto_adjudicated', 'human_review',
        'decided', 'appealed', 'closed'
    )),
    resolution text check (resolution in ('refund_buyer', 'deny', 'partial_refund', 'platform_absorb')),
    refund_cents bigint,
    liable_party text check (liable_party in ('seller', 'buyer', 'platform')),
    reviewer_id uuid references users(id),
    created_at timestamptz not null default now(),
    resolved_at timestamptz
);
create index claims_order_id_idx on claims (order_id);

-- The negotiation thread, evidence log, and partial-refund offer/accept
-- audit trail all live here as one append-only event log, kind
-- distinguishing what each row actually is.
create table claim_events (
    id uuid primary key default gen_random_uuid(),
    claim_id uuid not null references claims(id),
    actor_id uuid not null references users(id),
    kind text not null check (kind in (
        'message', 'evidence', 'partial_refund_offer', 'escalation', 'decision', 'appeal'
    )),
    body text,
    amount_cents bigint,
    created_at timestamptz not null default now()
);
create index claim_events_claim_id_idx on claim_events (claim_id, created_at);
