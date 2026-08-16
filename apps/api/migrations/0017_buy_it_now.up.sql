-- Buy It Now: a real, race-safe purchase path, not a "coming soon"
-- placeholder — for both formats:
--   - fixed-format listings ALREADY are "Buy It Now only" (their existing
--     price_cents is the BIN price); they just needed somewhere to record
--     who bought one and when, since they have no auctions row.
--   - auction-format listings can now OPTIONALLY carry a
--     buy_it_now_price_cents: unset, it's a plain auction exactly as
--     before; set, a buyer can skip the bidding entirely and buy it
--     outright at any point before the clock runs out, no matter how many
--     bids already exist.

alter table auctions add column buy_it_now_price_cents bigint
    check (buy_it_now_price_cents is null or buy_it_now_price_cents > 0);

-- 'bought_now' sits alongside 'sold' (won via bidding) and 'no_bids' — an
-- auction+BIN listing bought outright reuses high_bidder_id/
-- current_price_cents/closed_at exactly like a normal close
-- (internal/auction/close.go): a Buy It Now purchase IS a close, just
-- buyer-triggered instead of cmd/worker's timer, racing against that same
-- timer via the same closed_at guard (internal/auction/buynow.go).
alter table auctions drop constraint auctions_outcome_check;
alter table auctions add constraint auctions_outcome_check
    check (outcome in ('sold', 'no_bids', 'bought_now'));

-- Fixed-format listings have no auctions row to record a buyer on, so
-- these live directly on listings — the one place that format can record
-- "who ended up with it," parallel to auctions.high_bidder_id/closed_at.
alter table listings add column buyer_id uuid references users(id);
alter table listings add column sold_at timestamptz;

-- Same one-time celebration tracking as auctions.buyer_celebrated_at /
-- seller_celebrated_at (0014_win_celebrations), for the fixed-listing
-- purchase path specifically — a Buy It Now purchase deserves the same
-- "Bid Won!"-style toast and bell notification as an auction win, not a
-- lesser experience just because it skipped bidding.
alter table listings add column buyer_celebrated_at timestamptz;
alter table listings add column seller_celebrated_at timestamptz;

-- 'bought' is a fourth notification kind, alongside 'won'/'sold'/'outbid'
-- (0015_notifications) — distinct wording from 'won' since nothing was
-- actually bid on.
alter table notifications drop constraint notifications_kind_check;
alter table notifications add constraint notifications_kind_check
    check (kind in ('won', 'sold', 'outbid', 'bought'));
