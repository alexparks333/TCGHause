-- Platinum is what "Haus Trust" used to be (500-order threshold, fixed
-- 5.50% rate) before Haus Trust became its own tier above it, reached only
-- through a real application/approval process rather than order volume.
alter table users drop constraint users_tier_check;
alter table users add constraint users_tier_check
    check (tier in ('new', 'bronze', 'silver', 'gold', 'platinum', 'haus_trust'));

-- Haus Trust's commission rate is negotiated per seller (depending on what
-- they sell), not a shared constant — set only when an application is
-- approved (internal/seller.DecideHausTrustApplication), cleared if the
-- seller is later demoted out of the tier (internal/seller.RecomputeTier).
alter table users add column haus_trust_custom_pct numeric(5, 4);

-- The application itself — a seller requests Haus Trust, an admin
-- approves (setting the negotiated rate) or rejects. Modeled as its own
-- small table rather than a status column on users, same "one append-only
-- record per request, not a field that gets silently overwritten" shape as
-- claims: a rejected application shouldn't erase the fact that it happened,
-- and a seller can apply again later after a rejection.
create table haus_trust_applications (
    id uuid primary key default gen_random_uuid(),
    seller_id uuid not null references users(id),
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    requested_at timestamptz not null default now(),
    decided_at timestamptz,
    decided_by uuid references users(id),
    granted_pct numeric(5, 4),
    note text
);
create index haus_trust_applications_seller_id_idx on haus_trust_applications (seller_id, requested_at desc);
