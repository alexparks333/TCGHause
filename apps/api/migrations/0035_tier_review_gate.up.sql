-- internal/seller.RecomputeTier persists every recomputed promotion input,
-- not just the ones that happen to change the tier, so a support agent can
-- answer "why is this seller still New" from these columns alone — same
-- reasoning migration 0022 already applied to cumulative_orders/
-- dispute_rate_90d, extended here to the new review-quality gate
-- (internal/seller/promotion.go's gatesPass).
alter table users add column review_count integer not null default 0;
alter table users add column average_rating numeric(3, 2) not null default 0;
