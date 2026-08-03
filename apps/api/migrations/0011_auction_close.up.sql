-- Support for a real auction-close worker (cmd/worker). Until now nothing
-- ever flipped a listing's status when its auction's clock ran out —
-- every read path (ListActive, CountsByGame, MyBids, HasWonAuctionFrom)
-- had to independently compare ends_at to now() instead. This adds a real
-- terminal state plus the actual outcome, so "did this auction sell or
-- not" is a stored fact, not something re-derived by every caller.

alter table listings drop constraint listings_status_check;
alter table listings add constraint listings_status_check
    check (status in ('active', 'ended', 'sold', 'cancelled'));

-- outcome is null until the worker closes the auction; 'sold' means it had
-- a high bidder when it closed, 'no_bids' means it never received one.
-- closed_at is the idempotency guard: the worker only ever processes a row
-- where closed_at is still null, so overlapping ticks (or a slow tick still
-- running when the next one starts) can never double-process the same
-- auction.
alter table auctions add column outcome text check (outcome in ('sold', 'no_bids'));
alter table auctions add column closed_at timestamptz;

-- The worker's entire hot query is "auctions that ended but aren't closed
-- yet" — a partial index keeps that a near-constant-time lookup regardless
-- of how many auctions accumulate over time.
create index auctions_pending_close_idx on auctions (ends_at) where closed_at is null;
