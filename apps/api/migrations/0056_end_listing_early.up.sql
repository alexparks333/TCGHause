-- Backs "Delete Listing" for an auction that already has a bid
-- (internal/auction.EndListing) — modeled on eBay's own real early-ending
-- rules (docs/EditListing.md has the full research this was built from),
-- not this app's earlier "always blocked once there's a bid" behavior.
--
-- 'cancelled' is a new auctions.outcome alongside the existing 'sold',
-- 'no_bids', 'bought_now' — set when the seller voids every bid instead of
-- honoring the current high bid. cancel_reason records why, mirroring the
-- handful of reasons eBay's own Trading API asks a seller to choose from —
-- null for every other outcome.

alter table auctions drop constraint auctions_outcome_check;
alter table auctions add constraint auctions_outcome_check
    check (outcome in ('sold', 'no_bids', 'bought_now', 'cancelled'));

alter table auctions add column cancel_reason text
    check (cancel_reason is null or cancel_reason in ('lost_or_broken', 'error_in_listing', 'not_available'));
